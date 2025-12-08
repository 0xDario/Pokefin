import time
import requests
from datetime import datetime, timedelta, timezone
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import warnings
from urllib3.exceptions import NotOpenSSLWarning
import uuid

# === Silence SSL warning from urllib3 ===
warnings.simplefilter("ignore", NotOpenSSLWarning)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Selenium Driver Setup ===
def create_driver():
    import tempfile
    import os
    import platform
    import time
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager

    options = Options()
    
    # Set Chrome binary location based on OS
    system = platform.system()
    if system == "Linux":
        options.binary_location = "/usr/bin/google-chrome"
    elif system == "Darwin":  # macOS
        # Common Chrome locations on macOS
        mac_chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for path in mac_chrome_paths:
            if os.path.exists(path):
                options.binary_location = path
                break
    # Windows: webdriver-manager usually handles it automatically
    
    # Bot detection evasion settings
    options.add_argument("--headless=new")  # Use new headless mode
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)

    # Add realistic user agent
    options.add_argument("user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    # Standard options
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-extensions")

    # Optional: Unique user data dir
    user_data_dir = os.path.join(tempfile.gettempdir(), f"chrome_scraper_{int(time.time())}_{os.getpid()}")
    options.add_argument(f"--user-data-dir={user_data_dir}")
    options.add_argument("--disable-background-timer-throttling")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    # Hide webdriver property
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    return driver

# === Image Download and Upload Logic ===
def download_and_upload_image(image_url, product_id):
    """
    Download image from TCGPlayer and upload to Supabase Storage
    Returns the public URL or None if failed
    """
    try:
        # Generate unique filename
        file_extension = image_url.split('.')[-1].split('?')[0].lower()
        if file_extension not in ['jpg', 'jpeg', 'png', 'webp']:
            file_extension = 'jpg'
        
        filename = f"products/{product_id}_{uuid.uuid4().hex[:8]}.{file_extension}"
        
        # Download image with proper headers
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        
        response = requests.get(image_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        # Check if response contains image data
        if len(response.content) < 1000:
            print(f"⚠️ Image too small, likely not valid: {len(response.content)} bytes")
            return None
        
        # Upload to Supabase Storage with updated API handling
        try:
            upload_response = supabase.storage.from_("product-images").upload(
                filename, 
                response.content,
                {
                    "content-type": f"image/{file_extension}",
                    "cache-control": "3600"
                }
            )
            
            # Handle different response formats
            upload_success = False
            if hasattr(upload_response, 'data') and upload_response.data:
                upload_success = True
            elif hasattr(upload_response, 'path') or (hasattr(upload_response, '__dict__') and 'path' in upload_response.__dict__):
                upload_success = True
            elif isinstance(upload_response, dict) and ('path' in upload_response or 'Key' in upload_response):
                upload_success = True
            
            if upload_success:
                # Get public URL
                try:
                    public_url_response = supabase.storage.from_("product-images").get_public_url(filename)
                    
                    # Handle different public URL response formats
                    public_url = None
                    if hasattr(public_url_response, 'data') and public_url_response.data:
                        public_url = public_url_response.data.get('publicUrl')
                    elif hasattr(public_url_response, 'publicUrl'):
                        public_url = public_url_response.publicUrl
                    elif isinstance(public_url_response, dict):
                        public_url = public_url_response.get('publicUrl')
                    elif isinstance(public_url_response, str):
                        public_url = public_url_response
                    
                    if public_url:
                        print(f"✅ Image uploaded: {public_url}")
                        return public_url
                    else:
                        print(f"❌ Failed to get public URL for {filename}")
                        print(f"   Public URL response: {public_url_response}")
                        return None
                        
                except Exception as url_error:
                    print(f"❌ Error getting public URL: {url_error}")
                    return None
            else:
                print(f"❌ Upload failed: {upload_response}")
                return None
                
        except Exception as upload_error:
            print(f"❌ Upload error: {upload_error}")
            return None
            
    except Exception as e:
        print(f"❌ Image upload error for product {product_id}: {e}")
        return None

# === Enhanced scraper with image extraction ===
def get_price_and_image_from_url(driver, url):
    """
    Extract both price and image URL from TCGPlayer product page
    Returns dict with 'price' and 'image_url' keys
    """
    try:
        driver.get(url)

        # Wait for the page to load - TCGPlayer uses client-side rendering
        # Wait up to 15 seconds for price section to appear
        wait = WebDriverWait(driver, 15)

        result = {'price': None, 'image_url': None}

        # === PRICE EXTRACTION ===
        # Updated for new TCGPlayer HTML structure (December 2025)
        # Try new structure first (span.price-points__upper__price)
        try:
            # Wait for price section to load (Vue.js renders this dynamically)
            price_section = wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "div[class*='price-points__upper']"))
            )
            rows = price_section.find_elements(By.TAG_NAME, "tr")

            label_to_price = {}
            for row in rows:
                row_text = row.text.strip().lower()

                # Check if this row contains Market Price
                if "market price" in row_text:
                    price_spans = row.find_elements(By.CSS_SELECTOR, "span[class*='price-points__upper__price']")
                    if price_spans:
                        price_text = price_spans[0].text.strip().replace("$", "").replace(",", "")
                        if price_text and price_text not in ("-", "", "N/A"):
                            label_to_price["market"] = price_text

                # Check if this row contains Most Recent Sale
                elif "most recent sale" in row_text:
                    price_spans = row.find_elements(By.CSS_SELECTOR, "span[class*='price-points__upper__price']")
                    if price_spans:
                        price_text = price_spans[0].text.strip().replace("$", "").replace(",", "")
                        if price_text and price_text not in ("-", "", "N/A"):
                            label_to_price["recent"] = price_text

            # Priority: Market > Most Recent Sale
            if "market" in label_to_price:
                try:
                    result['price'] = float(label_to_price["market"])
                except ValueError:
                    pass
            elif "recent" in label_to_price:
                try:
                    result['price'] = float(label_to_price["recent"])
                except ValueError:
                    pass
        except Exception as e:
            pass  # Silently fail and try fallback
            # Fallback: Try old structure for backwards compatibility
            try:
                rows = driver.find_elements(By.CSS_SELECTOR, "div[class*='price-points__upper'] tr")
                label_to_price = {}
                for row in rows:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) < 2:
                        continue
                    label = cells[0].text.strip().lower()
                    if "market price" in label:
                        price = cells[-1].text.strip().replace("$", "").replace(",", "")
                        label_to_price["market"] = price
                    elif "most recent sale" in label:
                        price = cells[-1].text.strip().replace("$", "").replace(",", "")
                        label_to_price["recent"] = price

                # Priority: Market > Most Recent Sale
                if "market" in label_to_price and label_to_price["market"] not in ("-", "", "N/A"):
                    try:
                        result['price'] = float(label_to_price["market"])
                    except ValueError:
                        pass
                elif "recent" in label_to_price and label_to_price["recent"] not in ("-", "", "N/A"):
                    try:
                        result['price'] = float(label_to_price["recent"])
                    except ValueError:
                        pass
            except Exception as fallback_error:
                print(f"   ⚠️ Price extraction failed: {fallback_error}")
        
        # === IMAGE EXTRACTION ===
        image_selectors = [
            "section[data-testid='imgProductDetailsMain'] img",
            "img[data-testid*='product-image']",
            ".image-set__grid img",
            ".image-set__main img",
            ".swiper img",
            ".swiper-slide img",
            ".lazy-image__wrapper img",
            "img[src*='tcgplayer-cdn.tcgplayer.com/product']",
        ]
        
        for selector in image_selectors:
            try:
                img_elements = driver.find_elements(By.CSS_SELECTOR, selector)
                
                for img in img_elements:
                    src = img.get_attribute('src')
                    if not src or not src.startswith('http'):
                        continue
                    
                    # Skip non-product images
                    skip_keywords = ['logo', 'icon', 'avatar', 'banner', 'header', 'footer', 'nav', 'gift-card']
                    if any(skip in src.lower() for skip in skip_keywords):
                        continue
                    
                    # For TCGPlayer CDN images, prefer higher resolution
                    if 'tcgplayer-cdn.tcgplayer.com/product' in src:
                        # Try to get the highest resolution from srcset
                        srcset = img.get_attribute('srcset')
                        if srcset:
                            # Parse srcset to get highest resolution
                            srcset_entries = srcset.split(',')
                            best_src = src
                            best_width = 0
                            
                            for entry in srcset_entries:
                                entry = entry.strip()
                                if ' ' in entry:
                                    url_part, width_part = entry.rsplit(' ', 1)
                                    try:
                                        width = int(width_part.replace('w', ''))
                                        if width > best_width:
                                            best_width = width
                                            best_src = url_part
                                    except ValueError:
                                        continue
                            
                            if best_width > 0:
                                result['image_url'] = best_src
                                break
                        
                        # Fallback to original src if no srcset
                        result['image_url'] = src
                        break
                    
                    # For non-CDN images, check if they look like product images
                    if any(keyword in src.lower() for keyword in ['product', 'card', 'item']):
                        result['image_url'] = src
                        break
                
                # If we found an image, stop trying other selectors
                if result['image_url']:
                    break
                    
            except Exception as e:
                continue
        
        return result

    except Exception as e:
        print(f"⚠️ Exception while scraping {url}: {e}")
        return {'price': None, 'image_url': None}

