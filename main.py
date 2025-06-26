import time
import requests
import os
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
from urllib.parse import urlparse
import uuid

# === Silence SSL warning from urllib3 ===
warnings.simplefilter("ignore", NotOpenSSLWarning)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Selenium Driver Setup ===
def create_driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-dev-shm-usage")
    return webdriver.Chrome(options=options)

# === Image Download and Upload Logic ===
def download_and_upload_image(image_url, product_id):
    """
    Download image from TCGPlayer and upload to Supabase Storage
    Returns the public URL or None if failed
    """
    try:
        # Generate unique filename
        file_extension = image_url.split('.')[-1].split('?')[0].lower()  # Remove query params
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
        if len(response.content) < 1000:  # Less than 1KB is likely not a real image
            print(f"⚠️ Image too small, likely not valid: {len(response.content)} bytes")
            return None
        
        # Upload to Supabase Storage
        upload_response = supabase.storage.from_("product-images").upload(
            filename, 
            response.content,
            {
                "content-type": f"image/{file_extension}",
                "cache-control": "3600"
            }
        )
        
        if upload_response.data:
            # Get public URL
            public_url_response = supabase.storage.from_("product-images").get_public_url(filename)
            public_url = public_url_response.data.get('publicUrl') if public_url_response.data else None
            
            if public_url:
                print(f"✅ Image uploaded: {filename} → {public_url}")
                return public_url
            else:
                print(f"❌ Failed to get public URL for {filename}")
                return None
        else:
            print(f"❌ Upload failed: {upload_response}")
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
        time.sleep(3)  # allow JS rendering
        
        result = {'price': None, 'image_url': None}
        
        # === PRICE EXTRACTION (your existing logic) ===
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
        
        # === IMAGE EXTRACTION ===
        # Try multiple selectors for product images
        image_selectors = [
            # TCGPlayer specific selectors
            "img[data-testid='product-image']",
            "img[class*='product-image']",
            "img[class*='hero-image']", 
            "img[class*='listing-item-image']",
            "img[alt*='product']",
            "img[alt*='card']",
            ".product-details img",
            ".listing-item-image img",
            # More generic selectors
            "img[src*='product']",
            "img[src*='card']",
            "img[src*='tcgplayer']",
            # Very broad fallbacks
            ".container img",
            "main img",
            "article img"
        ]
        
        for selector in image_selectors:
            try:
                img_elements = driver.find_elements(By.CSS_SELECTOR, selector)
                for img in img_elements:
                    src = img.get_attribute('src')
                    if not src or not src.startswith('http'):
                        continue
                    
                    # Skip obvious non-product images
                    if any(skip in src.lower() for skip in ['logo', 'icon', 'avatar', 'banner', 'header', 'footer']):
                        continue
                    
                    # Validate it's likely a product image
                    if any(keyword in src.lower() for keyword in ['product', 'card', 'item', 'listing', 'image']):
                        # Check image dimensions to avoid tiny images
                        try:
                            width = img.get_attribute('width') or img.get_attribute('naturalWidth')
                            height = img.get_attribute('height') or img.get_attribute('naturalHeight')
                            
                            if width and height:
                                w, h = int(width), int(height)
                                if w >= 100 and h >= 100:  # At least 100x100
                                    result['image_url'] = src
                                    print(f"🖼️ Found product image: {src} ({w}x{h})")
                                    break
                            else:
                                # If no dimensions, assume it might be good
                                result['image_url'] = src
                                print(f"🖼️ Found product image: {src}")
                                break
                        except (ValueError, TypeError):
                            # If dimension parsing fails, still try the image
                            result['image_url'] = src
                            print(f"🖼️ Found product image: {src}")
                            break
                
                if result['image_url']:
                    break
                    
            except Exception as e:
                print(f"⚠️ Error with selector {selector}: {e}")
                continue
        
        if not result['image_url']:
            print(f"⚠️ No product image found on page: {url}")
        
        return result

    except Exception as e:
        print(f"⚠️ Exception while scraping {url}: {e}")
        return {'price': None, 'image_url': None}

