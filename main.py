import ipaddress
import logging
import os
import platform
import random
import shutil
import socket
import tempfile
import time
import uuid
import warnings
import re

import requests
from datetime import datetime, timedelta, timezone
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from supabase import create_client
from urllib.parse import urlparse, parse_qs
from urllib3.exceptions import NotOpenSSLWarning
from webdriver_manager.chrome import ChromeDriverManager

from secrets_loader import load_supabase_credentials

SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()

# === Image fetch hardening ===
IMAGE_MAX_BYTES = 8 * 1024 * 1024  # 8 MiB
IMAGE_ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp"}
IMAGE_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
# Magic numbers (file signatures) for the formats we accept.
IMAGE_MAGIC_BYTES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"RIFF", "webp"),  # WEBP RIFF header; full check below
]
IMAGE_HOST_ALLOWLIST = {
    # Known image hosts the scraper is expected to fetch from. Add
    # entries here when a legitimate new source appears.
    "tcgplayer.com",
    "www.tcgplayer.com",
    "product-images.tcgplayer.com",
    "static.tcgplayer.com",
    "tcgplayer-cdn.tcgplayer.com",
}


def _host_is_allowed(host: str) -> bool:
    if not host:
        return False
    host = host.lower()
    if host in IMAGE_HOST_ALLOWLIST:
        return True
    # Accept any *.tcgplayer.com to keep the list small.
    return host.endswith(".tcgplayer.com")