# === Helper function to parse timestamps safely ===
def parse_timestamp(timestamp_str):
    """Parse timestamp string and return timezone-aware datetime object"""
    if not timestamp_str:
        return None
    
    try:
        if timestamp_str.endswith('Z'):
            return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        elif '+' in timestamp_str or timestamp_str.endswith('+00:00'):
            return datetime.fromisoformat(timestamp_str)
        else:
            return datetime.fromisoformat(timestamp_str).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None

# === Main Logic ===
def fetch_and_store_exchange_rate():
    """
    Fetch the latest USD→CAD exchange rate from Bank of Canada
    and store it in Supabase (exchange_rates table).
    """
    try:
        print("🌐 Fetching USD→CAD exchange rate from Bank of Canada...")
        boc_url = "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/"
        response = requests.get(boc_url, timeout=10)
        response.raise_for_status()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, "html.parser")

        # Find the daily rates table
        table = soup.find("table", id="table_daily_1")
        if not table:
            raise ValueError("Could not find daily exchange rates table")

        # Extract column headers (dates)
        header_cells = table.find("thead").find_all("th")
        dates = [cell.get_text(strip=True) for cell in header_cells[1:]]  # skip "Currency" header

        # Find US Dollar row
        usd_row = table.find("th", string="US dollar").parent
        if not usd_row:
            raise ValueError("Could not find US Dollar row")

        # Find all rate cells for USD
        cells = usd_row.find_all("td")

        # Start from the right-most cell (newest date)
        rate = None
        rate_date = None
        for idx in reversed(range(len(cells))):
            cell_text = cells[idx].get_text(strip=True)
            if cell_text.lower() != "bank holiday" and cell_text != "":
                rate = float(cell_text)
                rate_date_str = dates[idx]
                rate_date = datetime.strptime(rate_date_str, "%Y‑%m‑%d")
                break

        if rate is None or rate_date is None:
            raise ValueError("Could not find a valid USD→CAD rate")

        print(f"✅ USD→CAD Rate: {rate} (as of {rate_date.date()})")

        # Insert into Supabase
        try:
            result = supabase.table("exchange_rates").insert({
                "usd_to_cad": rate,
                "recorded_at": rate_date.isoformat()
            }).execute()
            print("📥 Exchange rate stored in Supabase successfully.")
        except Exception as e:
            print(f"⚠️ Supabase insert failed: {e}")

    except Exception as e:
        print(f"❌ Failed to fetch or store exchange rate: {e}")


