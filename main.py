import time
from datetime import datetime
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import warnings
from urllib3.exceptions import NotOpenSSLWarning

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

# === Scraper Logic ===
def get_price_from_url(driver, url):
    try:
        driver.get(url)
        wait = WebDriverWait(driver, 8)
        el = wait.until(EC.presence_of_element_located((By.CLASS_NAME, "price-points__upper__price")))
        price_text = el.text.strip().replace("$", "").replace(",", "")
        return float(price_text)
    except Exception as e:
        print(f"⚠️ Failed to fetch price for {url}: {e}")
        return None

# === Main Logic ===
def update_prices():
    response = supabase.table("products").select("id, url").execute()
    products = [p for p in response.data if p.get("url")]

    if not products:
        print("No products with URLs found.")
        return

    driver = create_driver()
    updated_count = 0

    for product in products:
        product_id = product["id"]
        url = product["url"]

        price = get_price_from_url(driver, url)
        if price is not None:
            # Update main products table
            supabase.table("products").update({
                "usd_price": price,
                "last_updated": datetime.utcnow().isoformat()
            }).eq("id", product_id).execute()

            # Log price in history table
            supabase.table("product_price_history").insert({
                "product_id": product_id,
                "usd_price": price
            }).execute()

            print(f"✅ Updated product {product_id} → ${price:.2f}")
            updated_count += 1

        time.sleep(0.5)

    driver.quit()
    print(f"🎉 Done! {updated_count} product prices updated and logged.")

# === Run Script ===
if __name__ == "__main__":
    update_prices()
