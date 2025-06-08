import time
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

# === Scraper Logic with fallback ===
def get_price_from_url(driver, url):
    try:
        driver.get(url)
        wait = WebDriverWait(driver, 10)

        # Wait for at least one price element to be present
        prices = wait.until(EC.presence_of_all_elements_located((By.CLASS_NAME, "price-points__upper__price")))

        for el in prices:
            price_text = el.text.strip().replace("$", "").replace(",", "")
            if price_text not in ("-", "", "N/A"):
                return float(price_text)

        print(f"⚠️ No valid price found on page: {url}")
        return None

    except Exception as e:
        print(f"⚠️ Failed to fetch price for {url}: {e}")
        return None

# === Main Logic ===
def update_prices():
    # Calculate timestamp 2 hours ago in UTC
    two_hours_ago = datetime.now(timezone.utc) - timedelta(hours=2)

    # Fetch products not updated in last 2 hours
    response = supabase.table("products").select("*").lt("last_updated", two_hours_ago.isoformat()).execute()
    products_to_update = response.data

    if not products_to_update:
        print("🚫 No products requiring updates (within 2 hours window).")
        return

    driver = create_driver()
    updated_count = 0

    for product in products_to_update:
        product_id = product["id"]
        url = product["url"]

        print(f"🔍 Scraping product ID {product_id}...")
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

        else:
            print(f"❌ Skipped product {product_id} – no valid price.")

        time.sleep(0.5)  # polite delay

    driver.quit()
    print(f"🎉 Done! {updated_count} product prices updated and logged.")

# === Run Script ===
if __name__ == "__main__":
    update_prices()
import time
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

# === Scraper Logic with fallback ===
def get_price_from_url(driver, url):
    try:
        driver.get(url)
        time.sleep(2)  # allow JS rendering

        rows = driver.find_elements(By.CSS_SELECTOR, "div[class*='price-points__upper'] tr")
        # For each row, check the label and get price from the last cell
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
            return float(label_to_price["market"])
        elif "recent" in label_to_price and label_to_price["recent"] not in ("-", "", "N/A"):
            return float(label_to_price["recent"])
        print(f"⚠️ No valid price (Market or Recent Sale) found at: {url}")
        return None

    except Exception as e:
        print(f"⚠️ Exception while fetching price for {url}: {e}")
        return None


# === Main Logic ===
def update_prices():
    # Calculate timestamp 1 hours ago in UTC
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    # Use directly, DO NOT call .isoformat() again
    response = supabase.table("products").select("*").lt("last_updated", one_hour_ago).execute()

    products_to_update = response.data

    if not products_to_update:
        print("🚫 No products requiring updates (within 1 hour window).")
        return

    driver = create_driver()
    updated_count = 0

    for product in products_to_update:
        product_id = product["id"]
        url = product["url"]

        print(f"🔍 Scraping product ID {product_id}...")
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

        else:
            print(f"❌ Skipped product {product_id} – no valid price.")

        time.sleep(0.5)  # polite delay

    driver.quit()
    print(f"🎉 Done! {updated_count} product prices updated and logged.")

# === Run Script ===
if __name__ == "__main__":
    update_prices()