def update_prices():
    # Calculate timestamps in UTC
    # Update prices once per day (run at UTC midnight)
    price_update_interval_hours = 24
    price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=price_update_interval_hours)
    twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    
    # Get products that need updates (price OR image) - include variant in query
    response = supabase.table("products").select("id, url, image_url, last_updated, last_image_update, variant, set_id, product_type_id").or_(
        f"last_updated.lt.{price_interval_ago.isoformat()},image_url.is.null,last_image_update.is.null,last_image_update.lt.{twenty_four_hours_ago.isoformat()}"
    ).execute()

    products_to_update = response.data

    if not products_to_update:
        print("🚫 No products requiring updates (within time windows).")
        return

    print(f"📦 Found {len(products_to_update)} products to update")
    
    # Group products by type for logging
    products_by_type = {}
    for product in products_to_update:
        key = f"Set:{product['set_id']}-Type:{product['product_type_id']}"
        if product.get('variant'):
            key += f"-Variant:{product['variant']}"
        if key not in products_by_type:
            products_by_type[key] = 0
        products_by_type[key] += 1
    
    print("\n📊 Products to update by type:")
    for key, count in products_by_type.items():
        print(f"   - {key}: {count} products")
    
    driver = create_driver()
    updated_count = 0

    for product in products_to_update:
        product_id = product["id"]
        url = product["url"]
        current_image_url = product.get("image_url")
        last_updated = product.get("last_updated")
        last_image_update = product.get("last_image_update")
        variant = product.get("variant")

        variant_info = f" (Variant: {variant})" if variant else ""
        print(f"\n🔍 Scraping product ID {product_id}{variant_info}...")
        
        # Get both price and image
        scraped_data = get_price_and_image_from_url(driver, url)
        price = scraped_data.get('price')
        tcg_image_url = scraped_data.get('image_url')

        update_data = {}
        
        # Handle price update
        needs_price_update = True
        if last_updated:
            last_updated_dt = parse_timestamp(last_updated)
            if last_updated_dt:
                needs_price_update = last_updated_dt < price_interval_ago

        if price is not None and needs_price_update:
            update_data["usd_price"] = price
            update_data["last_updated"] = datetime.now(timezone.utc).isoformat()
            
            # Log price in history table
            try:
                supabase.table("product_price_history").insert({
                    "product_id": product_id,
                    "usd_price": price
                }).execute()
                print(f"   ✅ Updated price: ${price:.2f}")
            except Exception as e:
                print(f"   ⚠️ Price history insert failed: {e}")

        # Handle image update
        needs_image_update = True
        if current_image_url and last_image_update:
            last_image_update_dt = parse_timestamp(last_image_update)
            if last_image_update_dt:
                needs_image_update = last_image_update_dt < twenty_four_hours_ago

        if tcg_image_url and needs_image_update:
            if tcg_image_url != current_image_url:
                # Download and upload image to Supabase Storage
                uploaded_image_url = download_and_upload_image(tcg_image_url, product_id)
                
                if uploaded_image_url:
                    update_data["image_url"] = uploaded_image_url
                    update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                    print(f"   ✅ Updated image: {uploaded_image_url}")
                else:
                    # If upload fails, still store the TCGPlayer URL as fallback
                    update_data["image_url"] = tcg_image_url
                    update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                    print(f"   ⚠️ Using direct TCGPlayer image URL: {tcg_image_url}")
            else:
                # Same image URL, just update timestamp
                update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                print(f"   ✅ Image URL unchanged, updated timestamp")
        elif needs_image_update:
            # Update timestamp even if no image found to avoid repeated attempts
            update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
            print(f"   ⚠️ No image found, updated timestamp to avoid retry")

        # Update database if we have any updates
        if update_data:
            try:
                supabase.table("products").update(update_data).eq("id", product_id).execute()
                updated_count += 1
                print(f"   ✅ Database updated for product {product_id}{variant_info}")
            except Exception as e:
                print(f"   ❌ Database update failed for product {product_id}: {e}")
        else:
            print(f"   ℹ️ No updates needed for product {product_id}{variant_info}")

        time.sleep(1)  # polite delay between requests

    driver.quit()
    print(f"\n🎉 Done! {updated_count} products updated out of {len(products_to_update)} checked.")

