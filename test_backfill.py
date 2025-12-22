#!/usr/bin/env python3
"""
Test script to verify historical data extraction works on a single product
"""
import time
from datetime import datetime
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

# === Get a test product ===
response = supabase.table("products").select("id, url").limit(1).execute()
test_product = response.data[0]

print(f"Testing with product ID: {test_product['id']}")
print(f"URL: {test_product['url']}\n")

# === Setup Chrome ===
options = Options()

system = platform.system()
if system == "Darwin":
    mac_chrome_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for path in mac_chrome_paths:
        if os.path.exists(path):
            options.binary_location = path
            break

options.add_argument("--headless=new")
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option('useAutomationExtension', False)
options.add_argument("user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--window-size=1920,1080")
options.add_argument("--disable-dev-shm-usage")

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

# === Navigate and extract ===
driver.get(test_product['url'])
wait = WebDriverWait(driver, 15)

print("⏳ Waiting for page to load...")
wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
time.sleep(3)

# Try to find and click 1M button
print("🖱️  Looking for 1M button...")
try:
    buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
    for button in buttons:
        print(f"   Found button: '{button.text.strip()}'")
        if "1M" in button.text.strip():
            print(f"   ✅ Clicking 1M button...")
            button.click()
            time.sleep(3)
            break
except Exception as e:
    print(f"   ⚠️  Error: {e}")

# Extract canvas data
print("\n📊 Looking for canvas elements...")
canvas_elements = driver.find_elements(By.CSS_SELECTOR, "canvas")
print(f"Found {len(canvas_elements)} canvas elements")

historical_data = []

for idx, canvas in enumerate(canvas_elements):
    print(f"\n🔍 Checking canvas {idx + 1}...")
    try:
        tables = canvas.find_elements(By.TAG_NAME, "table")
        print(f"   Found {len(tables)} tables in this canvas")

        for table_idx, table in enumerate(tables):
            print(f"   📋 Checking table {table_idx + 1}...")
            tbody = table.find_element(By.TAG_NAME, "tbody")
            rows = tbody.find_elements(By.TAG_NAME, "tr")
            print(f"      Found {len(rows)} rows")

            if len(rows) > 0:
                # Show first few rows
                for i, row in enumerate(rows[:5]):
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) >= 2:
                        # Try different methods to get text
                        date_str = cells[0].text.strip()
                        if not date_str:
                            date_str = cells[0].get_attribute('innerText')
                        if not date_str:
                            date_str = cells[0].get_attribute('textContent')

                        price_str = cells[1].text.strip()
                        if not price_str:
                            price_str = cells[1].get_attribute('innerText')
                        if not price_str:
                            price_str = cells[1].get_attribute('textContent')

                        print(f"      Row {i + 1}: '{date_str}' -> '{price_str}'")

                        try:
                            price = float(price_str.replace("$", "").replace(",", ""))
                            if "-" in date_str and len(date_str) == 10:
                                historical_data.append({
                                    'date': date_str,
                                    'price': price
                                })
                        except ValueError:
                            pass

    except Exception as e:
        print(f"   ❌ Error: {e}")

driver.quit()

print(f"\n✅ Extracted {len(historical_data)} historical price points:")
for entry in historical_data[:10]:
    print(f"   {entry['date']}: ${entry['price']:.2f}")

if len(historical_data) > 10:
    print(f"   ... and {len(historical_data) - 10} more")
