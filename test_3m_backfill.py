#!/usr/bin/env python3
"""
Test script to verify both 3M and 1M data extraction works
"""
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

# === Navigate ===
driver.get(test_product['url'])
wait = WebDriverWait(driver, 15)

print("⏳ Waiting for page to load...")
wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
time.sleep(3)

all_data = []

# === Test 3M extraction ===
print("\n📊 TESTING 3M DATA EXTRACTION")
print("=" * 50)

try:
    buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
    for button in buttons:
        if "3M" in button.text.strip():
            print(f"🖱️  Clicking 3M button...")
            button.click()
            time.sleep(3)
            break
except Exception as e:
    print(f"⚠️  Could not click 3M: {e}")

# Extract 3M data
canvas_elements = driver.find_elements(By.CSS_SELECTOR, "canvas")
for canvas in canvas_elements:
    try:
        tables = canvas.find_elements(By.TAG_NAME, "table")
        for table in tables:
            tbody = table.find_element(By.TAG_NAME, "tbody")
            rows = tbody.find_elements(By.TAG_NAME, "tr")

            print(f"Found {len(rows)} rows in 3M view")

            # Show first few rows with date ranges
            for i, row in enumerate(rows[:5]):
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) >= 2:
                    date_str = cells[0].get_attribute('textContent').strip()
                    price_str = cells[1].get_attribute('textContent').strip()
                    print(f"  Row {i+1}: {date_str} -> {price_str}")

                    # Parse if it's a date range
                    if " to " in date_str:
                        price = float(price_str.replace("$", "").replace(",", ""))
                        date_parts = date_str.split(" to ")
                        print(f"    → Range detected: {date_parts[0]} to {date_parts[1]}")

                        # Parse dates
                        start = date_parts[0].strip().split("/")
                        end = date_parts[1].strip().split("/")

                        if len(start) == 2 and len(end) == 2:
                            start_month, start_day = int(start[0]), int(start[1])
                            end_month, end_day = int(end[0]), int(end[1])

                            # Determine year
                            start_year = 2025 if start_month >= 11 else 2024
                            end_year = 2025 if end_month >= 11 else 2024

                            start_date = datetime(start_year, start_month, start_day)
                            end_date = datetime(end_year, end_month, end_day)

                            # Expand range
                            current = start_date
                            while current <= end_date:
                                all_data.append({
                                    'date': current.strftime("%Y-%m-%d"),
                                    'price': price,
                                    'source': '3M'
                                })
                                current += timedelta(days=1)

                            print(f"    → Expanded to {(end_date - start_date).days + 1} days")

            break
    except Exception as e:
        print(f"Error: {e}")

# === Test 1M extraction ===
print("\n📊 TESTING 1M DATA EXTRACTION")
print("=" * 50)

try:
    buttons = driver.find_elements(By.CSS_SELECTOR, "button.charts-item")
    for button in buttons:
        if "1M" in button.text.strip():
            print(f"🖱️  Clicking 1M button...")
            button.click()
            time.sleep(3)
            break
except Exception as e:
    print(f"⚠️  Could not click 1M: {e}")

# Extract 1M data
canvas_elements = driver.find_elements(By.CSS_SELECTOR, "canvas")
for canvas in canvas_elements:
    try:
        tables = canvas.find_elements(By.TAG_NAME, "table")
        for table in tables:
            tbody = table.find_element(By.TAG_NAME, "tbody")
            rows = tbody.find_elements(By.TAG_NAME, "tr")

            print(f"Found {len(rows)} rows in 1M view")

            # Show first few rows with daily dates
            for i, row in enumerate(rows[:5]):
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) >= 2:
                    date_str = cells[0].get_attribute('textContent').strip()
                    price_str = cells[1].get_attribute('textContent').strip()
                    print(f"  Row {i+1}: {date_str} -> {price_str}")

                    # Parse daily date
                    if "-" in date_str and len(date_str) == 10:
                        price = float(price_str.replace("$", "").replace(",", ""))
                        all_data.append({
                            'date': date_str,
                            'price': price,
                            'source': '1M'
                        })

            break
    except Exception as e:
        print(f"Error: {e}")

driver.quit()

# === Show results ===
print(f"\n✅ COMBINED RESULTS")
print("=" * 50)
print(f"Total extracted: {len(all_data)} price points\n")

# Group by source
three_m_count = len([d for d in all_data if d['source'] == '3M'])
one_m_count = len([d for d in all_data if d['source'] == '1M'])

print(f"From 3M: {three_m_count} days")
print(f"From 1M: {one_m_count} days\n")

# Show Nov 5-7 specifically
print("Nov 5-7 data (from 3M):")
for entry in all_data:
    if entry['date'] >= '2025-11-05' and entry['date'] <= '2025-11-07':
        print(f"  {entry['date']}: ${entry['price']:.2f}")

print("\nNov 8-12 data (from 1M):")
for entry in all_data:
    if entry['date'] >= '2025-11-08' and entry['date'] <= '2025-11-12':
        print(f"  {entry['date']}: ${entry['price']:.2f}")
