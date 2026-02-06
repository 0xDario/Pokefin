#!/usr/bin/env python3
"""
Enhanced script to backfill historical price data from TCGPlayer's infinite-api
Automatically fetches 365 days (max) of price history with intelligent rate limiting

Features:
- Multi-range API fetching (1M, 3M, 6M, 1Y) for maximum data coverage
- Intelligent rate limiting with exponential backoff
- Session recycling to avoid bot detection
- Checkpoint/resume functionality
- Robust error handling and retries
- Detailed progress tracking

Usage:
  # Standard run (all products, 365 days automatically):
  python backfill_historical_prices.py

  # Run forward direction (first half of products):
  python backfill_historical_prices.py --forward

  # Run reverse direction (second half of products):
  python backfill_historical_prices.py --reverse

  # Run both in parallel (two terminals for faster processing):
  Terminal 1: python backfill_historical_prices.py --forward
  Terminal 2: python backfill_historical_prices.py --reverse

  # Resume from checkpoint after interruption:
  python backfill_historical_prices.py --resume checkpoint_20250109_143022.json
"""
import argparse
import logging
import time
import random
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs
import requests
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
import os

# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Rate Limiting Configuration ===
RATE_LIMIT_CONFIG = {
    'min_delay': 2.0,        # Minimum delay between requests (seconds)
    'max_delay': 5.0,        # Maximum delay between requests (seconds)
    'session_recycle_after': 100,  # Recycle API session after N products
    'max_retries': 3,        # Maximum retry attempts per product
    'retry_backoff_base': 2, # Base for exponential backoff (seconds)
    'timeout': 20,           # Page load timeout (seconds)
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

# API ranges for the infinite-api endpoint (shortest -> longest)
# We try multiple keys per range to handle naming variations.
API_RANGE_CONFIG = [
    {"label": "1M", "keys": ["month", "monthly", "1m"]},
    {"label": "3M", "keys": ["quarter", "3m"]},
    {"label": "6M", "keys": ["semi-annual", "semiannual", "6m"]},
    {"label": "1Y", "keys": ["annual", "year", "1y"]},
]

# === Checkpoint Management ===
class CheckpointManager:
    """Manages checkpoints for resuming interrupted backfill runs"""

    def __init__(self, checkpoint_file=None):
        self.checkpoint_file = checkpoint_file or f"checkpoint_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
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


def expand_buckets_to_daily(buckets, target_start_date=None, target_end_date=None):
    """Expand API bucket data into daily entries."""
    target_start = _to_date(target_start_date) if target_start_date else None
    target_end = _to_date(target_end_date) if target_end_date else None

    bucket_items = []
    for bucket in buckets or []:
        start_str = bucket.get("bucketStartDate")
        price_str = bucket.get("marketPrice")
        if not start_str or price_str is None:
            continue
        start_date = _to_date(start_str)
        if not start_date:
            continue
        try:
            price = float(str(price_str).replace(",", ""))
        except ValueError:
            continue
        if price <= 0:
            continue
        bucket_items.append({"start": start_date, "price": price})

    if not bucket_items:
        return []

    bucket_items.sort(key=lambda x: x["start"])

    expanded = []
    for idx, bucket in enumerate(bucket_items):
        start = bucket["start"]
        if idx + 1 < len(bucket_items):
            end = bucket_items[idx + 1]["start"] - timedelta(days=1)
        else:
            end = start  # Last bucket: assume single day to avoid overfill

        if target_start and end < target_start:
            continue
        if target_end and start > target_end:
            continue

        if target_start:
            start = max(start, target_start)
        if target_end:
            end = min(end, target_end)
        if end < start:
            continue

        current = start
        while current <= end:
            expanded.append({
                "date": current.strftime("%Y-%m-%d"),
                "price": bucket["price"],
            })
            current += timedelta(days=1)

    return expanded


def extract_historical_prices_api(product_id, referer=None, preferred_variant=None, preferred_language=None,
                                  target_start_date=None, target_end_date=None, session=None):
    """
    Fetch historical prices from TCGPlayer's infinite-api and expand bucketed data to daily prices.
    Returns list of dicts with {date, price}.
    """
    if not product_id:
        return []

    session = session or _create_session()

    deduped = {}

    for range_config in API_RANGE_CONFIG:
        data = None
        used_key = None
        for key in range_config["keys"]:
            data = fetch_price_history_json(
                session=session,
                product_id=product_id,
                range_key=key,
                referer=referer,
                timeout=RATE_LIMIT_CONFIG['timeout'],
            )
            if data:
                used_key = key
                break

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
        expanded = expand_buckets_to_daily(
            buckets=buckets,
            target_start_date=target_start_date,
            target_end_date=target_end_date,
        )

        for entry in expanded:
            if entry["date"] not in deduped:
                deduped[entry["date"]] = entry

        logger.debug(
            f"API {range_config['label']} ({used_key}) -> "
            f"{len(expanded)} daily entries (deduped total: {len(deduped)})"
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


def fetch_existing_price_dates(product_id, start_date, end_date, batch_size=500):
    """
    Fetch existing price history dates for a product using pagination.
    Returns a set of date strings (YYYY-MM-DD format).
    """
    existing_dates = set()
    offset = 0

    while True:
        response = supabase.table("product_price_history")\
            .select("recorded_at")\
            .eq("product_id", product_id)\
            .gte("recorded_at", f"{start_date} 00:00:00")\
            .lte("recorded_at", f"{end_date} 23:59:59")\
            .range(offset, offset + batch_size - 1)\
            .execute()

        if not response.data:
            break

        for record in response.data:
            recorded_at = record.get('recorded_at', '')
            if recorded_at:
                # Handle both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SS" formats
                date_str = recorded_at.split(' ')[0].split('T')[0]
                existing_dates.add(date_str)

        if len(response.data) < batch_size:
            break  # Last page

        offset += batch_size

    return existing_dates


def batch_insert_price_history(entries, batch_size=100):
    """
    Insert price history entries in batches to avoid N+1 query pattern.
    Duplicates are prevented at the application level by filtering existing dates.
    Returns tuple of (inserted_count, failed_count).
    """
    inserted_count = 0
    failed_count = 0

    for i in range(0, len(entries), batch_size):
        batch = entries[i:i + batch_size]
        try:
            supabase.table("product_price_history").insert(batch).execute()
            inserted_count += len(batch)
            logger.debug(f"Batch inserted {len(batch)} records")
        except Exception as e:
            logger.error(f"Batch insert failed: {e}")
            # Fall back to individual inserts for this batch
            for entry in batch:
                try:
                    supabase.table("product_price_history").insert(entry).execute()
                    inserted_count += 1
                except Exception as inner_e:
                    logger.error(f"Individual insert failed for {entry.get('recorded_at', 'unknown')}: {inner_e}")
                    failed_count += 1

    return inserted_count, failed_count


def backfill_prices(start_idx=None, end_idx=None, reverse=False, days=365, checkpoint_file=None):
    """
    Main function to backfill historical prices for all products with robust error handling
    Checks for last N days of data, accounting for product release dates

    Args:
        start_idx: Starting product index (0-based, inclusive)
        end_idx: Ending product index (exclusive)
        reverse: If True, process products in reverse order
        days: Number of days to backfill (default: 365, max supported by TCGPlayer)
        checkpoint_file: Path to checkpoint file for resume capability
    """
    # Validate days parameter
    if days > 365:
        logger.warning(f"TCGPlayer only supports up to 365 days of history. Adjusting from {days} to 365.")
        days = 365

    utc_now = datetime.now(timezone.utc).date()
    yesterday = utc_now - timedelta(days=1)
    days_ago = yesterday - timedelta(days=days)

    target_end_date = yesterday.strftime("%Y-%m-%d")
    target_start_date = days_ago.strftime("%Y-%m-%d")

    logger.info(f"Starting historical price backfill for last {days} days")
    logger.info(f"Browser profile: {ACTIVE_PROFILE['User-Agent'][:60]}...")
    logger.info(f"Using UTC timezone - End date: {target_end_date} (yesterday)")
    logger.info(f"Date range: {target_start_date} to {target_end_date}")

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

    products_processed = 0
    session_product_count = 0
    api_session = None

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

            # === Calculate the actual start date based on release date ===
            product_start_date = target_start_date
            release_date = None

            if release_date_str:
                try:
                    # Parse release date (handle various formats)
                    if 'T' in release_date_str:
                        release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
                    else:
                        release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

                    # Use the later of: (N days ago) or (release date)
                    n_days_ago_date = datetime.strptime(target_start_date, "%Y-%m-%d").date()
                    if release_date > n_days_ago_date:
                        product_start_date = release_date.strftime("%Y-%m-%d")
                        logger.info(f"   Product released {release_date}, expecting data from {product_start_date}")
                    elif release_date > datetime.strptime(target_end_date, "%Y-%m-%d").date():
                        logger.info(f"   Skipping - product released {release_date} (after target range)")
                        checkpoint.mark_processed(product_id)
                        checkpoint.update_stats(skipped=1)
                        continue
                except Exception as e:
                    logger.warning(f"   Could not parse release_date '{release_date_str}': {e}")

            # === Check if this product already has COMPLETE data for ALL days in expected range ===
            try:
                # Use paginated query to handle products with many price records
                existing_dates = fetch_existing_price_dates(product_id, product_start_date, target_end_date)

                # Calculate expected number of days based on product's actual date range
                start_dt = datetime.strptime(product_start_date, "%Y-%m-%d").date()
                end_dt = datetime.strptime(target_end_date, "%Y-%m-%d").date()
                expected_days = (end_dt - start_dt).days + 1

                # Check if we have all days
                if len(existing_dates) >= expected_days:
                    logger.info(f"   Skipping - already has complete data ({len(existing_dates)}/{expected_days} days)")
                    checkpoint.mark_processed(product_id)
                    checkpoint.update_stats(skipped=1)
                    continue
                elif len(existing_dates) > 0:
                    logger.info(f"   Has partial data ({len(existing_dates)}/{expected_days} days) - will fill missing dates")
            except Exception as e:
                logger.warning(f"   Error checking existing data: {e}")
                existing_dates = set()
                # Continue with API fetch if check fails

            # === Retry logic for API fetch ===
            historical_data = None
            for attempt in range(1, RATE_LIMIT_CONFIG['max_retries'] + 1):
                try:
                    # Apply rate limiting before request
                    rate_limiter.wait()

                    logger.debug(
                        f"   Fetching historical prices via API (attempt {attempt}/{RATE_LIMIT_CONFIG['max_retries']})..."
                    )

                    historical_data = extract_historical_prices_api(
                        product_id=tcgplayer_product_id,
                        referer=url,
                        preferred_variant=variant,
                        preferred_language=preferred_language,
                        target_start_date=product_start_date,
                        target_end_date=target_end_date,
                        session=api_session,
                    )

                    if historical_data:
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

            if not historical_data:
                logger.error(f"   Failed to extract data for product {product_id} after {RATE_LIMIT_CONFIG['max_retries']} attempts")
                checkpoint.mark_failed(product_id)
                checkpoint.update_stats(failed=1)
                continue

            # Filter to only dates in our target range (respecting release date)
            filtered_data = [
                entry for entry in historical_data
                if product_start_date <= entry['date'] <= target_end_date
            ]

            if not filtered_data:
                logger.info(f"   No data in target date range for product {product_id}")
                checkpoint.mark_processed(product_id)
                checkpoint.update_stats(skipped=1)
                continue

            # Filter out dates that already exist
            new_entries = [entry for entry in filtered_data if entry['date'] not in existing_dates]

            if not new_entries:
                logger.info(f"   All {len(filtered_data)} dates already exist for product {product_id}")
                checkpoint.mark_processed(product_id)
                checkpoint.update_stats(skipped=1)
                continue

            logger.info(f"   Inserting {len(new_entries)} new prices (skipping {len(filtered_data) - len(new_entries)} existing)...")

            # Prepare batch entries
            batch_entries = [
                {
                    "product_id": product_id,
                    "usd_price": entry['price'],
                    "recorded_at": f"{entry['date']} 12:00:00"  # Use noon as timestamp
                }
                for entry in new_entries
            ]

            # Batch insert
            inserted_count, failed_count = batch_insert_price_history(batch_entries)

            if failed_count > 0:
                logger.warning(f"   Inserted {inserted_count} records, {failed_count} failed for product {product_id}")
                checkpoint.update_stats(inserted=inserted_count, failed=failed_count)
            else:
                logger.info(f"   Inserted {inserted_count} new records for product {product_id}")
                checkpoint.update_stats(inserted=inserted_count)

            # Mark as successfully processed
            checkpoint.mark_processed(product_id)
            products_processed += 1

    except KeyboardInterrupt:
        logger.info("\n\nInterrupted by user. Progress saved to checkpoint.")
        logger.info(f"Resume with: python backfill_historical_prices.py --resume {checkpoint.checkpoint_file}")

    finally:
        if api_session:
            try:
                api_session.close()
            except Exception:
                pass

    # Print final statistics
    stats = checkpoint.data['stats']
    logger.info("="*60)
    logger.info("Backfill Complete!")
    logger.info(f"  Total inserted: {stats['total_inserted']} price records")
    logger.info(f"  Total skipped:  {stats['total_skipped']} products")
    logger.info(f"  Total failed:   {stats['total_failed']} operations")
    logger.info(f"  Checkpoint:     {checkpoint.checkpoint_file}")
    logger.info("="*60)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill 365 days of historical price data from TCGPlayer (automatic)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process all products (default):
  python backfill_historical_prices.py

  # Run forward direction (first half):
  python backfill_historical_prices.py --forward

  # Run reverse direction (second half):
  python backfill_historical_prices.py --reverse

  # Run both in parallel for maximum speed:
  Terminal 1: python backfill_historical_prices.py --forward
  Terminal 2: python backfill_historical_prices.py --reverse

  # Resume from checkpoint:
  python backfill_historical_prices.py --resume checkpoint_20250109_143022.json

  # Enable debug logging:
  python backfill_historical_prices.py --debug
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

    # Always use maximum 365 days
    days = 365

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

    backfill_prices(
        start_idx=start_idx,
        end_idx=end_idx,
        reverse=reverse,
        days=days,
        checkpoint_file=args.resume
    )
