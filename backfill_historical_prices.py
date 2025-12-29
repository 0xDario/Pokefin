#!/usr/bin/env python3
"""
One-time script to backfill historical price data from TCGPlayer
Clicks the 1M button and extracts canvas table data for Nov 5 - Dec 6

Usage:
  # Run forward (products 0-499):
  python backfill_historical_prices.py --forward

  # Run reverse (products 999-500):
  python backfill_historical_prices.py --reverse

  # Run both in parallel (two terminals):
  Terminal 1: python backfill_historical_prices.py --forward
  Terminal 2: python backfill_historical_prices.py --reverse

  # Custom range:
  python backfill_historical_prices.py --start 0 --end 500
  python backfill_historical_prices.py --start 500 --end 1000 --reverse
"""
import argparse
import time
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
import tempfile
import os
import platform

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Selenium Driver Setup ===
def create_driver():
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

    # Bot detection evasion settings
    options.add_argument("--headless=new")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument("user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
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

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    return driver

def extract_historical_prices(driver, url):
    """
    Navigate to product page, extract both 1M and 3M historical price data
    Returns list of dicts with {date, price}
    """
    try:
        driver.get(url)

        # Wait for page to load
        wait = WebDriverWait(driver, 15)

        # Wait for the chart section to appear
        print(f"   ⏳ Waiting for chart section to load...")
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
        time.sleep(3)  # Extra time for chart to render

        all_historical_data = []

        # === STEP 1: Extract 3M data first (for Nov 5-7) ===
        print(f"   📊 Extracting 3M data (date ranges)...")

        # 3M might be default, but let's try to click it to be sure
        try:
            buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
            for button in buttons:
                if "3M" in button.text.strip():
                    print(f"   🖱️  Clicking 3M button...")
                    button.click()
                    time.sleep(3)
                    break
        except Exception as e:
            print(f"   ⚠️  Could not click 3M button, using default view: {e}")

        # Extract 3M data (date ranges)
        three_month_data = extract_canvas_table_data(driver, is_date_range=True)
        all_historical_data.extend(three_month_data)
        print(f"   ✅ Extracted {len(three_month_data)} entries from 3M data")

        # === STEP 2: Click 1M button and extract daily data ===
        print(f"   📊 Extracting 1M data (daily prices)...")

        try:
            buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
            for button in buttons:
                if "1M" in button.text.strip():
                    print(f"   🖱️  Clicking 1M button...")
                    button.click()
                    time.sleep(3)
                    break
        except Exception as e:
            print(f"   ⚠️  Error clicking 1M button: {e}")

        # Extract 1M data (daily)
        one_month_data = extract_canvas_table_data(driver, is_date_range=False)
        all_historical_data.extend(one_month_data)
        print(f"   ✅ Extracted {len(one_month_data)} entries from 1M data")

        # Deduplicate: prefer 1M data (daily) over 3M data (range averages) for same dates
        # Build a dict with date as key, keeping the last occurrence (1M data comes last)
        deduplicated = {}
        for entry in all_historical_data:
            date = entry['date']
            # If date already exists, the later entry (1M) will overwrite the earlier one (3M)
            deduplicated[date] = entry

        final_data = list(deduplicated.values())

        duplicates_removed = len(all_historical_data) - len(final_data)
        if duplicates_removed > 0:
            print(f"   🔄 Removed {duplicates_removed} duplicate dates (kept 1M data over 3M)")

        return final_data

    except Exception as e:
        print(f"   ❌ Error extracting historical prices: {e}")
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
                                            # Assuming year is 2025 for November dates
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
                                continue

                    if historical_data:
                        break  # Found data, no need to check other tables

            except Exception as e:
                continue

    except Exception as e:
        pass

    return historical_data


def parse_short_date(date_str):
    """
    Parse short date format like "11/5" to a datetime object
    Assumes year 2025 for November dates, 2024 for September/October
    """
    try:
        parts = date_str.split("/")
        if len(parts) == 2:
            month = int(parts[0])
            day = int(parts[1])

            # Determine year based on month
            # Nov-Dec = 2025, Sep-Oct = 2024 (based on the 3M data you showed)
            if month >= 11:  # November, December
                year = 2025
            else:  # September, October
                year = 2024

            return datetime(year, month, day)
    except (ValueError, IndexError):
        pass

    return None

def backfill_prices(start_idx=None, end_idx=None, reverse=False, days=90):
    """
    Main function to backfill historical prices for all products
    Checks for last N days of data, accounting for product release dates

    Args:
        start_idx: Starting product index (0-based, inclusive)
        end_idx: Ending product index (exclusive)
        reverse: If True, process products in reverse order
        days: Number of days to backfill (default: 90)
    """
    # Calculate date range
    # Use UTC and set end date to yesterday (today's data might not be available yet)
    from datetime import timezone

    utc_now = datetime.now(timezone.utc).date()
    yesterday = utc_now - timedelta(days=1)
    days_ago = yesterday - timedelta(days=days)

    target_end_date = yesterday.strftime("%Y-%m-%d")
    target_start_date = days_ago.strftime("%Y-%m-%d")

    print(f"🚀 Starting historical price backfill for last {days} days")
    print(f"   Using UTC timezone - End date: {target_end_date} (yesterday)")
    print(f"   Date range: {target_start_date} to {target_end_date}\n")

    # Get all products from database, joining with sets to get release_date
    # Use range(0, 10000) to override Supabase's default 1000 row limit
    response = supabase.table("products").select("id, url, variant, set_id, sets(release_date)").range(0, 9999).execute()
    all_products = response.data

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

    print(f"📦 Found {len(products)} products to process{range_info} [{direction}]\n")

    driver = create_driver()

    total_inserted = 0

    for idx, product in enumerate(products, 1):
        product_id = product["id"]
        url = product["url"]
        variant = product.get("variant")

        # Get release_date from the joined sets table
        release_date_str = None
        sets_data = product.get("sets")
        if sets_data and isinstance(sets_data, dict):
            release_date_str = sets_data.get("release_date")

        variant_info = f" (Variant: {variant})" if variant else ""
        print(f"[{idx}/{len(products)}] 🔍 Checking product ID {product_id}{variant_info}...")

        # === Calculate the actual start date based on release date ===
        # Don't expect price data before the product was released
        product_start_date = target_start_date
        release_date = None

        if release_date_str:
            try:
                # Parse release date (handle various formats)
                if 'T' in release_date_str:
                    release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
                else:
                    release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

                # Use the later of: (90 days ago) or (release date)
                ninety_days_ago_date = datetime.strptime(target_start_date, "%Y-%m-%d").date()
                if release_date > ninety_days_ago_date:
                    product_start_date = release_date.strftime("%Y-%m-%d")
                    print(f"   📅 Product released {release_date}, expecting data from {product_start_date}")
                elif release_date > datetime.strptime(target_end_date, "%Y-%m-%d").date():
                    print(f"   ⏭️  Skipping - product released {release_date} (after target range)\n")
                    continue
            except Exception as e:
                print(f"   ⚠️  Could not parse release_date '{release_date_str}': {e}")

        # === Check if this product already has COMPLETE data for ALL days in expected range ===
        try:
            existing_records = supabase.table("product_price_history")\
                .select("recorded_at")\
                .eq("product_id", product_id)\
                .gte("recorded_at", f"{product_start_date} 00:00:00")\
                .lte("recorded_at", f"{target_end_date} 23:59:59")\
                .execute()

            # Build set of existing dates
            existing_dates = set()
            if existing_records.data:
                for record in existing_records.data:
                    # Extract date portion from timestamp
                    recorded_at = record.get('recorded_at', '')
                    if recorded_at:
                        # Handle both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SS" formats
                        date_str = recorded_at.split(' ')[0].split('T')[0]
                        existing_dates.add(date_str)

            # Calculate expected number of days based on product's actual date range
            start_dt = datetime.strptime(product_start_date, "%Y-%m-%d").date()
            end_dt = datetime.strptime(target_end_date, "%Y-%m-%d").date()
            expected_days = (end_dt - start_dt).days + 1

            # Check if we have all days
            if len(existing_dates) >= expected_days:
                print(f"   ⏭️  Skipping - already has complete data ({len(existing_dates)}/{expected_days} days)\n")
                continue
            elif len(existing_dates) > 0:
                print(f"   ⚠️  Has partial data ({len(existing_dates)}/{expected_days} days) - will fill missing dates")
        except Exception as e:
            print(f"   ⚠️  Error checking existing data: {e}")
            existing_dates = set()
            # Continue with scraping if check fails

        print(f"   📊 Extracting historical prices...")

        # Extract historical data
        historical_data = extract_historical_prices(driver, url)

        if not historical_data:
            print(f"   ⚠️  No historical data found for product {product_id}")
            continue

        # Filter to only dates in our target range (respecting release date)
        filtered_data = [
            entry for entry in historical_data
            if product_start_date <= entry['date'] <= target_end_date
        ]

        if not filtered_data:
            print(f"   ℹ️  No data in target date range for product {product_id}")
            continue

        # Filter out dates that already exist
        new_entries = [entry for entry in filtered_data if entry['date'] not in existing_dates]

        if not new_entries:
            print(f"   ℹ️  All {len(filtered_data)} dates already exist for product {product_id}\n")
            continue

        print(f"   📥 Inserting {len(new_entries)} new prices (skipping {len(filtered_data) - len(new_entries)} existing)...")

        # Insert only new dates
        inserted_count = 0
        for entry in new_entries:
            try:
                # Insert the historical price
                supabase.table("product_price_history").insert({
                    "product_id": product_id,
                    "usd_price": entry['price'],
                    "recorded_at": f"{entry['date']} 12:00:00"  # Use noon as timestamp (no timezone)
                }).execute()

                inserted_count += 1
                print(f"      ✅ Inserted {entry['date']}: ${entry['price']:.2f}")

            except Exception as e:
                print(f"      ❌ Error inserting {entry['date']}: {e}")

        total_inserted += inserted_count
        print(f"   ✅ Inserted {inserted_count} new records for product {product_id}\n")

        # Polite delay between products
        time.sleep(2)

    driver.quit()

    print(f"\n🎉 Backfill complete! Inserted {total_inserted} total historical price records.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill historical price data from TCGPlayer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run forward (first half of products):
  python backfill_historical_prices.py --forward

  # Run reverse (second half of products):
  python backfill_historical_prices.py --reverse

  # Run both in parallel (open two terminals):
  Terminal 1: python backfill_historical_prices.py --forward
  Terminal 2: python backfill_historical_prices.py --reverse

  # Custom range with direction:
  python backfill_historical_prices.py --start 0 --end 300
  python backfill_historical_prices.py --start 300 --end 600 --reverse

  # Process all products (no parallelization):
  python backfill_historical_prices.py --all
        """
    )

    parser.add_argument("--forward", action="store_true",
                        help="Process first half of products in forward order (indices 0 to midpoint)")
    parser.add_argument("--reverse", action="store_true",
                        help="Process second half of products in reverse order (indices midpoint to end)")
    parser.add_argument("--all", action="store_true",
                        help="Process all products (default behavior, no split)")
    parser.add_argument("--start", type=int, default=None,
                        help="Starting product index (0-based, inclusive)")
    parser.add_argument("--end", type=int, default=None,
                        help="Ending product index (exclusive)")
    parser.add_argument("--days", type=int, default=90,
                        help="Number of days to backfill (default: 90)")

    args = parser.parse_args()

    # Determine range based on flags
    if args.forward or args.reverse:
        # Get total product count first to calculate midpoint
        response = supabase.table("products").select("id", count="exact").execute()
        total_count = response.count or len(response.data)
        midpoint = total_count // 2

        if args.forward:
            # First half, forward order
            start_idx = args.start if args.start is not None else 0
            end_idx = args.end if args.end is not None else midpoint
            reverse = False
            print(f"🔀 FORWARD MODE: Processing products {start_idx} to {end_idx-1}")
        else:  # args.reverse
            # Second half, reverse order
            start_idx = args.start if args.start is not None else midpoint
            end_idx = args.end if args.end is not None else total_count
            reverse = True
            print(f"🔄 REVERSE MODE: Processing products {end_idx-1} down to {start_idx}")
    elif args.start is not None or args.end is not None:
        # Custom range specified
        start_idx = args.start
        end_idx = args.end
        reverse = False
    else:
        # Default: process all
        start_idx = None
        end_idx = None
        reverse = False

    backfill_prices(start_idx=start_idx, end_idx=end_idx, reverse=reverse, days=args.days)
