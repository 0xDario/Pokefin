#!/usr/bin/env python3
"""
Enhanced script to backfill historical price data from TCGPlayer
Automatically scrapes 365 days (max) of price history with intelligent rate limiting

Features:
- Multi-timeframe scraping (1M, 3M, 6M, 1Y) for maximum data coverage
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
import shutil
import time
import random
import json
from datetime import datetime, timedelta, timezone
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import TimeoutException, WebDriverException
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
import tempfile
import os
import platform

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
    'session_recycle_after': 50,  # Recycle browser session after N products
    'max_retries': 3,        # Maximum retry attempts per product
    'retry_backoff_base': 2, # Base for exponential backoff (seconds)
    'timeout': 20,           # Page load timeout (seconds)
}

# Rotating user agents to avoid detection
USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# Timeframe buttons to click (in order from shortest to longest)
# This allows us to gather comprehensive historical data
# TCGPlayer only has: 1M, 3M, 6M, 1Y (maximum 365 days of history)
# Data granularity:
#   - 1M: Daily price points (most granular, ~30 days)
#   - 3M: Every 3 days (~90 days)
#   - 6M: Weekly basis (~180 days)
#   - 1Y: Weekly basis (~365 days)
# We extract from all timeframes and deduplicate, preferring shorter timeframes (more granular)
TIMEFRAME_BUTTONS = ['1M', '3M', '6M', '1Y']

# === Checkpoint Management ===
class CheckpointManager:
    """Manages checkpoints for resuming interrupted scraping runs"""

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

# === Selenium Driver Setup ===
def create_driver(user_agent=None):
    """
    Create a Selenium WebDriver with bot detection evasion settings.
    Returns tuple of (driver, user_data_dir) for proper cleanup.
    """
    options = Options()

    # Set Chrome binary location based on OS
    system = platform.system()
    if system == "Linux":
        options.binary_location = "/usr/bin/google-chrome"
    elif system == "Darwin":  # macOS
        mac_chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for path in mac_chrome_paths:
            if os.path.exists(path):
                options.binary_location = path
                break

    # Use provided user agent or pick random one
    ua = user_agent or random.choice(USER_AGENTS)

    # Bot detection evasion settings
    options.add_argument("--headless=new")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument(f"user-agent={ua}")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-extensions")

    user_data_dir = os.path.join(tempfile.gettempdir(), f"chrome_scraper_{int(time.time())}_{os.getpid()}")
    options.add_argument(f"--user-data-dir={user_data_dir}")
    options.add_argument("--disable-background-timer-throttling")

    # Set page load timeout
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.set_page_load_timeout(RATE_LIMIT_CONFIG['timeout'])
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    logger.debug(f"Created driver with user agent: {ua[:50]}...")
    return driver, user_data_dir


def cleanup_driver(driver, user_data_dir):
    """Properly cleanup WebDriver and temporary directory."""
    try:
        if driver:
            driver.quit()
    except Exception as e:
        logger.warning(f"Error quitting driver: {e}")

    try:
        if user_data_dir and os.path.exists(user_data_dir):
            shutil.rmtree(user_data_dir, ignore_errors=True)
            logger.debug(f"Cleaned up temp directory: {user_data_dir}")
    except Exception as e:
        logger.warning(f"Error cleaning up temp directory: {e}")

def extract_historical_prices(driver, url, timeframes=None):
    """
    Navigate to product page, extract historical price data from multiple timeframes
    Returns list of dicts with {date, price}

    Args:
        driver: Selenium WebDriver instance
        url: Product URL to scrape
        timeframes: List of timeframe buttons to click (e.g., ['1M', '3M', '6M', '1Y', '3Y'])
                   If None, uses TIMEFRAME_BUTTONS global
    """
    if timeframes is None:
        timeframes = TIMEFRAME_BUTTONS

    try:
        logger.debug(f"Loading page: {url}")
        driver.get(url)

        # Wait for page to load
        wait = WebDriverWait(driver, RATE_LIMIT_CONFIG['timeout'])

        # Wait for the chart section to appear
        logger.debug("Waiting for chart section to load...")
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
        time.sleep(3)  # Extra time for chart to render

        all_historical_data = []
        successful_timeframes = []

        # Extract data from each timeframe
        for timeframe in timeframes:
            try:
                logger.debug(f"Extracting {timeframe} data...")

                # Click the timeframe button
                button_clicked = False
                buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
                for button in buttons:
                    if timeframe in button.text.strip():
                        logger.debug(f"Clicking {timeframe} button...")
                        button.click()
                        time.sleep(3)  # Wait for chart to update
                        button_clicked = True
                        break

                if not button_clicked:
                    logger.warning(f"Could not find {timeframe} button, skipping...")
                    continue

                # Determine if this timeframe uses date ranges or single dates
                # Longer timeframes (6M+) typically use date ranges
                is_date_range = timeframe in ['6M', '1Y']

                # Extract data for this timeframe
                timeframe_data = extract_canvas_table_data(driver, is_date_range=is_date_range)
                all_historical_data.extend(timeframe_data)
                successful_timeframes.append(timeframe)
                logger.debug(f"Extracted {len(timeframe_data)} entries from {timeframe} data")

            except Exception as e:
                logger.warning(f"Error extracting {timeframe} data: {e}")
                continue

        # Deduplicate: prefer data from shorter timeframes (more granular)
        # Since we process from shortest to longest, later entries will overwrite earlier ones
        # We reverse to process longest to shortest, so shortest wins
        deduplicated = {}
        for entry in reversed(all_historical_data):  # Reverse so shortest timeframe wins
            date = entry['date']
            if date not in deduplicated:  # Keep first occurrence (from shortest timeframe)
                deduplicated[date] = entry

        final_data = list(deduplicated.values())

        duplicates_removed = len(all_historical_data) - len(final_data)
        if duplicates_removed > 0:
            logger.debug(f"Removed {duplicates_removed} duplicate dates (kept data from shorter timeframes)")

        if successful_timeframes:
            logger.debug(f"Successfully extracted from timeframes: {', '.join(successful_timeframes)}")

        return final_data

    except TimeoutException:
        logger.error(f"Timeout loading page: {url}")
        return []
    except WebDriverException as e:
        logger.error(f"WebDriver error: {e}")
        return []
    except Exception as e:
        logger.error(f"Error extracting historical prices: {e}")
        return []


def extract_canvas_table_data(driver, is_date_range=False):
    """
    Extract data from canvas table
    is_date_range: True for 3M data (e.g., "11/5 to 11/7"), False for 1M data (e.g., "2025-11-08")
    Returns list of dicts with {date, price}
    """
    historical_data = []

    try:
        canvas_elements = driver.find_elements(By.CSS_SELECTOR, "canvas")

        for canvas in canvas_elements:
            try:
                tables = canvas.find_elements(By.TAG_NAME, "table")

                for table in tables:
                    tbody = table.find_element(By.TAG_NAME, "tbody")
                    rows = tbody.find_elements(By.TAG_NAME, "tr")

                    for row in rows:
                        cells = row.find_elements(By.TAG_NAME, "td")
                        if len(cells) >= 2:
                            # Extract text using multiple methods
                            date_str = cells[0].text.strip()
                            if not date_str:
                                date_str = cells[0].get_attribute('innerText')
                            if not date_str:
                                date_str = cells[0].get_attribute('textContent')
                            if date_str:
                                date_str = date_str.strip()

                            price_str = cells[1].text.strip()
                            if not price_str:
                                price_str = cells[1].get_attribute('innerText')
                            if not price_str:
                                price_str = cells[1].get_attribute('textContent')
                            if price_str:
                                price_str = price_str.strip().replace("$", "").replace(",", "")

                            try:
                                price = float(price_str)

                                if is_date_range:
                                    # Parse date range format: "11/5 to 11/7"
                                    if " to " in date_str:
                                        # Extract the dates from range
                                        date_parts = date_str.split(" to ")
                                        if len(date_parts) == 2:
                                            start_date_str = date_parts[0].strip()
                                            end_date_str = date_parts[1].strip()

                                            # Parse dates (format: "11/5")
                                            start_date = parse_short_date(start_date_str)
                                            end_date = parse_short_date(end_date_str)

                                            if start_date and end_date:
                                                # Assign the average price to each day in the range
                                                current_date = start_date
                                                while current_date <= end_date:
                                                    historical_data.append({
                                                        'date': current_date.strftime("%Y-%m-%d"),
                                                        'price': price
                                                    })
                                                    current_date += timedelta(days=1)
                                else:
                                    # Parse single date format: "2025-11-08"
                                    if "-" in date_str and len(date_str) == 10:
                                        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                                        historical_data.append({
                                            'date': date_obj.strftime("%Y-%m-%d"),
                                            'price': price
                                        })

                            except (ValueError, IndexError) as e:
                                logger.debug(f"Could not parse price/date: {e}")
                                continue

                    if historical_data:
                        break  # Found data, no need to check other tables

            except Exception as e:
                logger.debug(f"Canvas parsing error: {e}")
                continue

    except Exception as e:
        logger.warning(f"Error extracting canvas table data: {e}")

    return historical_data


def parse_short_date(date_str):
    """
    Parse short date format like "11/5" to a datetime object.
    Uses dynamic year logic based on current date to handle year boundaries.

    Logic: Try current year first. If the resulting date is more than 7 days
    in the future, assume it's from the previous year. This handles edge cases
    like running in January for December dates.
    """
    try:
        parts = date_str.split("/")
        if len(parts) == 2:
            month = int(parts[0])
            day = int(parts[1])

            now = datetime.now(timezone.utc)
            current_year = now.year

            # Try current year first
            candidate_date = datetime(current_year, month, day, tzinfo=timezone.utc)

            # If the date is more than 7 days in the future, use previous year
            # This handles year boundary edge cases naturally
            if candidate_date > now + timedelta(days=7):
                candidate_date = datetime(current_year - 1, month, day, tzinfo=timezone.utc)

            # Return naive datetime to maintain compatibility
            return candidate_date.replace(tzinfo=None)
    except (ValueError, IndexError) as e:
        logger.debug(f"Could not parse short date '{date_str}': {e}")

    return None

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

    driver = None
    user_data_dir = None
    products_processed = 0
    session_product_count = 0

    try:
        # Create initial driver
        driver, user_data_dir = create_driver()
        logger.info("Browser session started")

        for idx, product in enumerate(products_to_process, 1):
            product_id = product["id"]
            url = product["url"]
            variant = product.get("variant")

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
                logger.info(f"Recycling browser session (processed {session_product_count} products)")
                cleanup_driver(driver, user_data_dir)
                time.sleep(random.uniform(3, 7))  # Random delay before new session
                driver, user_data_dir = create_driver()  # New user agent each time
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
                # Continue with scraping if check fails

            # === Retry logic for scraping ===
            historical_data = None
            for attempt in range(1, RATE_LIMIT_CONFIG['max_retries'] + 1):
                try:
                    # Apply rate limiting before request
                    rate_limiter.wait()

                    logger.debug(f"   Extracting historical prices (attempt {attempt}/{RATE_LIMIT_CONFIG['max_retries']})...")
                    historical_data = extract_historical_prices(driver, url)

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

                except (TimeoutException, WebDriverException) as e:
                    logger.warning(f"   Browser error on attempt {attempt}: {e}")
                    rate_limiter.record_error()

                    if attempt < RATE_LIMIT_CONFIG['max_retries']:
                        # Try recycling the session if there's a browser error
                        try:
                            cleanup_driver(driver, user_data_dir)
                            time.sleep(random.uniform(2, 5))
                            driver, user_data_dir = create_driver()
                            session_product_count = 0
                        except Exception as driver_e:
                            logger.error(f"   Failed to recycle driver: {driver_e}")
                    continue

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
        cleanup_driver(driver, user_data_dir)

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