# === Run Script ===
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="TCGPlayer Price Scraper")
    parser.add_argument(
        "--run-now", 
        action="store_true", 
        help="Run immediately and exit (for local testing)"
    )
    args = parser.parse_args()
    
    if args.run_now:
        # Run immediately for local testing
        print("🚀 Running immediately (--run-now flag detected)...")
        print(f"🕒 Current UTC time: {datetime.now(timezone.utc).isoformat()}")
        
        try:
            fetch_and_store_exchange_rate()
        except Exception as e:
            print(f"⚠️ fetch_and_store_exchange_rate failed: {e}")

        try:
            update_prices()
        except Exception as e:
            print(f"⚠️ update_prices failed: {e}")
        
        print("✅ Immediate run complete. Exiting.")
    else:
        # Scheduled mode for server
        def seconds_until_next_utc_interval(interval_hours=4):
            now = datetime.now(timezone.utc)
            next_hour = ((now.hour // interval_hours) + 1) * interval_hours
            if next_hour >= 24:
                next_time = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                next_time = now.replace(hour=next_hour, minute=0, second=0, microsecond=0)
            return (next_time - now).total_seconds()

        interval_hours = 4
        print(f"⏱️ Scheduled to run every {interval_hours} hours at UTC boundaries (e.g. 00:00, 04:00, ...).")
        try:
            while True:
                wait_secs = seconds_until_next_utc_interval(interval_hours)
                hrs = wait_secs / 3600.0
                print(f"   Next run in {hrs:.2f} hours ({int(wait_secs)} seconds).")
                time.sleep(wait_secs)

                print(f"\n🕒 Running scheduled jobs at UTC {datetime.now(timezone.utc).isoformat()} ...")
                try:
                    fetch_and_store_exchange_rate()
                except Exception as e:
                    print(f"⚠️ fetch_and_store_exchange_rate failed: {e}")

                try:
                    update_prices()
                except Exception as e:
                    print(f"⚠️ update_prices failed: {e}")

                time.sleep(1)
        except KeyboardInterrupt:
            print("✋ Exiting scheduled runner.")