#!/usr/bin/env python3
"""
One-time backfill of sales-volume history from TCGPlayer's infinite-api.

Populates public.product_sales_history (migration 0015 must be applied first):
- range=annual  -> 52 weekly buckets (bucketStartDate = Mondays) stored as
                   granularity='week' rows (about a year of coverage).
- range=month   -> 30 daily buckets stored as granularity='day' rows
                   (the same rows the scraper in main.py maintains going
                   forward).

Week and day rows never collide because granularity is part of the unique
key (product_id, bucket_date, granularity); upserts make re-runs idempotent.

Features (mirrors backfill_historical_prices.py):
- Intelligent rate limiting with exponential backoff
- Session recycling to avoid bot detection
- Checkpoint/resume functionality
- Robust error handling and retries
- Detailed progress tracking

Usage:
  # Standard run (all products):
  python backfill_sales_volume.py

  # Run forward direction (first half of products):
  python backfill_sales_volume.py --forward

  # Run reverse direction (second half of products):
  python backfill_sales_volume.py --reverse

  # Run both in parallel (two terminals for faster processing):
  Terminal 1: python backfill_sales_volume.py --forward
  Terminal 2: python backfill_sales_volume.py --reverse

  # Resume from checkpoint after interruption:
  python backfill_sales_volume.py --resume backfill_sales_checkpoint_<timestamp>.json
"""
import argparse
import logging
import time
import random
import json
import re
import os
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
import requests
from supabase import create_client
from secrets_loader import load_supabase_credentials

SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()

# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Checkpoint files default to a per-run timestamped name (like
# backfill_historical_prices.py) so parallel --forward/--reverse runs
# never clobber each other's progress; use --resume <file> to reuse one.

# === Rate Limiting Configuration ===
RATE_LIMIT_CONFIG = {
    'min_delay': 2.0,        # Minimum delay between requests (seconds)
    'max_delay': 5.0,        # Maximum delay between requests (seconds)
    'session_recycle_after': 100,  # Recycle API session after N products
    'max_retries': 3,        # Maximum retry attempts per product
    'retry_backoff_base': 2, # Base for exponential backoff (seconds)
    'timeout': 20,           # Request timeout (seconds)
}

# Browser fingerprint profiles — one is chosen at random per script run
# and stays consistent throughout (a real browser doesn't change UA mid-session).
BROWSER_PROFILES = [
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Accept-Language": "en-US,en;q=0.9",
    },
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Accept-Language": "en-US,en;q=0.9",
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Sec-Ch-Ua": '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Accept-Language": "en-US,en;q=0.9",
    },
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Sec-Ch-Ua": '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Accept-Language": "en-US,en;q=0.9",
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
        "Sec-Ch-Ua": None,  # Firefox doesn't send Sec-Ch-Ua
        "Sec-Ch-Ua-Mobile": None,
        "Sec-Ch-Ua-Platform": None,
        "Accept-Language": "en-US,en;q=0.5",
    },
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        "Sec-Ch-Ua": None,
        "Sec-Ch-Ua-Mobile": None,
        "Sec-Ch-Ua-Platform": None,
        "Accept-Language": "en-US,en;q=0.5",
    },
]

# Select one profile for the entire script run
ACTIVE_PROFILE = random.choice(BROWSER_PROFILES)