def _ip_is_safe(host: str) -> bool:
    """Resolve host and refuse private/loopback/link-local addresses."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return True


def _detect_image_format(buf: bytes) -> str | None:
    if len(buf) < 12:
        return None
    if buf.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if buf.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if buf.startswith(b"RIFF") and buf[8:12] == b"WEBP":
        return "webp"
    return None

# === Silence SSL warning from urllib3 ===
warnings.simplefilter("ignore", NotOpenSSLWarning)


def normalize_hyphens(text):
    """
    Normalize various Unicode hyphen/dash characters to regular ASCII hyphen.
    Handles: non-breaking hyphen, hyphen, figure dash, en dash, em dash,
    horizontal bar, and minus sign.
    """
    hyphen_chars = [
        '\u2010',  # Hyphen
        '\u2011',  # Non-breaking hyphen
        '\u2012',  # Figure dash
        '\u2013',  # En dash
        '\u2014',  # Em dash
        '\u2015',  # Horizontal bar
        '\u2212',  # Minus sign
    ]
    for char in hyphen_chars:
        text = text.replace(char, '-')
    return text


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


def fetch_latest_market_data_from_api(session, product_id, referer=None,
                                      preferred_variant=None, preferred_language=None):
    """
    Fetch latest market data from TCGPlayer's infinite-api endpoint.
    Returns a dict with:
      - "price": float latest market price, or None if no range yielded one.
      - "daily_buckets": the raw buckets list ONLY when the range that
        produced the price was "month" (the only range with daily buckets;
        quarter is 3-day, semi-annual/annual are weekly and must never be
        stored as daily), else an empty list.
    """
    empty = {"price": None, "daily_buckets": []}
    if not product_id:
        return empty

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.tcgplayer.com",
    }
    if referer:
        headers["Referer"] = referer

    # "month" first: it carries the 30 daily buckets we need for sales
    # volume, and its latest price is identical to the other ranges.
    range_keys = ["month", "quarter", "semi-annual", "annual"]

    for key in range_keys:
        url = f"https://infinite-api.tcgplayer.com/price/history/{product_id}/detailed?range={key}"
        try:
            response = session.get(url, headers=headers, timeout=15)
            if response.status_code != 200:
                continue
            data = response.json()
        except Exception:
            continue

        result = _select_api_result(
            data,
            preferred_variant=preferred_variant,
            preferred_language=preferred_language,
        )
        if not result:
            continue

        buckets = result.get("buckets") or []
        latest_price = None
        latest_date = None
        for bucket in buckets:
            date_str = bucket.get("bucketStartDate")
            price_str = bucket.get("marketPrice")
            if not date_str or price_str is None:
                continue
            try:
                price = float(str(price_str).replace(",", ""))
            except ValueError:
                continue
            if price <= 0:
                continue
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            if latest_date is None or date_obj > latest_date:
                latest_date = date_obj
                latest_price = price

        if latest_price is not None:
            return {
                "price": latest_price,
                "daily_buckets": buckets if key == "month" else [],
            }

    return empty


def _parse_bucket_count(value):
    """Parse a count field ('3', '1,234', 3) to a non-negative int or None."""
    if value is None:
        return None
    try:
        count = int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None
    if count < 0:
        return None
    return count


def _parse_bucket_price(value):
    """Parse a price field ('147.24', '1,499.99') to a positive float or None."""
    if value is None:
        return None
    try:
        price = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return price


def parse_daily_sales_buckets(buckets, product_id):
    """
    Convert raw daily buckets from the infinite-api (range=month) into
    upsert-ready product_sales_history rows (granularity='day').

    Defensive parsing: API numeric values are strings, possibly with
    commas. Buckets with a missing/invalid bucketStartDate are skipped;
    negative counts and non-positive prices become None. Today's partial
    bucket is included on purpose — the daily upsert self-corrects it on
    later runs.
    """
    rows = []
    for bucket in buckets or []:
        if not isinstance(bucket, dict):
            continue
        date_str = bucket.get("bucketStartDate")
        if not date_str:
            continue
        try:
            bucket_date = datetime.strptime(str(date_str), "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue

        rows.append({
            "product_id": product_id,
            "bucket_date": bucket_date.strftime("%Y-%m-%d"),
            "granularity": "day",
            "quantity_sold": _parse_bucket_count(bucket.get("quantitySold")),
            "transaction_count": _parse_bucket_count(bucket.get("transactionCount")),
            "low_sale_price": _parse_bucket_price(bucket.get("lowSalePrice")),
            "high_sale_price": _parse_bucket_price(bucket.get("highSalePrice")),
            "market_price": _parse_bucket_price(bucket.get("marketPrice")),
        })
    return rows


def fetch_listings_snapshot(session, tcgplayer_product_id, referer=None,
                            preferred_language=None):
    """
    Fetch a snapshot of live listings depth from TCGPlayer's mp-search-api.
    Returns dict with keys active_listings (int|None),
    total_quantity_available (int|None), lowest_listing_price (float|None),
    or None on any failure (non-200, parse error, ...).

    preferred_language scopes the snapshot to one language when the product
    URL pins one (?Language=...), so multi-language product ids don't mix
    markets. Listings carry no variant dimension for sealed product (the
    'printing' term uses Normal/Holofoil, not our display variants), so no
    variant filter is applied.
    """
    if not tcgplayer_product_id:
        return None

    url = f"https://mp-search-api.tcgplayer.com/v1/product/{tcgplayer_product_id}/listings"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://www.tcgplayer.com",
    }
    if referer:
        headers["Referer"] = referer

    term_filters = {"sellerStatus": "Live", "channelId": 0, "listingType": "standard"}
    if preferred_language:
        term_filters["language"] = [preferred_language]

    payload = {
        "filters": {
            "term": term_filters,
            "range": {"quantity": {"gte": 1}},
            "exclude": {"channelExclusion": 0},
        },
        "from": 0,
        "size": 1,
        "sort": {"field": "price+shipping", "order": "asc"},
        "context": {"shippingCountry": "US"},
        # quantity must be requested explicitly — total_quantity_available
        # is derived from its histogram below.
        "aggregations": ["listingType", "quantity"],
    }

    try:
        response = session.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code != 200:
            logger.debug(f"Listings API response {response.status_code} for TCGPlayer product {tcgplayer_product_id}")
            return None
        data = response.json()

        results = data.get("results") or []
        if not results or not isinstance(results[0], dict):
            logger.debug(f"Listings API returned no results for TCGPlayer product {tcgplayer_product_id}")
            return None
        top = results[0]

        active_listings = None
        try:
            total_results = top.get("totalResults")
            if total_results is not None:
                candidate = int(round(float(total_results)))
                if candidate >= 0:
                    active_listings = candidate
        except (TypeError, ValueError):
            active_listings = None

        # total available quantity = sum over the quantity aggregation of
        # round(value) * round(count). Defensive: missing/invalid agg -> None.
        total_quantity_available = None
        aggregations = top.get("aggregations") or {}
        quantity_agg = aggregations.get("quantity")
        if isinstance(quantity_agg, list) and quantity_agg:
            total = 0
            parsed_any = False
            for entry in quantity_agg:
                if not isinstance(entry, dict):
                    continue
                try:
                    total += int(round(float(entry.get("value")))) * int(round(float(entry.get("count"))))
                    parsed_any = True
                except (TypeError, ValueError):
                    continue
            if parsed_any and total >= 0:
                total_quantity_available = total

        lowest_listing_price = None
        listings = top.get("results") or []
        if listings and isinstance(listings[0], dict):
            try:
                price = float(listings[0].get("price"))
                if price > 0:
                    lowest_listing_price = price
            except (TypeError, ValueError):
                lowest_listing_price = None

        return {
            "active_listings": active_listings,
            "total_quantity_available": total_quantity_available,
            "lowest_listing_price": lowest_listing_price,
        }
    except Exception as e:
        logger.debug(f"Listings snapshot fetch failed for TCGPlayer product {tcgplayer_product_id}: {e}")
        return None


# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Selenium Driver Setup ===
def create_driver():
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

    # Unique user data dir for cleanup
    user_data_dir = os.path.join(tempfile.gettempdir(), f"chrome_scraper_{int(time.time())}_{os.getpid()}")
    options.add_argument(f"--user-data-dir={user_data_dir}")
    options.add_argument("--disable-background-timer-throttling")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    # Hide webdriver property
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

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

# === Image Download and Upload Logic ===
def download_and_upload_image(image_url, product_id):
    """
    Download an image from an allowlisted host, validate its size and
    magic-number signature, then upload it to Supabase Storage.
    Returns the public URL or None.

    Hardening (audit findings F-1, F-2, F-3):
    - Scheme/host allowlist + private-IP refusal (SSRF defense).
    - allow_redirects=False (no redirect to file:// or internal host).
    - 8 MiB hard cap, streamed (no OOM via Content-Length lying).
    - Magic-number validation (caller-provided extension is ignored).
    """
    try:
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"}:
            logger.warning("image_url has unsupported scheme: %s", parsed.scheme)
            return None
        host = parsed.hostname or ""
        if not _host_is_allowed(host):
            logger.warning("image_url host not in allowlist: %s", host)
            return None
        if not _ip_is_safe(host):
            logger.warning("image_url resolves to a private/reserved address: %s", host)
            return None

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
        }

        # Stream the response so we can stop reading once we hit the
        # size cap, even if Content-Length lies.
        with requests.get(
            image_url,
            headers=headers,
            timeout=30,
            stream=True,
            allow_redirects=False,
        ) as response:
            response.raise_for_status()

            declared_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if declared_type and declared_type not in IMAGE_ALLOWED_MIMES:
                logger.warning("Rejecting non-image Content-Type: %s", declared_type)
                return None

            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > IMAGE_MAX_BYTES:
                logger.warning("Image too large (Content-Length=%s)", content_length)
                return None

            buf = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                buf.extend(chunk)
                if len(buf) > IMAGE_MAX_BYTES:
                    logger.warning(
                        "Image exceeded %d-byte cap during streaming download",
                        IMAGE_MAX_BYTES,
                    )
                    return None

        if len(buf) < 1000:
            logger.warning("Image too small, likely not valid: %d bytes", len(buf))
            return None

        # Magic-number check trumps the URL-derived extension. This
        # prevents an attacker uploading e.g. an SVG-with-script or an
        # HTML page disguised as foo.jpg.
        fmt = _detect_image_format(bytes(buf[:32]))
        if fmt is None:
            logger.warning("Image magic bytes did not match jpeg/png/webp")
            return None
        file_extension = "jpg" if fmt == "jpeg" else fmt
        content_type = f"image/{'jpeg' if fmt == 'jpeg' else fmt}"

        filename = f"products/{product_id}.{file_extension}"

        try:
            upload_response = supabase.storage.from_("product-images").upload(
                filename,
                bytes(buf),
                {
                    "content-type": content_type,
                    "cache-control": "3600",
                    "upsert": "true",
                },
            )

            upload_success = False
            if hasattr(upload_response, 'data') and upload_response.data:
                upload_success = True
            elif hasattr(upload_response, 'path') or (hasattr(upload_response, '__dict__') and 'path' in upload_response.__dict__):
                upload_success = True
            elif isinstance(upload_response, dict) and ('path' in upload_response or 'Key' in upload_response):
                upload_success = True

            if not upload_success:
                logger.error("upload_failed status=%s", getattr(upload_response, "status_code", "unknown"))
                return None

            try:
                public_url_response = supabase.storage.from_("product-images").get_public_url(filename)
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
                    logger.info("image_uploaded filename=%s", filename)
                    return public_url
                logger.error("public_url_lookup_failed filename=%s", filename)
                return None
            except Exception as url_error:
                logger.error("public_url_lookup_error filename=%s err=%s", filename, type(url_error).__name__)
                return None
        except Exception as upload_error:
            logger.error("upload_error filename=%s err=%s", filename, type(upload_error).__name__)
            return None

    except Exception as e:
        logger.error("download_and_upload_image_error product=%s err=%s", product_id, type(e).__name__)
        return None

# === Enhanced scraper with image extraction ===
def get_price_and_image_from_url(driver, url, session=None, variant=None, db_product_id=None):
    """
    Extract market price (API-only) and image URL from TCGPlayer product page.
    Returns dict with 'price', 'image_url', 'sales_buckets' (upsert-ready
    product_sales_history rows when db_product_id is provided and daily
    buckets were available) and 'tcgplayer_product_id' keys.
    """
    try:
        result = {'price': None, 'image_url': None, 'sales_buckets': [], 'tcgplayer_product_id': None}

        tcgplayer_product_id = extract_tcgplayer_product_id(url)
        result['tcgplayer_product_id'] = tcgplayer_product_id
        preferred_language = extract_preferred_language(url)
        if session and tcgplayer_product_id:
            api_data = fetch_latest_market_data_from_api(
                session=session,
                product_id=tcgplayer_product_id,
                referer=url,
                preferred_variant=variant,
                preferred_language=preferred_language,
            )
            api_price = api_data.get('price')
            if api_price is not None:
                result['price'] = api_price

            # Sales-volume capture must never break the price pipeline.
            try:
                daily_buckets = api_data.get('daily_buckets') or []
                if daily_buckets and db_product_id is not None:
                    result['sales_buckets'] = parse_daily_sales_buckets(daily_buckets, db_product_id)
            except Exception as e:
                logger.warning(f"Failed to parse daily sales buckets for {url}: {e}")

        driver.get(url)

        # Allow client-side rendering to hydrate before image extraction
        time.sleep(2)

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
                logger.debug(f"Image selector '{selector}' failed: {e}")
                continue

        return result

    except Exception as e:
        logger.warning(f"Exception while scraping {url}: {e}")
        return {'price': None, 'image_url': None, 'sales_buckets': [], 'tcgplayer_product_id': None}

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
        logger.info("Fetching USD→CAD exchange rate from Bank of Canada...")
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
                # BOC may use various Unicode hyphen characters
                # Normalize to regular ASCII hyphen for parsing
                normalized_date_str = normalize_hyphens(rate_date_str)
                rate_date = datetime.strptime(normalized_date_str, "%Y-%m-%d")
                break

        if rate is None or rate_date is None:
            raise ValueError("Could not find a valid USD→CAD rate")

        logger.info(f"USD→CAD Rate: {rate} (as of {rate_date.date()})")

        # Insert into Supabase
        try:
            result = supabase.table("exchange_rates").insert({
                "usd_to_cad": rate,
                "recorded_at": rate_date.isoformat()
            }).execute()
            logger.info("Exchange rate stored in Supabase successfully.")
        except Exception as e:
            logger.warning(f"Supabase insert failed: {e}")

    except Exception as e:
        logger.error(f"Failed to fetch or store exchange rate: {e}")


def fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago, batch_size=500):
    """
    Fetch products that need updates using pagination.
    Returns list of products needing price or image updates.
    """
    all_products = []
    offset = 0
    or_filter = f"last_updated.is.null,usd_price.is.null,last_updated.lt.{price_interval_ago.isoformat()},image_url.is.null,last_image_update.is.null,last_image_update.lt.{twenty_four_hours_ago.isoformat()}"

    while True:
        response = supabase.table("products")\
            .select("id, url, usd_price, image_url, last_updated, last_image_update, variant, set_id, product_type_id")\
            .or_(or_filter)\
            .range(offset, offset + batch_size - 1)\
            .execute()

        if not response.data:
            break

        all_products.extend(response.data)
        logger.debug(f"Fetched {len(response.data)} products needing updates (total: {len(all_products)})")

        if len(response.data) < batch_size:
            break  # Last page

        offset += batch_size

    return all_products


def update_prices():
    """Main function to update product prices and images."""
    # Calculate timestamps in UTC
    # Update prices once per day (run at UTC midnight)
    price_update_interval_hours = 24
    price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=price_update_interval_hours)
    twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

    # Get products that need updates using pagination
    products_to_update = fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago)

    if not products_to_update:
        logger.info("No products requiring updates (within time windows).")
        return

    logger.info(f"Found {len(products_to_update)} products to update")

    # Group products by type for logging
    products_by_type = {}
    for product in products_to_update:
        key = f"Set:{product['set_id']}-Type:{product['product_type_id']}"
        if product.get('variant'):
            key += f"-Variant:{product['variant']}"
        if key not in products_by_type:
            products_by_type[key] = 0
        products_by_type[key] += 1

    logger.info("Products to update by type:")
    for key, count in products_by_type.items():
        logger.info(f"   - {key}: {count} products")

    driver = None
    user_data_dir = None
    api_session = requests.Session()
    updated_count = 0
    price_history_batch = []  # Collect price history entries for batch insert
    sales_history_batch = []  # Collect daily sales-volume rows for batch upsert
    listings_history_batch = []  # Collect listings-depth snapshots for batch upsert
    sales_rows_written = 0
    sales_rows_failed = 0
    listings_rows_written = 0
    listings_rows_failed = 0

    try:
        driver, user_data_dir = create_driver()

        for idx, product in enumerate(products_to_update, 1):
            product_id = product["id"]
            url = product["url"]
            current_image_url = product.get("image_url")
            last_updated = product.get("last_updated")
            last_image_update = product.get("last_image_update")
            variant = product.get("variant")

            variant_info = f" (Variant: {variant})" if variant else ""
            logger.info(f"[{idx}/{len(products_to_update)}] Scraping product ID {product_id}{variant_info}...")

            # Get both price and image
            scraped_data = get_price_and_image_from_url(
                driver,
                url,
                session=api_session,
                variant=variant,
                db_product_id=product_id,
            )
            price = scraped_data.get('price')
            if price is not None and price <= 0:
                logger.warning(f"   Ignoring non-positive price from scrape: {price}")
                price = None
            tcg_image_url = scraped_data.get('image_url')

            update_data = {}

            # Handle price update
            current_price = product.get("usd_price")
            needs_price_update = True

            # Always update if current price is NULL, otherwise check time interval
            if current_price is not None and last_updated:
                last_updated_dt = parse_timestamp(last_updated)
                if last_updated_dt:
                    needs_price_update = last_updated_dt < price_interval_ago

            if price is not None and needs_price_update:
                update_data["usd_price"] = price
                update_data["last_updated"] = datetime.now(timezone.utc).isoformat()

                # Add to price history batch instead of individual insert
                price_history_batch.append({
                    "product_id": product_id,
                    "usd_price": price
                })
                logger.info(f"   Updated price: ${price:.2f}")

            # === Sales volume + listings capture ===
            # Not gated on needs_price_update: capture whenever API data is
            # in hand. Wrapped so an exception can never break the price
            # pipeline.
            try:
                sales_rows = scraped_data.get('sales_buckets') or []
                if sales_rows:
                    # Dedupe guard: PostgREST upsert fails if one batch
                    # contains the same (product_id, bucket_date,
                    # granularity) key twice.
                    pending_keys = {
                        (row.get("product_id"), row.get("bucket_date"), row.get("granularity"))
                        for row in sales_history_batch
                    }
                    added = 0
                    for row in sales_rows:
                        key = (row.get("product_id"), row.get("bucket_date"), row.get("granularity"))
                        if key in pending_keys:
                            continue
                        pending_keys.add(key)
                        sales_history_batch.append(row)
                        added += 1
                    if added:
                        logger.info(f"   Captured {added} daily sales-volume rows")
            except Exception as e:
                logger.warning(f"   Sales volume capture failed for product {product_id}: {e}")

            try:
                tcgplayer_product_id = scraped_data.get('tcgplayer_product_id')
                if tcgplayer_product_id:
                    # Extra politeness delay before hitting the listings endpoint
                    time.sleep(0.5 + random.uniform(0, 0.5))
                    snapshot = fetch_listings_snapshot(
                        api_session, tcgplayer_product_id, referer=url,
                        preferred_language=extract_preferred_language(url),
                    )
                    if snapshot is not None:
                        listings_history_batch.append({
                            "product_id": product_id,
                            "snapshot_date": datetime.now(timezone.utc).date().isoformat(),
                            "active_listings": snapshot.get("active_listings"),
                            "total_quantity_available": snapshot.get("total_quantity_available"),
                            "lowest_listing_price": snapshot.get("lowest_listing_price"),
                        })
                        logger.info(f"   Captured listings snapshot ({snapshot.get('active_listings')} active listings)")
            except Exception as e:
                logger.warning(f"   Listings snapshot capture failed for product {product_id}: {e}")

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
                        logger.info(f"   Updated image: {uploaded_image_url}")
                    else:
                        # If upload fails, still store the TCGPlayer URL as fallback
                        update_data["image_url"] = tcg_image_url
                        update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                        logger.warning(f"   Using direct TCGPlayer image URL: {tcg_image_url}")
                else:
                    # Same image URL, just update timestamp
                    update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                    logger.info(f"   Image URL unchanged, updated timestamp")
            elif needs_image_update:
                # Update timestamp even if no image found to avoid repeated attempts
                update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()
                logger.warning(f"   No image found, updated timestamp to avoid retry")

            # Update database if we have any updates
            if update_data:
                try:
                    supabase.table("products").update(update_data).eq("id", product_id).execute()
                    updated_count += 1
                    logger.info(f"   Database updated for product {product_id}{variant_info}")
                except Exception as e:
                    logger.error(f"   Database update failed for product {product_id}: {e}")
            else:
                logger.info(f"   No updates needed for product {product_id}{variant_info}")

            # Batch insert price history every 100 entries
            if len(price_history_batch) >= 100:
                _flush_price_history_batch(price_history_batch)
                price_history_batch = []

            # Batch upsert sales/listings history every 100 entries
            if len(sales_history_batch) >= 100:
                flushed_ok, flushed_failed = _flush_sales_history_batch(sales_history_batch)
                sales_rows_written += flushed_ok
                sales_rows_failed += flushed_failed
                sales_history_batch = []

            if len(listings_history_batch) >= 100:
                flushed_ok, flushed_failed = _flush_listings_history_batch(listings_history_batch)
                listings_rows_written += flushed_ok
                listings_rows_failed += flushed_failed
                listings_history_batch = []

            time.sleep(1)  # polite delay between requests

        # Flush remaining price history entries
        if price_history_batch:
            _flush_price_history_batch(price_history_batch)

        # Flush remaining sales/listings history entries
        if sales_history_batch:
            flushed_ok, flushed_failed = _flush_sales_history_batch(sales_history_batch)
            sales_rows_written += flushed_ok
            sales_rows_failed += flushed_failed

        if listings_history_batch:
            flushed_ok, flushed_failed = _flush_listings_history_batch(listings_history_batch)
            listings_rows_written += flushed_ok
            listings_rows_failed += flushed_failed

    finally:
        cleanup_driver(driver, user_data_dir)
        try:
            api_session.close()
        except Exception:
            pass

    logger.info(f"Done! {updated_count} products updated out of {len(products_to_update)} checked.")
    logger.info(
        f"Sales history rows written: {sales_rows_written} (failed: {sales_rows_failed}); "
        f"listings snapshots written: {listings_rows_written} (failed: {listings_rows_failed})"
    )


def _flush_price_history_batch(batch):
    """
    Insert a batch of price history entries.
    Returns tuple of (success_count, failed_count).
    """
    if not batch:
        return 0, 0

    success_count = 0
    failed_count = 0

    try:
        supabase.table("product_price_history").insert(batch).execute()
        success_count = len(batch)
        logger.debug(f"Batch inserted {len(batch)} price history records")
    except Exception as e:
        logger.error(f"Batch price history insert failed: {e}")
        # Fall back to individual inserts
        for entry in batch:
            try:
                supabase.table("product_price_history").insert(entry).execute()
                success_count += 1
            except Exception as inner_e:
                logger.error(f"Individual price history insert failed for product {entry.get('product_id')}: {inner_e}")
                failed_count += 1

    return success_count, failed_count


# Set once a flush hits a missing-table error (migration 0015 not yet applied)
# so later volume flushes in the same run skip doomed network calls. Both
# volume tables come from the same migration, so one flag covers both.
_volume_tables_missing = False


def _is_missing_table_error(exc):
    """True when the exception indicates the target table does not exist (42P01)."""
    text = str(exc)
    return "42P01" in text or "does not exist" in text.lower()


def _flush_sales_history_batch(batch):
    """
    Upsert a batch of daily sales-volume entries (idempotent on
    (product_id, bucket_date, granularity)).
    Returns tuple of (success_count, failed_count). Never raises.
    """
    global _volume_tables_missing

    if not batch:
        return 0, 0
    if _volume_tables_missing:
        return 0, len(batch)

    success_count = 0
    failed_count = 0

    try:
        supabase.table("product_sales_history").upsert(
            batch, on_conflict="product_id,bucket_date,granularity"
        ).execute()
        success_count = len(batch)
        logger.debug(f"Batch upserted {len(batch)} sales history records")
    except Exception as e:
        if _is_missing_table_error(e):
            _volume_tables_missing = True
            logger.warning(
                f"product_sales_history table missing — apply migration "
                f"0015_product_sales_and_listings_history.sql; skipping "
                f"volume writes for the rest of this run: {e}"
            )
            return 0, len(batch)
        logger.warning(
            f"Batch sales history upsert failed (has migration "
            f"0015_product_sales_and_listings_history.sql been applied?): {e}"
        )
        # Fall back to individual upserts
        for entry in batch:
            try:
                supabase.table("product_sales_history").upsert(
                    entry, on_conflict="product_id,bucket_date,granularity"
                ).execute()
                success_count += 1
            except Exception as inner_e:
                logger.error(f"Individual sales history upsert failed for product {entry.get('product_id')}: {inner_e}")
                failed_count += 1

    return success_count, failed_count


def _flush_listings_history_batch(batch):
    """
    Upsert a batch of listings-depth snapshots (idempotent on
    (product_id, snapshot_date)).
    Returns tuple of (success_count, failed_count). Never raises.
    """
    global _volume_tables_missing

    if not batch:
        return 0, 0
    if _volume_tables_missing:
        return 0, len(batch)

    success_count = 0
    failed_count = 0

    try:
        supabase.table("product_listings_history").upsert(
            batch, on_conflict="product_id,snapshot_date"
        ).execute()
        success_count = len(batch)
        logger.debug(f"Batch upserted {len(batch)} listings history records")
    except Exception as e:
        if _is_missing_table_error(e):
            _volume_tables_missing = True
            logger.warning(
                f"product_listings_history table missing — apply migration "
                f"0015_product_sales_and_listings_history.sql; skipping "
                f"volume writes for the rest of this run: {e}"
            )
            return 0, len(batch)
        logger.warning(
            f"Batch listings history upsert failed (has migration "
            f"0015_product_sales_and_listings_history.sql been applied?): {e}"
        )
        # Fall back to individual upserts
        for entry in batch:
            try:
                supabase.table("product_listings_history").upsert(
                    entry, on_conflict="product_id,snapshot_date"
                ).execute()
                success_count += 1
            except Exception as inner_e:
                logger.error(f"Individual listings history upsert failed for product {entry.get('product_id')}: {inner_e}")
                failed_count += 1

    return success_count, failed_count


# === Shopify Price Check ===
def check_shopify_prices(threshold_pct: float = 5.0) -> None:
    """
    Check Shopify prices against market prices and send Telegram alerts.

    Uses the PriceMonitor to:
    1. Fetch products from Shopify (via OAuth client credentials)
    2. Compare against Pokéfin market prices
    3. Send Telegram alert for products priced below market

    Args:
        threshold_pct: Alert if price is more than X% below market (default: 5.0)
    """
    try:
        from price_monitor import PriceMonitor

        logger.info("Starting Shopify price check...")
        monitor = PriceMonitor()
        results = monitor.check_prices(threshold_pct=threshold_pct, send_alerts=True)

        below = len(results.get('below_market', []))
        matched = len(results.get('matched', []))

        if below > 0:
            logger.warning(f"Found {below} products priced below market!")
        else:
            logger.info(f"Price check complete: {matched} products matched, all prices OK")

    except ImportError as e:
        logger.error(f"Price monitor not available: {e}")
        logger.info("Skipping Shopify price check (missing dependencies)")

    except ValueError as e:
        # Missing Shopify/Telegram credentials - log warning but don't fail
        logger.warning(f"Shopify price check skipped: {e}")

    except Exception as e:
        logger.error(f"Shopify price check failed: {e}")


# === Run Script ===
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="TCGPlayer Price Scraper")
    parser.add_argument(
        "--run-now",
        action="store_true",
        help="Run immediately and exit (for local testing)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )
    args = parser.parse_args()

    # Set logging level based on debug flag (only affects this module's logger)
    if args.debug:
        logger.setLevel(logging.DEBUG)

    if args.run_now:
        # Run immediately for local testing
        logger.info("Running immediately (--run-now flag detected)...")
        logger.info(f"Current UTC time: {datetime.now(timezone.utc).isoformat()}")

        try:
            fetch_and_store_exchange_rate()
        except Exception as e:
            logger.error(f"fetch_and_store_exchange_rate failed: {e}")

        try:
            update_prices()
        except Exception as e:
            logger.error(f"update_prices failed: {e}")

        logger.info("Immediate run complete. Exiting.")
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
        logger.info(f"Scheduled to run every {interval_hours} hours at UTC boundaries (e.g. 00:00, 04:00, ...).")
        try:
            while True:
                wait_secs = seconds_until_next_utc_interval(interval_hours)
                hrs = wait_secs / 3600.0
                logger.info(f"Next run in {hrs:.2f} hours ({int(wait_secs)} seconds).")
                time.sleep(wait_secs)

                logger.info(f"Running scheduled jobs at UTC {datetime.now(timezone.utc).isoformat()} ...")
                try:
                    fetch_and_store_exchange_rate()
                except Exception as e:
                    logger.error(f"fetch_and_store_exchange_rate failed: {e}")

                try:
                    update_prices()
                except Exception as e:
                    logger.error(f"update_prices failed: {e}")

                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Exiting scheduled runner.")