# === Main Logic (Updated) ===
def update_prices():
    # Calculate timestamp 1 hour ago in UTC
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    
    # Get products that need updates (price OR image)
    # Check for products where:
    # 1. Price hasn't been updated in 1 hour, OR
    # 2. Image is missing (image_url is null), OR  
    # 3. Image hasn't been updated in 24 hours
    twenty_four_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    
    response = supabase.table("products").select("*").or_(
        f"last_updated.lt.{one_hour_ago},image_url.is.null,last_image_update.is.null,last_image_update.lt.{twenty_four_hours_ago}"
    ).execute()

    products_to_update = response.data

    if not products_to_update:
        print("🚫 No products requiring updates (within time windows).")
        return

    print(f"📦 Found {len(products_to_update)} products to update")
    
    driver = create_driver()
    updated_count = 0

    for product in products_to_update:
        product_id = product["id"]
        url = product["url"]
        current_image_url = product.get("image_url")
        last_updated = product.get("last_updated")
        last_image_update = product.get("last_image_update")

        print(f"\n🔍 Scraping product ID {product_id}...")
        print(f"   URL: {url}")
        
        # Get both price and image
        scraped_data = get_price_and_image_from_url(driver, url)
        price = scraped_data.get('price')
        tcg_image_url = scraped_data.get('image_url')
        
        update_data = {}
        
        # Handle price update (if price was found and it's time to update)
        needs_price_update = True  # Default to needing update
        if last_updated:
            try:
                # Parse the last_updated timestamp properly
                if last_updated.endswith('Z'):
                    last_updated_dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                elif '+' in last_updated or last_updated.endswith('+00:00'):
                    last_updated_dt = datetime.fromisoformat(last_updated)
                else:
                    # Assume UTC if no timezone info
                    last_updated_dt = datetime.fromisoformat(last_updated).replace(tzinfo=timezone.utc)
                
                # Check if it's been more than 1 hour
                needs_price_update = last_updated_dt < datetime.now(timezone.utc) - timedelta(hours=1)
            except (ValueError, TypeError) as e:
                print(f"   ⚠️ Error parsing last_updated '{last_updated}': {e}")
                needs_price_update = True  # Default to updating if we can't parse
        
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
        needs_image_update = True  # Default to needing update
        if current_image_url and last_image_update:
            try:
                # Parse the last_image_update timestamp properly
                if last_image_update.endswith('Z'):
                    last_image_update_dt = datetime.fromisoformat(last_image_update.replace('Z', '+00:00'))
                elif '+' in last_image_update or last_image_update.endswith('+00:00'):
                    last_image_update_dt = datetime.fromisoformat(last_image_update)
                else:
                    # Assume UTC if no timezone info
                    last_image_update_dt = datetime.fromisoformat(last_image_update).replace(tzinfo=timezone.utc)
                
                # Check if it's been more than 24 hours
                needs_image_update = last_image_update_dt < datetime.now(timezone.utc) - timedelta(hours=24)
            except (ValueError, TypeError) as e:
                print(f"   ⚠️ Error parsing last_image_update '{last_image_update}': {e}")
                needs_image_update = True  # Default to updating if we can't parse
        
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
                print(f"   ✅ Database updated for product {product_id}")
            except Exception as e:
                print(f"   ❌ Database update failed for product {product_id}: {e}")
        else:
            print(f"   ℹ️ No updates needed for product {product_id}")

        time.sleep(1)  # polite delay between requests

    driver.quit()
    print(f"\n🎉 Done! {updated_count} products updated out of {len(products_to_update)} checked.")

# === Setup Functions (run these once) ===
def setup_storage_bucket():
    """
    Create the storage bucket for product images (run this once)
    """
    try:
        # Create bucket
        bucket = supabase.storage.create_bucket("product-images", {
            "public": True,
            "file_size_limit": 5242880,  # 5MB
            "allowed_mime_types": ["image/jpeg", "image/png", "image/webp", "image/jpg"]
        })
        print("✅ Storage bucket 'product-images' created")
        return True
    except Exception as e:
        print(f"⚠️ Storage bucket creation: {e}")
        print("   (This is normal if bucket already exists)")
        return False

def add_image_columns():
    """
    Add image columns to products table (run this once)
    """
    try:
        # Note: This would need to be run manually in Supabase SQL editor
        sql_commands = [
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;",
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS last_image_update TIMESTAMP WITH TIME ZONE;"
        ]
        print("📝 Run these SQL commands in your Supabase SQL editor:")
        for cmd in sql_commands:
            print(f"   {cmd}")
        return True
    except Exception as e:
        print(f"❌ Error showing SQL commands: {e}")
        return False

# === Run Script ===
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        print("🚀 Running setup...")
        setup_storage_bucket()
        add_image_columns()
        print("\n✅ Setup complete! Now run without --setup to start scraping.")
    else:
        update_prices()