def _create_session():
    """Create a requests.Session pre-configured with the active browser profile."""
    session = requests.Session()
    # Set persistent headers on the session so every request uses the same fingerprint
    session.headers.update({
        "User-Agent": ACTIVE_PROFILE["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": ACTIVE_PROFILE["Accept-Language"],
        "Origin": "https://www.tcgplayer.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Connection": "keep-alive",
        "DNT": "1",
    })
    # Add Sec-Ch-Ua headers only for Chrome profiles (Firefox doesn't send them)
    for key in ("Sec-Ch-Ua", "Sec-Ch-Ua-Mobile", "Sec-Ch-Ua-Platform"):
        if ACTIVE_PROFILE.get(key):
            session.headers[key] = ACTIVE_PROFILE[key]
    return session


# Ranges fetched per product: annual gives 52 weekly buckets (granularity
# 'week'), month gives 30 daily buckets (granularity 'day').
SALES_RANGE_CONFIG = [
    {"label": "1Y", "range_key": "annual", "granularity": "week"},
    {"label": "1M", "range_key": "month", "granularity": "day"},
]


# === Checkpoint Management ===
class CheckpointManager:
    """Manages checkpoints for resuming interrupted backfill runs"""

    def __init__(self, checkpoint_file=None):
        self.checkpoint_file = checkpoint_file or (
            f"backfill_sales_checkpoint_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        self.data = self._load()

    def _load(self):
        """Load existing checkpoint or create new one"""
        if os.path.exists(self.checkpoint_file):
            try:
                with open(self.checkpoint_file, 'r') as f:
                    logger.info(f"Loaded checkpoint from {self.checkpoint_file}")
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Could not load checkpoint: {e}")

        return {
            'processed_products': [],
            'failed_products': [],
            'stats': {
                'total_inserted': 0,
                'total_failed': 0,
                'total_skipped': 0,
            },
            'last_updated': None,
        }

    def save(self):
        """Save checkpoint to disk"""
        try:
            self.data['last_updated'] = datetime.now().isoformat()
            with open(self.checkpoint_file, 'w') as f:
                json.dump(self.data, f, indent=2)
            logger.debug(f"Checkpoint saved to {self.checkpoint_file}")
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")

    def mark_processed(self, product_id):
        """Mark a product as successfully processed"""
        if product_id not in self.data['processed_products']:
            self.data['processed_products'].append(product_id)
            self.save()

    def mark_failed(self, product_id):
        """Mark a product as failed"""
        if product_id not in self.data['failed_products']:
            self.data['failed_products'].append(product_id)
            self.save()

    def is_processed(self, product_id):
        """Check if product was already processed"""
        return product_id in self.data['processed_products']

    def update_stats(self, inserted=0, failed=0, skipped=0):
        """Update statistics"""
        self.data['stats']['total_inserted'] += inserted
        self.data['stats']['total_failed'] += failed
        self.data['stats']['total_skipped'] += skipped
        self.save()


# === Rate Limiter ===
class RateLimiter:
    """Intelligent rate limiter with exponential backoff"""

    def __init__(self, config=RATE_LIMIT_CONFIG):
        self.config = config
        self.last_request_time = 0
        self.consecutive_errors = 0

    def wait(self):
        """Wait appropriate amount of time before next request"""
        elapsed = time.time() - self.last_request_time

        # Calculate base delay with jitter
        base_delay = random.uniform(self.config['min_delay'], self.config['max_delay'])

        # Add exponential backoff if there were recent errors
        if self.consecutive_errors > 0:
            backoff = self.config['retry_backoff_base'] ** self.consecutive_errors
            delay = base_delay + backoff
            logger.debug(f"Rate limiting with backoff: {delay:.2f}s (errors: {self.consecutive_errors})")
        else:
            delay = base_delay

        # Wait if needed
        if elapsed < delay:
            sleep_time = delay - elapsed
            time.sleep(sleep_time)

        self.last_request_time = time.time()

    def record_error(self):
        """Record an error for backoff calculation"""
        self.consecutive_errors += 1

    def reset_errors(self):
        """Reset error count after successful request"""
        self.consecutive_errors = 0


def extract_tcgplayer_product_id(url):
    """Extract the TCGPlayer product ID from the product URL."""
    if not url:
        return None
    match = re.search(r"/product/(\d+)", url)
    if match:
        return match.group(1)
    return None


def extract_preferred_language(url):
    """Extract preferred language from the URL query string (if present)."""
    try:
        query = parse_qs(urlparse(url).query)
        lang = query.get("Language") or query.get("language")
        if lang:
            return lang[0]
    except Exception as e:
        logger.debug(f"Could not parse language from URL: {e}")
    return None


def _api_headers(referer=None):
    """Build per-request headers. The session already carries the fingerprint;
    this only adds the per-request Referer."""
    headers = {}
    if referer:
        headers["Referer"] = referer
    return headers


def fetch_price_history_json(session, product_id, range_key, referer=None, timeout=15):
    url = f"https://infinite-api.tcgplayer.com/price/history/{product_id}/detailed?range={range_key}"
    headers = _api_headers(referer)
    try:
        response = session.get(url, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        logger.debug(f"API request failed for range={range_key}: {e}")
        return None

    if response.status_code != 200:
        logger.debug(f"API response {response.status_code} for range={range_key}")
        return None

    try:
        return response.json()
    except ValueError as e:
        logger.debug(f"API JSON decode failed for range={range_key}: {e}")
        return None


def _select_api_result(data, preferred_variant=None, preferred_language=None):
    results = data.get("result") or []
    if not results:
        return None

    filtered = results
    if preferred_language:
        lang_matches = [r for r in filtered if r.get("language") == preferred_language]
        if lang_matches:
            filtered = lang_matches

    if preferred_variant:
        variant_matches = [r for r in filtered if r.get("variant") == preferred_variant]
        if variant_matches:
            filtered = variant_matches

    return filtered[0] if filtered else None


def _to_date(date_str):
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _parse_bucket_count(value):
    """Parse a count field ('3', '1,234', 3) to a non-negative int or None."""
    if value is None:
        return None
    try:
        count = int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None
    if count < 0:
        return None
    return count


def _parse_bucket_price(value):
    """Parse a price field ('147.24', '1,499.99') to a positive float or None."""
    if value is None:
        return None
    try:
        price = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return price


def parse_sales_buckets(buckets, product_id, granularity, min_bucket_date=None):
    """
    Convert raw API buckets into upsert-ready product_sales_history rows
    with the given granularity ('day' or 'week').

    Defensive parsing: API numeric values are strings, possibly with
    commas. Buckets with a missing/invalid bucketStartDate are skipped;
    negative counts and non-positive prices become None. Buckets older
    than min_bucket_date (the set release date) are dropped.
    """
    rows = []
    for bucket in buckets or []:
        if not isinstance(bucket, dict):
            continue
        date_str = bucket.get("bucketStartDate")
        if not date_str:
            continue
        bucket_date = _to_date(str(date_str))
        if not bucket_date:
            continue
        if min_bucket_date and bucket_date < min_bucket_date:
            continue

        rows.append({
            "product_id": product_id,
            "bucket_date": bucket_date.strftime("%Y-%m-%d"),
            "granularity": granularity,
            "quantity_sold": _parse_bucket_count(bucket.get("quantitySold")),
            "transaction_count": _parse_bucket_count(bucket.get("transactionCount")),
            "low_sale_price": _parse_bucket_price(bucket.get("lowSalePrice")),
            "high_sale_price": _parse_bucket_price(bucket.get("highSalePrice")),
            "market_price": _parse_bucket_price(bucket.get("marketPrice")),
        })
    return rows


def extract_sales_history_api(product_id, db_product_id, referer=None,
                              preferred_variant=None, preferred_language=None,
                              min_bucket_date=None, session=None):
    """
    Fetch sales-volume history from TCGPlayer's infinite-api.
    Returns a deduped list of upsert-ready product_sales_history rows:
    granularity='week' rows from range=annual and granularity='day' rows
    from range=month. Week and day rows never collide (granularity is part
    of the key), but the intra-batch dedupe guard still applies.
    """
    if not product_id:
        return []

    session = session or _create_session()

    deduped = {}

    for range_config in SALES_RANGE_CONFIG:
        data = fetch_price_history_json(
            session=session,
            product_id=product_id,
            range_key=range_config["range_key"],
            referer=referer,
            timeout=RATE_LIMIT_CONFIG['timeout'],
        )

        if not data:
            logger.debug(f"API data missing for {range_config['label']}")
            continue

        result = _select_api_result(
            data,
            preferred_variant=preferred_variant,
            preferred_language=preferred_language,
        )
        if not result:
            logger.debug(f"No matching API result for {range_config['label']}")
            continue

        buckets = result.get("buckets") or []
        rows = parse_sales_buckets(
            buckets=buckets,
            product_id=db_product_id,
            granularity=range_config["granularity"],
            min_bucket_date=min_bucket_date,
        )

        # Intra-batch dedupe guard: PostgREST upsert fails if one batch
        # contains the same (product_id, bucket_date, granularity) twice.
        for row in rows:
            key = (row["product_id"], row["bucket_date"], row["granularity"])
            if key not in deduped:
                deduped[key] = row

        logger.debug(
            f"API {range_config['label']} ({range_config['range_key']}) -> "
            f"{len(rows)} {range_config['granularity']} rows (deduped total: {len(deduped)})"
        )

    return list(deduped.values())


def fetch_products_paginated(batch_size=500):
    """
    Fetch all products from database using pagination to handle large datasets.
    Returns list of all products.
    """
    all_products = []
    offset = 0

    while True:
        response = supabase.table("products")\
            .select("id, url, variant, set_id, sets(release_date)")\
            .range(offset, offset + batch_size - 1)\
            .execute()

        if not response.data:
            break

        all_products.extend(response.data)
        logger.debug(f"Fetched {len(response.data)} products (total: {len(all_products)})")

        if len(response.data) < batch_size:
            break  # Last page

        offset += batch_size

    return all_products


def batch_upsert_sales_history(entries, batch_size=100):
    """
    Upsert sales history entries in batches (idempotent on
    (product_id, bucket_date, granularity)).
    Returns tuple of (upserted_count, failed_count).
    """
    upserted_count = 0
    failed_count = 0

    for i in range(0, len(entries), batch_size):
        batch = entries[i:i + batch_size]
        try:
            supabase.table("product_sales_history").upsert(
                batch, on_conflict="product_id,bucket_date,granularity"
            ).execute()
            upserted_count += len(batch)
            logger.debug(f"Batch upserted {len(batch)} records")
        except Exception as e:
            error_text = str(e)
            if "42P01" in error_text or "does not exist" in error_text.lower():
                logger.error(
                    f"product_sales_history table missing — apply migration "
                    f"0015_product_sales_and_listings_history.sql before "
                    f"backfilling. Aborting this batch: {e}"
                )
                failed_count += len(entries) - i
                return upserted_count, failed_count
            logger.error(
                f"Batch upsert failed (has migration "
                f"0015_product_sales_and_listings_history.sql been applied?): {e}"
            )
            # Fall back to individual upserts for this batch
            for entry in batch:
                try:
                    supabase.table("product_sales_history").upsert(
                        entry, on_conflict="product_id,bucket_date,granularity"
                    ).execute()
                    upserted_count += 1
                except Exception as inner_e:
                    logger.error(f"Individual upsert failed for {entry.get('bucket_date', 'unknown')}: {inner_e}")
                    failed_count += 1

    return upserted_count, failed_count


def backfill_sales_volume(start_idx=None, end_idx=None, reverse=False, checkpoint_file=None):
    """
    Main function to backfill sales-volume history for all products with
    robust error handling.

    Args:
        start_idx: Starting product index (0-based, inclusive)
        end_idx: Ending product index (exclusive)
        reverse: If True, process products in reverse order
        checkpoint_file: Path to checkpoint file for resume capability
    """
    logger.info("Starting sales-volume backfill (weekly rows from range=annual, daily rows from range=month)")
    logger.info(f"Browser profile: {ACTIVE_PROFILE['User-Agent'][:60]}...")

    # Initialize checkpoint manager
    checkpoint = CheckpointManager(checkpoint_file)
    logger.info(f"Checkpoint file: {checkpoint.checkpoint_file}")

    # Initialize rate limiter
    rate_limiter = RateLimiter()

    # Get all products from database using pagination
    all_products = fetch_products_paginated()

    # Apply index range if specified
    if start_idx is not None or end_idx is not None:
        start = start_idx or 0
        end = end_idx or len(all_products)
        products = all_products[start:end]
        range_info = f" (indices {start}-{end-1})"
    else:
        products = all_products
        range_info = ""

    # Reverse the products list if requested
    if reverse:
        products = list(reversed(products))
        direction = "REVERSE"
    else:
        direction = "FORWARD"

    logger.info(f"Found {len(products)} products to process{range_info} [{direction}]")

    # Filter out already processed products from checkpoint
    products_to_process = [p for p in products if not checkpoint.is_processed(p["id"])]
    already_processed = len(products) - len(products_to_process)

    if already_processed > 0:
        logger.info(f"Skipping {already_processed} already processed products from checkpoint")
        logger.info(f"{len(products_to_process)} products remaining")

    session_product_count = 0
    api_session = None
    today_utc = datetime.now(timezone.utc).date()

    try:
        api_session = _create_session()

        for idx, product in enumerate(products_to_process, 1):
            product_id = product["id"]
            url = product["url"]
            variant = product.get("variant")
            tcgplayer_product_id = extract_tcgplayer_product_id(url)
            preferred_language = extract_preferred_language(url)

            if not tcgplayer_product_id:
                logger.warning(f"   Missing TCGPlayer product ID in URL for product {product_id}, skipping")
                checkpoint.mark_failed(product_id)
                checkpoint.update_stats(failed=1)
                continue

            # Get release_date from the joined sets table
            release_date_str = None
            sets_data = product.get("sets")
            if sets_data and isinstance(sets_data, dict):
                release_date_str = sets_data.get("release_date")

            variant_info = f" (Variant: {variant})" if variant else ""
            logger.info(f"[{idx}/{len(products_to_process)}] Processing product ID {product_id}{variant_info}...")

            # === Session recycling to avoid detection ===
            session_product_count += 1
            if session_product_count >= RATE_LIMIT_CONFIG['session_recycle_after']:
                logger.info(f"Recycling API session (processed {session_product_count} products)")
                try:
                    api_session.close()
                except Exception:
                    pass
                time.sleep(random.uniform(1, 3))
                api_session = _create_session()
                session_product_count = 0

            # === Clamp buckets older than the set release date ===
            release_date = None
            if release_date_str:
                try:
                    # Parse release date (handle various formats)
                    if 'T' in release_date_str:
                        release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
                    else:
                        release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

                    if release_date > today_utc:
                        logger.info(f"   Skipping - product releases {release_date} (in the future)")
                        checkpoint.mark_processed(product_id)
                        checkpoint.update_stats(skipped=1)
                        continue
                    logger.debug(f"   Clamping buckets to release date {release_date}")
                except Exception as e:
                    logger.warning(f"   Could not parse release_date '{release_date_str}': {e}")
                    release_date = None

            # === Retry logic for API fetch ===
            sales_rows = None
            for attempt in range(1, RATE_LIMIT_CONFIG['max_retries'] + 1):
                try:
                    # Apply rate limiting before request
                    rate_limiter.wait()

                    logger.debug(
                        f"   Fetching sales volume via API (attempt {attempt}/{RATE_LIMIT_CONFIG['max_retries']})..."
                    )

                    sales_rows = extract_sales_history_api(
                        product_id=tcgplayer_product_id,
                        db_product_id=product_id,
                        referer=url,
                        preferred_variant=variant,
                        preferred_language=preferred_language,
                        min_bucket_date=release_date,
                        session=api_session,
                    )

                    if sales_rows:
                        rate_limiter.reset_errors()
                        break
                    else:
                        logger.warning(f"   No data extracted on attempt {attempt}")
                        if attempt < RATE_LIMIT_CONFIG['max_retries']:
                            rate_limiter.record_error()
                            backoff_time = RATE_LIMIT_CONFIG['retry_backoff_base'] ** attempt
                            logger.info(f"   Retrying in {backoff_time}s...")
                            time.sleep(backoff_time)

                except Exception as e:
                    logger.error(f"   Unexpected error on attempt {attempt}: {e}")
                    rate_limiter.record_error()
                    if attempt < RATE_LIMIT_CONFIG['max_retries']:
                        time.sleep(RATE_LIMIT_CONFIG['retry_backoff_base'] ** attempt)
                    continue

            if not sales_rows:
                logger.error(f"   Failed to extract data for product {product_id} after {RATE_LIMIT_CONFIG['max_retries']} attempts")
                checkpoint.mark_failed(product_id)
                checkpoint.update_stats(failed=1)
                continue

            day_count = sum(1 for row in sales_rows if row["granularity"] == "day")
            week_count = len(sales_rows) - day_count
            logger.info(f"   Upserting {len(sales_rows)} rows ({week_count} weekly, {day_count} daily)...")

            # Batch upsert (idempotent: re-runs overwrite the same keys)
            upserted_count, failed_count = batch_upsert_sales_history(sales_rows)

            if failed_count > 0:
                logger.warning(f"   Upserted {upserted_count} records, {failed_count} failed for product {product_id}")
                checkpoint.update_stats(inserted=upserted_count, failed=failed_count)
            else:
                logger.info(f"   Upserted {upserted_count} records for product {product_id}")
                checkpoint.update_stats(inserted=upserted_count)

            # Mark as successfully processed
            checkpoint.mark_processed(product_id)

    except KeyboardInterrupt:
        logger.info("\n\nInterrupted by user. Progress saved to checkpoint.")
        logger.info(f"Resume with: python backfill_sales_volume.py --resume {checkpoint.checkpoint_file}")

    finally:
        if api_session:
            try:
                api_session.close()
            except Exception:
                pass

    # Print final statistics
    stats = checkpoint.data['stats']
    logger.info("="*60)
    logger.info("Sales-volume backfill complete!")
    logger.info(f"  Total upserted: {stats['total_inserted']} sales-volume rows")
    logger.info(f"  Total skipped:  {stats['total_skipped']} products")
    logger.info(f"  Total failed:   {stats['total_failed']} operations")
    logger.info(f"  Checkpoint:     {checkpoint.checkpoint_file}")
    logger.info("="*60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="One-time backfill of sales-volume history from TCGPlayer (weekly + daily buckets)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process all products (default):
  python backfill_sales_volume.py

  # Run forward direction (first half):
  python backfill_sales_volume.py --forward

  # Run reverse direction (second half):
  python backfill_sales_volume.py --reverse

  # Run both in parallel for maximum speed:
  Terminal 1: python backfill_sales_volume.py --forward
  Terminal 2: python backfill_sales_volume.py --reverse

  # Resume from checkpoint:
  python backfill_sales_volume.py --resume backfill_sales_checkpoint_<timestamp>.json

  # Enable debug logging:
  python backfill_sales_volume.py --debug

Note: migration migrations/0015_product_sales_and_listings_history.sql must
be applied to the database before running this script.
        """
    )

    parser.add_argument("--forward", action="store_true",
                        help="Process first half of products in forward order")
    parser.add_argument("--reverse", action="store_true",
                        help="Process second half of products in reverse order")
    parser.add_argument("--resume", type=str, default=None,
                        help="Resume from checkpoint file")
    parser.add_argument("--debug", action="store_true",
                        help="Enable debug logging")

    args = parser.parse_args()

    # Set logging level based on debug flag
    if args.debug:
        logger.setLevel(logging.DEBUG)

    # Determine range based on flags
    if args.forward or args.reverse:
        # Get total product count first to calculate midpoint
        response = supabase.table("products").select("id", count="exact").execute()
        total_count = response.count or len(response.data)
        midpoint = total_count // 2

        if args.forward:
            # First half, forward order
            start_idx = 0
            end_idx = midpoint
            reverse = False
            logger.info(f"FORWARD MODE: Processing products 0 to {end_idx-1} (first half)")
        else:  # args.reverse
            # Second half, reverse order
            start_idx = midpoint
            end_idx = total_count
            reverse = True
            logger.info(f"REVERSE MODE: Processing products {end_idx-1} down to {start_idx} (second half)")
    else:
        # Default: process all products
        start_idx = None
        end_idx = None
        reverse = False
        logger.info("Processing ALL products")

    backfill_sales_volume(
        start_idx=start_idx,
        end_idx=end_idx,
        reverse=reverse,
        checkpoint_file=args.resume
    )
