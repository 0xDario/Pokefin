#!/usr/bin/env python3
"""
Quick test script to scrape a single product and save the HTML
"""
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

# Setup Chrome with bot detection evasion
options = Options()
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

# Hide webdriver property
driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

# Test URL
url = "https://www.tcgplayer.com/product/528040"
print(f"Scraping: {url}")

driver.get(url)
time.sleep(5)

# Scroll
driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
time.sleep(2)

# Save the full HTML
html = driver.page_source
with open("/Users/darioturchi/repos/TCGPlayerScraper/page_source.html", "w") as f:
    f.write(html)
print("Saved HTML to page_source.html")

# Try to find price section
try:
    price_section = driver.find_element(By.CSS_SELECTOR, "div[class*='price-points__upper']")
    print(f"✅ Found price section!")
    print(f"Section HTML: {price_section.get_attribute('outerHTML')[:500]}")
except Exception as e:
    print(f"❌ Could not find price section: {e}")

    # Try alternative selectors
    print("\nTrying alternative selectors...")

    selectors = [
        "div.price-points",
        "div[class*='price-points']",
        "div[class*='price-guide']",
        "section[class*='price-guide']",
        ".price-points__upper",
        "[class*='price-points__upper']"
    ]

    for selector in selectors:
        try:
            elem = driver.find_element(By.CSS_SELECTOR, selector)
            print(f"✅ Found with selector '{selector}'")
            print(f"   HTML: {elem.get_attribute('outerHTML')[:200]}")
        except:
            print(f"❌ Not found: '{selector}'")

driver.quit()
print("\nDone!")
