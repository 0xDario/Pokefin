# WP16: Scraper and report pipeline hardening

- **Findings covered** (all full coverage, no partials):
  - F083 (full, low): a scraped market price has no plausibility bound, so one glitched TCGplayer API value becomes `products.usd_price` for about a day and a permanent `product_price_history` row (a one-day spike on the chart and in 30D/90D/365D returns anchored on that day) until someone deletes it by hand.
  - F084 (full, low): `products.last_updated` is committed per product while price-history rows sit in a 100-row buffer that is never flushed on interruption, so a process-level kill (Ctrl-C, SIGTERM, SIGKILL, OOM, reboot) loses up to 99 history rows for the day. Ordinary Python exceptions cannot cause it: every in-loop step, including `driver.get`, is already wrapped. The lost day can be refilled by hand with `backfill_historical_prices.py --gaps-only`.
  - F086 (full, low): no run lock in `run_scraper.sh` and no Selenium page-load timeout, so a hanging TCGplayer page costs 120 to 300 s per product, can stretch a run past the 4-hour cron interval and overlap runs, and (the sharper symptom) the outer `except` in `get_price_and_image_from_url` throws away the API price already fetched, so prices stop updating while pages hang.
  - F082 (full, low): the service-role key and SMTP password are inherited by chromedriver and headless Chrome, which always runs `--no-sandbox` on third-party pages. Keeping the sandbox is the required part of the fix; the environment scrub is the complement.
  - F136 (full, low): `backfill_thumbnails.py` fetches `products.image_url` with none of `main.py`'s SSRF, redirect, size and magic-byte guards; `main.py` stores non-allowlisted image URLs as a fallback; and `build_thumbnail` (used by both paths) decodes any pixel count Pillow allows.
  - F137 (full, low): the headless-Chrome PDF render in `generate_weekly_report.py` has no timeout, so a hung Chrome blocks the weekly report forever with no PDF, no email and no failure notice.
  - F138 (full, low): `compare_prices.py` accepts the Shopify Admin API token on the command line.
  - F141 (full, info): `main.py` carries dead code, `check_shopify_prices()` importing a module that does not exist, and an unused `uuid` import.
- **Track 2 change** (requested by the product strategist, `01-PRODUCT-DIRECTION.md` §9 item 4; `research/trust-seo-brand.md` §1 item 13, §3, §8, §9, §14.4): the weekly PDF is emailed to readers, so its copy must follow the site's trust rules. The caveat names the source as "TCGplayer Market Price in USD" instead of "likely TCGPlayer market/listing values", the footer drops "internal analytical report" and "invest accordingly" and carries the site's disclaimer and trademark lines, and every `&mdash;` in reader-facing output becomes a comma, a colon or (for an empty cell) `--`. Step 10A.
- **Priority rationale**: these are the only findings in the Python pipeline that writes every price the site shows. After full re-verification every finding is low severity (F141 is info): F083 and F084 are the two with a visible symptom (a one-day price spike; a chart that skips a day after a killed run), and the rest are cheap defence in depth. The package keeps its place in the plan; the Track 2 copy change rides along because it edits a file this package already changes.
- **Effort**: M (6 to 8 hours for the executor, plus about 30 minutes of owner time: one migration and a scraper-host deploy with a Chrome smoke test). The Track 2 copy change adds about 30 minutes.
- **Depends on**: WP00 (plan order only; this package changes no frontend file). It is written against the code after WP11, which adds `revalidate_hook.py`, `run_jobs_once()` and return values to `main.py`; see "Before you start" for how to handle either state.
- **Unblocks**: WP21 (its least-privilege scraper role must be granted on the new `product_price_pending` table, and its schema baseline must include migration 0030) and WP20 (its generated `Database` types must contain `product_price_pending`, so 0030 must be applied in production before WP20 starts).
- **Parallel execution**: this package touches no `frontend/` file. It may run on its own branch in parallel with WP12 to WP19, but start it only after WP11 has merged (WP11 step 12 edits `main.py`, `tests/test_main.py` and adds `revalidate_hook.py` and `tests/test_revalidate_hook.py`, which this spec is written against).
- **Suggested branch name**: `remediation/wp16-python-pipeline-hardening`
- **Risk level**: medium. It changes the scraper's write path for every price and the flags Chrome starts with on the production host; a Chrome that cannot sandbox itself on that host would stop starting until the owner applies the documented escape hatch.

## Why

The scraper (`main.py`, run by cron through `run_scraper.sh` every 4 hours) writes every price the site shows. Today one glitched TCGplayer API value (for example `1499999` or `0.01`) is written straight to `products.usd_price` and into that day's price-history row. The current price self-heals on the next scrape about a day later, but the history row stays: a one-day spike on the product chart, and wrong 30D/90D/365D returns on the days that row is the anchor, until someone deletes it by hand. Separately, a run that is killed at the process level (Ctrl-C, SIGTERM, OOM, reboot) after updating a product but before its history buffer flushes loses up to 99 history rows for the day, because `last_updated` already moved and the products are not re-read until tomorrow. A hanging TCGplayer page can also stretch a run past the next cron slot (no page-load timeout, no run lock) and, worse, throws away the API price already fetched for that product. Chrome runs unsandboxed with the service-role key in its environment. After this PR: implausible prices are dropped, large jumps are written only when two consecutive runs agree, history is written before the product row moves, buffered rows are flushed on every exit path including SIGTERM, overlapping runs skip cleanly, Chrome gets a secret-free environment and keeps its sandbox when not root, the thumbnail backfill uses the same guarded fetch as the scraper and thumbnails refuse decompression bombs, the weekly PDF render cannot hang, and the Shopify token can no longer be passed on argv. The weekly PDF, which is emailed to readers, also stops calling itself an "internal analytical report", names its source correctly and carries the site's disclaimer (Track 2).

## Before you start

Read these files fully (line numbers are as of commit `a188fea`; WP11 inserts an import near `main.py:25`, changes `update_prices` returns and adds `run_jobs_once()` above `# === Run Script ===`, so locate code by the quoted anchors, not by number):

- `main.py` (1558 lines). Key regions: imports `:1-25`; image hardening constants and helpers `:29-81`, `:183-192`; thumbnail constants `:97-98` and `build_thumbnail` `:110-144`; `create_driver` `:623-674` (`--no-sandbox` at `:657`, `webdriver.Chrome(service=Service(ChromeDriverManager().install()), ...)` at `:669`); `download_and_upload_image` `:693-828`; `get_price_and_image_from_url` `:831-942` (`driver.get(url)` at `:864`, the outer `except` at `:940-942` that throws away the API price); `update_prices` `:1055-1307` (only price gate `:1144-1146`, write `:1161-1170`, raw TCGPlayer URL fallback `:1236-1240`, `products.update` `:1253`, 100-row flushes `:1261-1277`, post-loop flushes `:1281-1294`, `finally` without flushes `:1296-1301`); `_flush_price_history_batch` `:1310-1336`; `_flush_sales_history_batch` `:1351-1397`; `_flush_listings_history_batch` `:1400-1446`; `check_shopify_prices` `:1449-1487`; `__main__` `:1489-1559`.
- `backfill_thumbnails.py` (234 lines; the unguarded fetch is `:187-197`).
- `generate_weekly_report.py:17-35` (imports), `:410-456` (`pct`, `pct_n`, `fmt_release`), `:460-597` (`build_html`), `:614-637` (`find_chrome`, `render_pdf`), `:686-758` (`main`, which already returns 1 when `render_pdf` returns False), `:760-915` (`TEMPLATE`, the reader-facing copy changed in step 10A).
- `compare_prices.py:1-60`, `:615-696`.
- `run_scraper.sh` (89 lines) and `run_weekly_report.sh` (78 lines; not changed, read for context).
- `secrets_loader.py` (50 lines; not changed).
- `migrations/0003_integrity_constraints.sql:44-49` (the `(product_id, recorded_at::date)` unique index this package relies on) and `migrations/0015_product_sales_and_listings_history.sql:47-60, 145-166` (the DO-block constraint idiom and RLS/grant pattern copied here).
- `schema.sql:49-76` (`product_price_history`, `products`).
- `tests/test_main.py:14-22` (how tests import `main` with a mocked `secretsFile`) and `:621-735` (`TestNoScrapeTimeDrift` parses `price_update_interval_hours = 23` out of `update_prices` source, so that line must survive unchanged).
- `tests/test_new_functions.py:1-25`, `:378-452` (`TestFlushPriceHistoryBatch`, removed by this package).
- `tests/test_sales_volume.py:540-663` (mocking pattern for the flush helpers).
- `verify_migration.py:1-100` (what it verifies: privileges and RLS yes, constraints and CREATE TABLE no).
- `README.md:100-150` and `:255-275`; `audits/HARDENING_FOLLOWUPS.md:139-160` (section 7, where migration status is recorded).
- If WP11 has landed: `revalidate_hook.py` and `audits/remediation/WP11-next-caching-and-isr.md` step 12b.

Set up Python. The system interpreter in some containers cannot import `supabase` (a `cryptography`/`pyo3` panic), so always use a fresh virtualenv (Python 3.11 or newer):

```bash
cd /home/user/Pokefin
python3 -m venv /tmp/wp16-venv
/tmp/wp16-venv/bin/pip install -q -r requirements.txt pytest pyflakes
/tmp/wp16-venv/bin/python -m pytest tests/ -q -p no:cacheprovider
# expect: all pass. At a188fea this is "161 passed"; WP01 and WP11 add tests, so
# record the number N you see. After this package expect N - 4 + 65.
```

Confirm the starting state (repo root):

```bash
# F083: the only price gate is "price <= 0".
grep -n "price is not None and price <= 0" main.py            # expect 1 hit (~:1144)
# F084: history is buffered to 100 and the finally block does not flush.
grep -n "len(price_history_batch) >= 100" main.py            # expect 1 hit
sed -n '/^    finally:/,/^    logger.info(f"Done!/p' main.py  # expect cleanup_driver and api_session.close only
# F086: no timeout, no lock.
grep -n "set_page_load_timeout\|TimeoutException" main.py    # expect no output
grep -n "flock" run_scraper.sh                                # expect no output
# F082: unconditional --no-sandbox, Service without env.
grep -n '"--no-sandbox"\|Service(ChromeDriverManager().install())' main.py   # expect 2 hits
# F136: raw session.get in the backfill; raw src fallback in main.py.
grep -n "session.get(image_url" backfill_thumbnails.py        # expect 1 hit
grep -n 'update_data\["image_url"\] = tcg_image_url' main.py  # expect 1 hit
# F137: no timeout on the Chrome render.
grep -n "subprocess.run" generate_weekly_report.py            # expect 1 hit, no "timeout="
# F136: no decoded-size cap on thumbnails.
grep -n "THUMBNAIL_MAX_SOURCE_PIXELS" main.py                 # expect no output
# Track 2: the PDF copy to correct.
grep -n "likely TCGPlayer\|internal analytical report\|invest accordingly" generate_weekly_report.py   # expect 2 hits (~:848, ~:909)
grep -c "&mdash;" generate_weekly_report.py                   # expect 15 (lines; :848 holds two)
# F138: the token flag exists.
grep -n "shopify-token\|token_arg" compare_prices.py          # expect 4 hits
# F141: dead code.
grep -n "import uuid\|price_monitor\|def check_shopify_prices" main.py   # expect 3 hits
grep -rn "check_shopify_prices" --include=*.py --include=*.sh --include=*.md . | grep -v audits/   # expect only main.py:1450
# Next free migration number.
ls migrations | sort | tail -4
# WP11 state.
grep -n "run_jobs_once\|revalidate_hook\|return updated_count" main.py; ls revalidate_hook.py
```

Assumptions to check, with the default to pick:

1. **Migration number.** The plan expects WP01 to add `0024`/`0025`, WP06 `0026`, WP10 `0027` to `0029`, so this package adds `0030`. `0030` is reserved for this package in the plan-wide numbering (WP21 takes `0031`/`0032`), so use it whether or not `0024`-`0029` are already present; do not derive it from the highest file in `migrations/`. Only if a `0030_*` file that is not this package's already exists, stop and ask the owner for the number, then substitute it everywhere this spec says `0030` (file name, `load_pending_prices` log text, README, HARDENING_FOLLOWUPS) and say so in the PR body for WP21. The test globs `*_price_plausibility_guard.sql`, so it needs no change.
2. **WP11 landed or not.** If `run_jobs_once` exists, leave it and `revalidate_hook.py` untouched; `update_prices` already returns `0` / `updated_count` and the replacement below keeps those returns. If WP11 has not landed, still add the two returns (they are harmless) and do not create `run_jobs_once`.
3. **`--no-sandbox` must stay available.** Chrome refuses to start as root without it. The code below keeps it for root and for an explicit `POKEFIN_CHROME_NO_SANDBOX=1` override; do not remove the flag unconditionally.
4. **The scraper host is Linux with util-linux `flock`** (`run_weekly_report.sh:5` names "the Linux scraper host"). macOS has no `flock`; the script degrades to running without a lock and logs a WARN.

## Implementation steps

Do the steps in order. Steps 1 to 8 edit `main.py`; run `python -c "import ast; ast.parse(open('main.py').read())"` after each to catch indentation slips.

### Step 1. `main.py` imports (F141, F086, F083, F084)

At the top of `main.py`:

- Delete `import uuid` (`:10`). Nothing uses it.
- Add `import math` after `import logging`, and `import signal` after `import shutil`.
- Add `from selenium.common.exceptions import TimeoutException, WebDriverException` directly above `from selenium.webdriver.common.by import By`.

The result must read:

```python
import ipaddress
import logging
import math
import os
import platform
import random
import shutil
import signal
import socket
import tempfile
import time
import warnings
import re

import requests
from datetime import datetime, timedelta, timezone
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.common.by import By
```

(followed by the existing `supabase`, `urllib`, `webdriver_manager`, `secrets_loader` and, if WP11 landed, `revalidate_hook` imports, unchanged).

### Step 2. `main.py`: shared validated image fetch (F136)

Replace everything from the line `# === Image Download and Upload Logic ===` (`:692`) up to, not including, `# === Enhanced scraper with image extraction ===` (`:830`) with the block below. It moves the guards out of `download_and_upload_image` into `fetch_validated_image` unchanged except for two deliberate tightenings: any non-200 status is refused (the old `raise_for_status()` let a 3xx body through to the magic-byte check), and an optional `session` and `extra_allowed_hosts` let the backfill reuse it. Keep it in `main.py`: `backfill_thumbnails.py` already imports helpers from `main`, and tests patch `main._ip_is_safe` / `main.requests.get`.

```python
# === Image Download and Upload Logic ===
IMAGE_MIN_BYTES = 1000
IMAGE_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'DNT': '1',
    'Connection': 'keep-alive',
}


def fetch_validated_image(image_url, extra_allowed_hosts=(), session=None):
    """
    Download an image with every guard from audit findings F-1, F-2, F-3.
    Shared by download_and_upload_image() and backfill_thumbnails.py
    (audit 2026-09-25, F136). Never raises.

    Returns (image_bytes, fmt) with fmt in {"jpeg", "png", "webp"}, or None.

    - Scheme must be http/https. Host must pass _host_is_allowed() or match
      an entry of extra_allowed_hosts exactly (case-insensitive).
    - Every address the host resolves to must be public (_ip_is_safe).
    - allow_redirects=False, and anything but a 200 is refused.
    - A declared Content-Type must be jpeg/png/webp.
    - 8 MiB cap, enforced while streaming (Content-Length is not trusted).
    - At least IMAGE_MIN_BYTES, and the magic bytes must be jpeg/png/webp;
      the URL's extension is ignored.
    """
    try:
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"}:
            logger.warning("image_url has unsupported scheme: %s", parsed.scheme)
            return None
        host = (parsed.hostname or "").lower()
        extra_hosts = {h.lower() for h in extra_allowed_hosts if h}
        if not (_host_is_allowed(host) or host in extra_hosts):
            logger.warning("image_url host not in allowlist: %s", host)
            return None
        if not _ip_is_safe(host):
            logger.warning("image_url resolves to a private/reserved address: %s", host)
            return None

        getter = session.get if session is not None else requests.get
        # Stream so we can stop reading at the cap even if Content-Length lies.
        with getter(
            image_url,
            headers=IMAGE_REQUEST_HEADERS,
            timeout=30,
            stream=True,
            allow_redirects=False,
        ) as response:
            if response.status_code != 200:
                logger.warning("Image fetch returned HTTP %s", response.status_code)
                return None

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

        if len(buf) < IMAGE_MIN_BYTES:
            logger.warning("Image too small, likely not valid: %d bytes", len(buf))
            return None

        # Magic-number check trumps the URL-derived extension. This prevents
        # e.g. an SVG-with-script or an HTML page disguised as foo.jpg.
        fmt = _detect_image_format(bytes(buf[:32]))
        if fmt is None:
            logger.warning("Image magic bytes did not match jpeg/png/webp")
            return None
        return bytes(buf), fmt
    except Exception as e:
        logger.error("image_fetch_error err=%s", type(e).__name__)
        return None


def download_and_upload_image(image_url, product_id):
    """
    Download an image through fetch_validated_image(), then upload it to
    Supabase Storage. Returns the public URL or None. Never raises.
    """
    fetched = fetch_validated_image(image_url)
    if fetched is None:
        return None
    image_bytes, fmt = fetched

    try:
        file_extension = "jpg" if fmt == "jpeg" else fmt
        content_type = f"image/{fmt}"
        filename = f"products/{product_id}.{file_extension}"

        try:
            upload_response = supabase.storage.from_("product-images").upload(
                filename,
                image_bytes,
                {
                    "content-type": content_type,
                    "cache-control": IMAGE_CACHE_CONTROL_SECONDS,
                    "upsert": "true",
                },
            )

            # Best-effort thumbnail; never let it fail the real upload.
            upload_thumbnail(product_id, image_bytes)

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
```

### Step 2A. `main.py`: decoded-size cap in `build_thumbnail` (F136)

The 8 MiB download cap and the magic-byte check bound the bytes fetched, not the decoded image. Pillow only refuses images above about 179 million pixels (twice its default `MAX_IMAGE_PIXELS`), so a small PNG that declares, say, 12000 x 12000 pixels still decodes to about half a gigabyte, doubled again for the RGBA composite. This applies to the scraper's upload path and to the backfill, because both call `build_thumbnail`.

2A-a. Directly below the line `THUMBNAIL_QUALITY = 78` (`:98`), add:

```python
# A thumbnail source whose header declares more pixels than this is refused
# before it is decoded (audit 2026-09-25, F136). The download cap and the
# magic-byte check bound the bytes fetched, not the decoded size. Real
# TCGplayer product images are about 1000 x 1000.
THUMBNAIL_MAX_SOURCE_PIXELS = 20_000_000
```

2A-b. In `build_thumbnail`, directly below the line `        with PILImage.open(io.BytesIO(image_bytes)) as img:` and above its first comment line, insert (12-space indent, inside the `with`):

```python
            # PILImage.open reads only the header, so the size is known
            # before any pixel is decoded.
            width, height = img.size
            if width * height > THUMBNAIL_MAX_SOURCE_PIXELS:
                logger.warning(
                    "Thumbnail source declares %dx%d pixels; refusing to decode",
                    width, height,
                )
                return None
```

Leave the rest of `build_thumbnail` unchanged. Do not lower `PILImage.MAX_IMAGE_PIXELS` globally instead: it is process-wide state, and the explicit check is testable.

### Step 3. `main.py`: Chrome environment, sandbox and page-load timeout (F082, F086)

3a. Replace the line `# === Selenium Driver Setup ===` (`:622`, directly above `def create_driver():`) with:

```python
# === Selenium Driver Setup ===
# A page that has not finished loading after this long is abandoned; the API
# price is kept and only the image is skipped (audit 2026-09-25, F086).
# Without it chromedriver waits up to its W3C default of 300 s, while
# Selenium's own HTTP client gives up after 120 s and leaves chromedriver
# still navigating, so one hung page cost 120 to 300 s and could stall the
# next product too. Must stay well below 120 s so Selenium raises
# TimeoutException before its HTTP client times out.
PAGE_LOAD_TIMEOUT_SECONDS = 30

# Environment variables that never reach chromedriver or Chrome (audit F082).
# The scraper's env file is exported wholesale by run_scraper.sh, and Chrome
# renders third-party pages; a renderer compromise must not find the
# service-role key in /proc/self/environ. This is the complement, not the
# main control: an UNSANDBOXED renderer runs as the same user and can read
# ~/.config/pokefin/env directly, so keeping the sandbox (below) is what
# actually contains it.
_BROWSER_ENV_DENY_PREFIXES = (
    "SUPABASE_", "SMTP_", "SHOPIFY_", "REPORT_EMAIL", "REVALIDATE_",
    "TELEGRAM_", "POKEFIN_", "AWS_", "GITHUB_", "GH_",
)
_BROWSER_ENV_DENY_MARKERS = (
    "SECRET", "TOKEN", "PASSWORD", "PASSWD", "_PASS", "_KEY", "CREDENTIAL",
    "DATABASE_URL",
)


def scrubbed_browser_env(environ=None):
    """
    Copy of the environment without secrets, for the chromedriver Service
    (Chrome inherits chromedriver's environment). Never returns an empty
    dict: Selenium's Service treats a falsy env as "use os.environ".
    """
    source = os.environ if environ is None else environ
    clean = {}
    for name, value in source.items():
        upper = name.upper()
        if upper.startswith(_BROWSER_ENV_DENY_PREFIXES):
            continue
        if any(marker in upper for marker in _BROWSER_ENV_DENY_MARKERS):
            continue
        clean[name] = value
    if not clean:
        clean = {"PATH": os.defpath}
    return clean


def chrome_needs_no_sandbox():
    """
    True only when Chrome cannot use its sandbox: the process runs as root,
    or the operator forced it with POKEFIN_CHROME_NO_SANDBOX=1 (a host whose
    kernel blocks the sandbox). Everyone else keeps the sandbox (audit F082).
    """
    if os.environ.get("POKEFIN_CHROME_NO_SANDBOX") == "1":
        return True
    geteuid = getattr(os, "geteuid", None)
    return geteuid is not None and geteuid() == 0
```

3b. Inside `create_driver`, replace

```python
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
```

with

```python
    options.add_argument("--disable-gpu")
    if chrome_needs_no_sandbox():
        logger.warning(
            "Chrome is running WITHOUT its sandbox (running as root, or "
            "POKEFIN_CHROME_NO_SANDBOX=1). Run the scraper as an unprivileged user."
        )
        options.add_argument("--no-sandbox")
```

3c. Replace

```python
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
```

with

```python
    service = Service(ChromeDriverManager().install(), env=scrubbed_browser_env())
    driver = webdriver.Chrome(service=service, options=options)
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)
```

Leave every other option (`--headless=new`, `--disable-dev-shm-usage`, the per-run `--user-data-dir`, the `navigator.webdriver` script) as it is. Selenium 4.46's `Service(executable_path, ..., env=None)` passes `env` to `subprocess.Popen` for chromedriver, and Chrome inherits chromedriver's environment. `ChromeDriverManager().install()` runs in the Python process and still sees the full environment (it may need `GH_TOKEN` for GitHub rate limits), which is fine.

### Step 4. `main.py`: keep the API price when the page load fails (F086)

In `get_price_and_image_from_url`, replace

```python
        driver.get(url)

        # Allow client-side rendering to hydrate before image extraction
```

with

```python
        try:
            driver.get(url)
        except TimeoutException:
            logger.warning(
                f"Page load exceeded {PAGE_LOAD_TIMEOUT_SECONDS}s for {url}; "
                f"keeping the API price, skipping image extraction"
            )
            try:
                driver.execute_script("window.stop();")
            except Exception:
                pass
            return result
        except WebDriverException as e:
            logger.warning(
                f"Browser could not load {url} ({type(e).__name__}); "
                f"keeping the API price, skipping image extraction"
            )
            return result

        # Allow client-side rendering to hydrate before image extraction
```

`result` already holds the API price, sales buckets and `tcgplayer_product_id` at this point. Before this change a `driver.get` failure fell into the outer `except` (`:940-942`) and returned `price: None`, discarding a price the API had already delivered. `TimeoutException` must be caught before `WebDriverException` because it is a subclass. With a 30 s cap the worst case for ~306 products, every page hanging, is about 306 x (30 s + the ~10 s per-product baseline of API call and sleeps), roughly 3.4 hours, inside the 4-hour cron interval; the run lock in step 12 covers anything slower. Returning `result` here (instead of calling `window.stop()` and still trying image extraction) is deliberate: the price is what matters, and the image is retried within 24 hours.

### Step 5. `main.py`: price plausibility and history-first helpers (F083, F084)

Insert this block directly above `def update_prices():` (`:1055`):

```python
# === Price plausibility (audit 2026-09-25, F083) ===
# A scraped price at or above this is a malformed API response and is never
# written. The dearest tracked products are vintage sealed boxes; nothing
# legitimate comes near it. Must stay below PRICE_DB_MAX_USD.
PRICE_ABSOLUTE_MAX_USD = 500_000.0
# Upper bound enforced by the CHECK constraints in
# migrations/0030_price_plausibility_guard.sql. Keep the two in sync.
PRICE_DB_MAX_USD = 1_000_000.0
# A price that moved by this factor or more (up or down) against the stored
# price is held in product_price_pending and written only when the next run
# observes it again. A hard reject would lock in a previously wrong price
# forever and block real jumps on new releases and thin vintage items.
PRICE_LARGE_DELTA_RATIO = 3.0
# The confirming observation must be within this fraction of the held one.
PRICE_CONFIRM_TOLERANCE = 0.10
# A held observation older than this is stale and starts a new hold.
PRICE_PENDING_MAX_AGE = timedelta(hours=48)
# Sales and listings rows are flushed at least this often (audit F084).
HISTORY_FLUSH_EVERY = 25


def evaluate_scraped_price(new_price, current_price, pending, now):
    """
    Decide what to do with a freshly scraped price. Pure function.

    new_price      float from the API (already known to be not None)
    current_price  products.usd_price before this run, or None
    pending        None, or {"usd_price": float, "observed_at": aware datetime}
                   holding this product's unconfirmed observation from an
                   earlier run
    now            aware datetime of this observation

    Returns one of:
      "reject"   impossible value (non-finite, <= 0, or >= PRICE_ABSOLUTE_MAX_USD)
      "accept"   ordinary move, or no stored price to compare with
      "confirm"  large move that matches the held observation: write it
      "hold"     large move seen for the first time: do not write, hold it
    """
    if not math.isfinite(new_price) or new_price <= 0 or new_price >= PRICE_ABSOLUTE_MAX_USD:
        return "reject"
    if current_price is None or current_price <= 0:
        return "accept"
    ratio = new_price / current_price
    if (1.0 / PRICE_LARGE_DELTA_RATIO) < ratio < PRICE_LARGE_DELTA_RATIO:
        return "accept"
    if pending:
        held = pending.get("usd_price")
        observed_at = pending.get("observed_at")
        if (
            held
            and observed_at is not None
            and observed_at < now
            and now - observed_at <= PRICE_PENDING_MAX_AGE
            and abs(new_price - held) <= PRICE_CONFIRM_TOLERANCE * held
        ):
            return "confirm"
    return "hold"


def load_pending_prices():
    """
    Read every held observation from product_price_pending.

    Returns {product_id: {"usd_price": float, "observed_at": datetime}}, or
    None when the table cannot be read (for example migration 0030 is not
    applied yet). None makes update_prices accept large moves unconfirmed,
    which is the behaviour before this guard existed, and logs an ERROR.
    The table only ever holds a handful of rows, so one request is enough.
    """
    try:
        response = supabase.table("product_price_pending")\
            .select("product_id, usd_price, observed_at")\
            .execute()
    except Exception as e:
        logger.error(
            "product_price_pending could not be read (has "
            "migrations/0030_price_plausibility_guard.sql been applied?); "
            f"large price moves will be accepted unconfirmed this run: {e}"
        )
        return None

    pending = {}
    for row in response.data or []:
        product_id = row.get("product_id")
        price = row.get("usd_price")
        observed_at = parse_timestamp(row.get("observed_at"))
        if product_id is None or price is None or observed_at is None:
            continue
        pending[product_id] = {"usd_price": float(price), "observed_at": observed_at}
    return pending


def save_pending_price(product_id, price, now):
    """Upsert this product's held observation. Never raises."""
    try:
        supabase.table("product_price_pending").upsert(
            {"product_id": product_id, "usd_price": price, "observed_at": now.isoformat()},
            on_conflict="product_id",
        ).execute()
        return True
    except Exception as e:
        logger.error(f"   Could not hold pending price for product {product_id}: {e}")
        return False


def clear_pending_price(product_id):
    """Delete this product's held observation. Never raises."""
    try:
        supabase.table("product_price_pending").delete().eq("product_id", product_id).execute()
        return True
    except Exception as e:
        logger.warning(f"   Could not clear pending price for product {product_id}: {e}")
        return False


def _is_duplicate_key_error(exc):
    """True when the exception is a unique-violation (23505)."""
    text = str(exc)
    return "23505" in text or "duplicate key" in text.lower()


def _insert_price_history_row(product_id, price):
    """
    Write today's price-history row for one product. update_prices calls
    this BEFORE it updates the products row (audit F084), so a crash or kill
    can never leave products.last_updated advanced without the matching
    history row.

    Returns True when today's row is in the table afterwards: inserted now,
    or already there from an earlier attempt today (the unique
    (product_id, recorded_at::date) index from migration 0003 rejects the
    duplicate). Returns False on any other failure. Never raises.
    """
    try:
        supabase.table("product_price_history").insert(
            {"product_id": product_id, "usd_price": price}
        ).execute()
        return True
    except Exception as e:
        if _is_duplicate_key_error(e):
            logger.info(f"   Price history already has today's row for product {product_id}")
            return True
        logger.error(f"   Price history insert failed for product {product_id}: {e}")
        return False
```

Design notes (do not change without reason):

- `PRICE_ABSOLUTE_MAX_USD = 500000`: the catalogue includes vintage sealed product ("1st Edition" variants, `generate_weekly_report.py:829,901`), so a low cap such as the reviewer's 50,000 could permanently reject a real price. The owner checks the current maximum before applying the migration (Owner actions step 1).
- The ratio test is against the stored `products.usd_price`. A held value lives in its own table, not on `products`, because `products` is readable by anon through PostgREST and its rows are shipped to the frontend.
- A held or rejected price leaves `last_updated` untouched, so `fetch_products_needing_update` selects the product again on the next cron run (4 hours later, not tomorrow). That next run is the "second consecutive observation".
- `load_pending_prices` returning `None` (table missing or unreadable) makes the run behave as before this package, with an ERROR line, rather than freezing every moving price.
- `HISTORY_FLUSH_EVERY = 25` means the sales batch flushes after almost every product, because one product can contribute up to about 30 daily sales buckets. That is expected (about one extra upsert per product per run), not a bug; do not raise the threshold back to 100.
- `backfill_historical_prices.py` also inserts `product_price_history` rows. It is not changed here: F083 is about the cron scraper, and the backfill's rows are covered by the new CHECK (its insert falls back to one row at a time, so one out-of-range row fails alone).

### Step 6. `main.py`: rewrite the body of `update_prices` (F083, F084, F136)

6a. Change the docstring line `"""Main function to update product prices and images."""` to:

```python
    """
    Main function to update product prices and images.
    Returns the number of products whose row was updated.
    """
```

6b. In the early exit, `logger.info("No products requiring updates (within time windows).")` must be followed by `return 0` (WP11 already made this change; make it if missing).

6c. Keep everything from the 23-hour comment block through the "Products to update by type" logging exactly as it is. In particular the line `    price_update_interval_hours = 23` must stay byte-identical: `tests/test_main.py::TestNoScrapeTimeDrift` parses it from the function source.

6d. Replace everything from `    driver = None` (`:1109`) to the end of the function (the last `logger.info(... listings snapshots written ...)` call, plus WP11's `return updated_count` if present) with the block below. It removes `price_history_batch` entirely (history is now written per product, before the product row, by `_insert_price_history_row`), flushes sales and listings every `HISTORY_FLUSH_EVERY` (25) rows, moves the final flush into `finally` so it runs on every exit path, and applies the price decision:

```python
    driver = None
    user_data_dir = None
    api_session = requests.Session()
    updated_count = 0
    sales_history_batch = []  # Collect daily sales-volume rows for batch upsert
    listings_history_batch = []  # Collect listings-depth snapshots for batch upsert
    sales_rows_written = 0
    sales_rows_failed = 0
    listings_rows_written = 0
    listings_rows_failed = 0
    prices_held = 0
    prices_rejected = 0

    # Held large-move observations from earlier runs (audit F083). None means
    # the table is unavailable and large moves are accepted unconfirmed.
    pending_prices = load_pending_prices()

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
            tcg_image_url = scraped_data.get('image_url')
            now = datetime.now(timezone.utc)

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
                decision = evaluate_scraped_price(
                    price,
                    current_price,
                    (pending_prices or {}).get(product_id),
                    now,
                )
                if decision == "hold" and pending_prices is None:
                    logger.error(
                        f"   Large price move {current_price} -> {price} accepted "
                        f"UNCONFIRMED: product_price_pending is unavailable"
                    )
                    decision = "accept"

                if decision == "reject":
                    prices_rejected += 1
                    logger.warning(
                        f"   Rejected implausible price {price!r} for product "
                        f"{product_id} (cap ${PRICE_ABSOLUTE_MAX_USD:,.0f}); keeping {current_price}"
                    )
                elif decision == "hold":
                    prices_held += 1
                    if save_pending_price(product_id, price, now):
                        pending_prices[product_id] = {"usd_price": price, "observed_at": now}
                    logger.warning(
                        f"   Price for product {product_id} moved {current_price} -> {price} "
                        f"({PRICE_LARGE_DELTA_RATIO:g}x or more); holding it until the next "
                        f"run confirms it. Stored price and last_updated unchanged."
                    )
                else:
                    # "accept" or "confirm". History first (audit F084): the
                    # products row only advances once today's history row exists.
                    if _insert_price_history_row(product_id, price):
                        update_data["usd_price"] = price
                        update_data["last_updated"] = now.isoformat()
                        if decision == "confirm":
                            logger.warning(
                                f"   Confirmed large price move for product {product_id}: "
                                f"{current_price} -> {price}"
                            )
                        logger.info(f"   Updated price: ${price:.2f}")
                        if pending_prices and product_id in pending_prices:
                            clear_pending_price(product_id)
                            pending_prices.pop(product_id, None)
                    else:
                        logger.warning(
                            f"   Price history write failed for product {product_id}; "
                            f"leaving usd_price and last_updated unchanged so the next run retries"
                        )

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
                        update_data["last_image_update"] = now.isoformat()
                        logger.info(f"   Updated image: {uploaded_image_url}")
                    else:
                        # Store the TCGPlayer URL as a fallback only when it is
                        # an https URL on an allowlisted host (audit F136). A URL
                        # fetch_validated_image refused must never reach
                        # products.image_url, where backfill_thumbnails.py and
                        # browsers would load it later.
                        fallback = urlparse(tcg_image_url)
                        if fallback.scheme == "https" and _host_is_allowed((fallback.hostname or "").lower()):
                            update_data["image_url"] = tcg_image_url
                            logger.warning(f"   Using direct TCGPlayer image URL: {tcg_image_url}")
                        else:
                            logger.warning(
                                f"   Image upload failed and {fallback.hostname!r} is not an "
                                f"allowlisted https host; keeping the current image"
                            )
                        update_data["last_image_update"] = now.isoformat()
                else:
                    # Same image URL, just update timestamp
                    update_data["last_image_update"] = now.isoformat()
                    logger.info("   Image URL unchanged, updated timestamp")
            elif needs_image_update:
                # Update timestamp even if no image found to avoid repeated attempts
                update_data["last_image_update"] = now.isoformat()
                logger.warning("   No image found, updated timestamp to avoid retry")

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

            # Flush sales/listings history often, so an interruption loses at
            # most HISTORY_FLUSH_EVERY - 1 rows of each (audit F084).
            if len(sales_history_batch) >= HISTORY_FLUSH_EVERY:
                flushed_ok, flushed_failed = _flush_sales_history_batch(sales_history_batch)
                sales_rows_written += flushed_ok
                sales_rows_failed += flushed_failed
                sales_history_batch = []

            if len(listings_history_batch) >= HISTORY_FLUSH_EVERY:
                flushed_ok, flushed_failed = _flush_listings_history_batch(listings_history_batch)
                listings_rows_written += flushed_ok
                listings_rows_failed += flushed_failed
                listings_history_batch = []

            time.sleep(1)  # polite delay between requests

    finally:
        # Runs on every exit path: normal completion, an exception, Ctrl-C,
        # and SIGTERM (the __main__ block turns SIGTERM into SystemExit).
        # Both flush helpers never raise.
        if sales_history_batch:
            flushed_ok, flushed_failed = _flush_sales_history_batch(sales_history_batch)
            sales_rows_written += flushed_ok
            sales_rows_failed += flushed_failed
            sales_history_batch = []

        if listings_history_batch:
            flushed_ok, flushed_failed = _flush_listings_history_batch(listings_history_batch)
            listings_rows_written += flushed_ok
            listings_rows_failed += flushed_failed
            listings_history_batch = []

        cleanup_driver(driver, user_data_dir)
        try:
            api_session.close()
        except Exception:
            pass

    logger.info(f"Done! {updated_count} products updated out of {len(products_to_update)} checked.")
    logger.info(
        f"Prices held for confirmation: {prices_held}; rejected as implausible: {prices_rejected}"
    )
    logger.info(
        f"Sales history rows written: {sales_rows_written} (failed: {sales_rows_failed}); "
        f"listings snapshots written: {listings_rows_written} (failed: {listings_rows_failed})"
    )
    return updated_count
```

6e. Delete `_flush_price_history_batch` (`:1310-1336`) entirely. After step 6d nothing calls it (`grep -n "_flush_price_history_batch" main.py` must print nothing). Keep `_volume_tables_missing`, `_is_missing_table_error`, `_flush_sales_history_batch` and `_flush_listings_history_batch` unchanged.

Why history-first per product rather than a bigger buffer: ~300 single-row inserts per day cost about 30 seconds in a 20-minute run, and they give a strict happens-before. If the process dies between the history insert and `products.update`, the product still qualifies next run (its `last_updated` did not move), the history insert hits the `(product_id, recorded_at::date)` unique index, `_insert_price_history_row` treats that duplicate as "already written", and the product row is updated. No gap, no double row.

### Step 7. `main.py`: delete the dead Shopify check (F141)

Delete the whole block from the line `# === Shopify Price Check ===` (`:1449`) through the end of `check_shopify_prices` (the `logger.error(f"Shopify price check failed: {e}")` line, `:1486`), leaving one blank line pair before the next top-level code. `compare_prices.py` is the real Shopify comparison; do not move this function there.

### Step 8. `main.py`: SIGTERM runs the `finally` block (F084)

Python's default SIGTERM action ends the process without running `finally` blocks, so without this the flush in step 6d does not run when cron, systemd or `kill` stops the scraper.

8a. Directly above the line `# === Run Script ===` (and below WP11's `run_jobs_once` if present), add:

```python
def _exit_on_sigterm(signum, frame):
    raise SystemExit(128 + signum)


def install_sigterm_handler():
    """
    Turn SIGTERM (cron or systemd stop, `timeout`, `kill`) into SystemExit so
    update_prices' finally block flushes buffered history rows and closes
    Chrome (audit 2026-09-25, F084). Python's default SIGTERM action ends the
    process without running finally blocks.
    """
    signal.signal(signal.SIGTERM, _exit_on_sigterm)
```

8b. In the `__main__` block, directly after `    args = parser.parse_args()`, add `    install_sigterm_handler()`.

`SystemExit` is a `BaseException`, so WP11's `run_jobs_once` (`except Exception`) does not swallow it: the process exits with status 143 after `update_prices`' `finally` has flushed and closed Chrome.

### Step 9. `backfill_thumbnails.py`: use the guarded fetch (F136)

9a. Add `from urllib.parse import urlparse` after `import time` (`:28`).

9b. Delete `REQUEST_TIMEOUT = 30` (`:47`); nothing else uses it.

9c. In `main()`, change the helper import (`:141`) to:

```python
        from main import build_thumbnail, fetch_validated_image, upload_thumbnail  # noqa: F401
```

9d. Directly above `    session = requests.Session()` (`:164`), add:

```python
    # Stored images live in this project's Storage bucket; legacy rows may
    # still point at TCGPlayer's CDN, which main.py's allowlist covers.
    storage_hosts = (urlparse(SUPABASE_URL).hostname or "",)
```

9e. Replace the fetch block (`:187-197`, from `            try:` through the `continue` after `logger.warning(f"   Image fetch failed: {e}")` and `failed += 1`) with:

```python
            # Same SSRF, redirect, size and magic-byte guards as the scraper
            # (audit 2026-09-25, F136). Never raises; logs why it refused.
            fetched = fetch_validated_image(
                image_url,
                extra_allowed_hosts=storage_hosts,
                session=session,
            )
            if fetched is None:
                failed += 1
                continue
            original, _fmt = fetched
```

The rest of the loop (`build_thumbnail(original)`, `upload_thumbnail(...)`, byte accounting) is unchanged. Only the exact Supabase project host is added to the allowlist, not `*.supabase.co`.

### Step 10. `generate_weekly_report.py`: bounded PDF render (F137)

10a. In the imports (`:19-28`) add `import signal` on the line before `import subprocess` and `import tempfile` on the line after it (between `import subprocess` and `import time`).

10b. Directly above `def render_pdf(html_path, pdf_path):` add:

```python
# Upper bound for one headless-Chrome PDF render (audit 2026-09-25, F137).
# A normal render takes a few seconds, but some Chrome builds never exit
# after --print-to-pdf; that used to block the weekly job forever with no
# PDF, no email and no failure notice.
PDF_RENDER_TIMEOUT_SECONDS = 180


def _kill_process_tree(proc):
    """Kill Chrome and every helper it started (they share its session)."""
    try:
        if hasattr(os, "killpg"):
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
```

10c. In `render_pdf`, keep the first four lines (`chrome = find_chrome()`, the `if not chrome:` check, its existing "Chrome not found" `print` and `return False`) exactly as they are, and replace everything after them (the `subprocess.run(...)` call and `return os.path.exists(pdf_path)`) with:

```python
    # A PDF left by an earlier run for the same anchor date must not be
    # mistaken for this run's output.
    try:
        os.remove(pdf_path)
    except FileNotFoundError:
        pass

    # Throwaway profile, removed afterwards. Defence in depth only: the
    # timeout below is what fixes a hang.
    profile_dir = tempfile.mkdtemp(prefix="pokefin_report_chrome_")
    cmd = [chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
           "--no-first-run", "--no-default-browser-check",
           f"--user-data-dir={profile_dir}",
           f"--print-to-pdf={pdf_path}", html_path]
    try:
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True)
        except OSError as e:
            print(f"  ! Could not start Chrome at {chrome}: {e}", file=sys.stderr)
            return False
        try:
            returncode = proc.wait(timeout=PDF_RENDER_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _kill_process_tree(proc)
            print(f"  ! Chrome did not finish the PDF within "
                  f"{PDF_RENDER_TIMEOUT_SECONDS}s and was killed.", file=sys.stderr)
            return False
        if returncode != 0:
            print(f"  ! Chrome exited with status {returncode}; no PDF.",
                  file=sys.stderr)
            return False
        return os.path.exists(pdf_path)
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)
```

Why `Popen` plus a process group instead of `subprocess.run(timeout=180)`: `run` kills only the direct child, and Chrome's renderer and GPU helpers can outlive it holding the profile. `start_new_session=True` puts Chrome and its helpers in one process group that `os.killpg` removes together. Deleting a stale `pdf_path` first matters because the file name is keyed on the anchor date, so a second run for the same anchor would otherwise report the previous run's PDF as fresh. `main()` (`:734-738`) already prints an error and returns 1 when `render_pdf` returns False, so `run_weekly_report.sh` reports the failure; no change there.

### Step 10A. `generate_weekly_report.py`: reader-facing copy (Track 2)

The PDF is emailed to readers, so it follows the site's trust rules (`research/trust-seo-brand.md` §1 item 13, §3, §8, §9, §14.4): the source is named as "TCGplayer Market Price" (lower-case "p", the company's own spelling), the report does not call itself internal or tell readers to "invest accordingly", the footer carries the same disclaimer and trademark lines as the site footer (WP24's `disclosures.ts`), and there are no em dashes. Make exactly these replacements; each "old" text occurs exactly once unless stated. Change only the strings listed: the literal em dash characters (U+2014) in comments, docstrings and the two `print(...)` log lines in `main()` and `render_pdf` are not reader-facing and stay.

10A-a. Empty cells. In `pct` and in `pct_n`, replace `        return '<td>&mdash;</td>'` (2 occurrences) with `        return '<td>--</td>'`. In `fmt_release`, replace `        return "&mdash;"` with `        return "--"`. In `build_html`, the line that starts `        if best_set_1y else ("n/a", ` ends in a one-character string holding a literal em dash (U+2014); replace that string with `"--"` so the line reads `        if best_set_1y else ("n/a", "--")`. `--` is the site's marker for a missing value (`01-PRODUCT-DIRECTION.md` principle 1); a comma or colon cannot stand alone in a cell.

10A-b. In `build_html`, replace the two lines

```python
        f"product{'s' if excluded != 1 else ''}</strong> from every ranking "
        f"&mdash; fewer than {LIQUIDITY_MIN_DISTINCT_PRICES} distinct tracked "
```

with

```python
        f"product{'s' if excluded != 1 else ''}</strong> from every ranking: "
        f"fewer than {LIQUIDITY_MIN_DISTINCT_PRICES} distinct tracked "
```

10A-c. In `TEMPLATE`, replace each "old" with "new":

| Old | New |
|---|---|
| `<span>Vol. {vol} &mdash; No. {issue}</span>` | `<span>Vol. {vol}, No. {issue}</span>` |
| `Fit to Hold&rdquo; &mdash; A Data Report` | `Fit to Hold&rdquo;: A Data Report` |
| `Returns by Product Category &mdash; The Master Table` | `Returns by Product Category: The Master Table` |
| `(per-column sample size in parentheses) &mdash; ranked by 6-month return` | `(per-column sample size in parentheses), ranked by 6-month return` |
| `Best-Performing Sets &mdash; The Out-of-Print Effect` | `Best-Performing Sets: The Out-of-Print Effect` |
| `anniversary and special sets &mdash; precisely the products` | `anniversary and special sets, precisely the products` |
| `The Investor's Verdict &mdash; What To Actually Do` | `The Investor's Verdict: What To Actually Do` |
| `over the stated window &mdash; a description of what happened` | `over the stated window, a description of what happened` |
| `Vintage items trade thin &mdash; one listing can move the price.` | `Vintage items trade thin: one listing can move the price.` |
| `THE POK&Eacute;FIN WEEKLY &mdash; Automated Analytics Edition.` | `THE POK&Eacute;FIN WEEKLY, Automated Analytics Edition.` |

10A-d. In `TEMPLATE`, the "How To Read This" caveat. Replace the text between `<p class="caveat" style="margin-bottom:0;">` and `</p>` that starts `Figures are <strong>unrealized</strong> tracked prices (likely TCGPlayer` with this single line:

```
Figures are TCGplayer Market Price in USD, <strong>unrealized</strong> and before fees. A median of +47% means the typical product in that category is worth 47% more than at the lookback date, not that every product rose. Each cell states the number of products behind it; windows differ because older windows exclude products whose history does not reach back that far. Cells with fewer than three products are shown as -- rather than a figure.
```

"TCGplayer Market Price" is accurate for every row: the scraper reads `marketPrice` from TCGplayer's price-history buckets (`main.py:309`), and `backfill_historical_prices.py` reads the same field.

10A-e. In `TEMPLATE`, the footer. Replace the final three sentences of the footer, from `Prices in USD. This document is an internal analytical report` through `invest accordingly.`, with this single line (keep the sentences before it, as edited in 10A-c):

```
Prices are TCGplayer Market Price in USD. Sealed collectible markets are volatile and illiquid. Market data for information only, not financial advice. Past prices do not predict future prices. Pok&eacute;mon and Pok&eacute;mon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Pok&eacute;fin is not affiliated with, endorsed or sponsored by Nintendo, The Pok&eacute;mon Company, Creatures or GAME FREAK. TCGplayer is a trademark of TCGplayer, Inc. Pok&eacute;fin is not affiliated with TCGplayer.
```

The disclaimer sentence is the site footer's line word for word (`research/trust-seo-brand.md` §8, WP24 `disclosures.ts`); the two trademark sentences are §9's, as WP24 ships them. They are included because `research/trust-seo-brand.md` §3 asks for the non-affiliation line in the PDF footer too.

10A-f. Check: `grep -c "&mdash;" generate_weekly_report.py` prints `0`, and `grep -n "likely TCGPlayer\|internal analytical report\|invest accordingly" generate_weekly_report.py` prints nothing. Do not change the masthead slogan, the section headings' words, `send_weekly_email.py` or `write_summary`: the research leaves the slogan to the owner, and the email body is rewritten by the newsletter work in Track 2.

### Step 11. `compare_prices.py`: token from the environment only (F138)

11a. Module docstring: replace the usage line

```
  python compare_prices.py --shopify-source api --shopify-domain my-store.myshopify.com --shopify-token shpat_xxx
```

with

```
  SHOPIFY_ADMIN_API_TOKEN=... python compare_prices.py --shopify-source api --shopify-domain my-store.myshopify.com

The Shopify Admin API token is read from SHOPIFY_ADMIN_API_TOKEN in the
environment (or the local secretsFile.py), never from the command line: argv
is visible to every local user via ps and is saved in shell history. To keep
it out of history too, type it at a prompt:
  read -rs SHOPIFY_ADMIN_API_TOKEN && export SHOPIFY_ADMIN_API_TOKEN
This script only reads products, so a custom-app token with read_products
scope is enough.
```

11b. Replace `_get_shopify_credentials` (`:52-57`) with:

```python
def _get_shopify_credentials(domain_arg: str | None, api_version_arg: str | None) -> tuple[str, str, str]:
    """Resolve Shopify credentials. The token comes from the environment or secretsFile.py only."""
    domain = (domain_arg or os.getenv("SHOPIFY_STORE_DOMAIN") or SHOPIFY_STORE_DOMAIN or "").strip()
    token = (os.getenv("SHOPIFY_ADMIN_API_TOKEN") or SHOPIFY_ADMIN_API_TOKEN or "").strip()
    api_version = (api_version_arg or os.getenv("SHOPIFY_API_VERSION") or SHOPIFY_API_VERSION or "2024-07").strip()
    return domain, token, api_version
```

11c. In `fetch_shopify_products_api` (`:63`), change the error text to `"Shopify domain/token missing. Set SHOPIFY_STORE_DOMAIN (or --shopify-domain) and SHOPIFY_ADMIN_API_TOKEN in the environment, or in secretsFile.py"`.

11d. Replace the `--shopify-token` argument (`:637-640`) with a hidden one:

```python
    # Removed option, kept hidden only to fail with a clear message instead
    # of argparse echoing the token back in an "unrecognized arguments" error.
    parser.add_argument(
        "--shopify-token",
        help=argparse.SUPPRESS,
    )
```

11e. Directly after `    args = parser.parse_args()` add:

```python
    if args.shopify_token is not None:
        parser.error(
            "--shopify-token was removed because command-line arguments are "
            "visible to other users and saved in shell history. Set "
            "SHOPIFY_ADMIN_API_TOKEN in the environment instead."
        )
```

11f. In the `if args.shopify_source == "api":` branch, drop the `args.shopify_token,` argument from the `_get_shopify_credentials(...)` call.

`secrets_loader.py` is not changed: its `secretsFile.py` fallback is the documented local-development path for every credential and is not argv.

### Step 12. `run_scraper.sh`: run lock (F086)

12a. Directly after `log_message "Changed to directory: $PROJECT_DIR"` (`:23`) and before the env-file comment block, insert:

```bash
# One scraper run at a time (audit 2026-09-25, F086). cron starts a run every
# 4 hours; a run slowed down by TCGPlayer must not overlap the next one. The
# lock belongs to file descriptor 9 of this shell, so the kernel releases it
# when this script exits for any reason (including kill -9): there is never a
# stale lock to clean up. main.py gets fd 9 closed (see below) so a leftover
# Chrome process can never keep the lock alive.
LOCK_FILE="$PROJECT_DIR/.scraper.lock"
if command -v flock >/dev/null 2>&1; then
    if ! exec 9>"$LOCK_FILE"; then
        log_message "ERROR: cannot open lock file $LOCK_FILE"
        exit 1
    fi
    if ! flock -n 9; then
        log_message "Another scraper run still holds $LOCK_FILE; skipping this run"
        exit 0
    fi
    log_message "Acquired run lock $LOCK_FILE"
else
    log_message "WARN: flock not found; running without a run lock (install util-linux)"
fi
```

12b. Replace the invocation line (`:71`)

```bash
python main.py --run-now 2>&1 | while IFS= read -r line; do
```

with

```bash
# 9>&- : main.py and the Chrome it starts do not inherit the lock descriptor.
python main.py --run-now 9>&- 2>&1 | while IFS= read -r line; do
```

The lock is taken before the env file is sourced, so a skipped run never loads secrets. `exit_code=${PIPESTATUS[0]}` keeps meaning "python's exit status" because `flock` is not in the pipeline. If WP11 added `REVALIDATE_*` lines to the env-file comment, keep them.

12c. `.gitignore`: add, under the `# Selenium scrape dumps` group:

```
# Scraper run lock (run_scraper.sh)
.scraper.lock
```

### Step 13. `migrations/0030_price_plausibility_guard.sql` (new, F083)

Create the file with exactly this content (keep `0030` unless the owner assigned another number, see "Before you start"):

```sql
-- Migration: plausibility guard for scraped prices (review 2026-09-25, F083).
--
-- 1. Upper bound on usd_price for products and product_price_history, plus
--    the > 0 lower bound products never had (history already has it). The
--    scraper drops prices at or above PRICE_ABSOLUTE_MAX_USD (500000,
--    main.py) before they reach the database; these CHECKs are the backstop
--    for every other writer. 1000000 must match PRICE_DB_MAX_USD in main.py.
-- 2. public.product_price_pending holds a scraped price that moved 3x or more
--    (up or down) against the stored price. main.py writes such a price only
--    when the next run observes it again within 10 percent. Only the scraper
--    (service_role) uses this table: RLS is on with no policies, and PUBLIC,
--    anon and authenticated hold no privileges.
--
-- Idempotent: the constraints are added in DO blocks that ignore an existing
-- constraint of the same name, and the table uses IF NOT EXISTS.
--
-- Pre-check (run first; must return zero rows, see WP16 Owner actions):
--   SELECT 'products' AS tbl, id, usd_price FROM public.products
--    WHERE usd_price IS NOT NULL AND (usd_price <= 0 OR usd_price >= 1000000)
--   UNION ALL
--   SELECT 'product_price_history', id, usd_price FROM public.product_price_history
--    WHERE usd_price >= 1000000;
--
-- Verification:
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conname IN ('products_usd_price_sane',
--                      'product_price_history_usd_price_sane');
--   (expect 2 rows, convalidated = true)
--   python3 verify_migration.py migrations/0030_price_plausibility_guard.sql
--   (paste the printed SQL; expect 26 rows, all OK)

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_usd_price_sane
      CHECK (usd_price IS NULL OR (usd_price > 0 AND usd_price < 1000000));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_price_history
    ADD CONSTRAINT product_price_history_usd_price_sane
      CHECK (usd_price < 1000000);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.product_price_pending (
  product_id bigint PRIMARY KEY
    REFERENCES public.products(id) ON DELETE CASCADE,
  usd_price double precision NOT NULL
    CHECK (usd_price > 0 AND usd_price < 1000000),
  observed_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.product_price_pending ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_price_pending FROM PUBLIC;
REVOKE ALL ON public.product_price_pending FROM anon;
REVOKE ALL ON public.product_price_pending FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_pending TO service_role;
```

Do not edit `schema.sql` (WP21 regenerates it from production) or `verify_migration.py`.

### Step 14. Tests

Create `tests/test_pipeline_hardening.py` and edit `tests/test_new_functions.py` as described in the Tests section below.

### Step 15. Documentation

15a. `README.md`, in the "How It Works" list, append to item 2 (the paragraph ending "since only `month` is daily."):

```markdown
   A price that is not a finite positive number, or is $500,000 or more, is
   dropped. A price that moved 3x or more against the stored one is held in
   `product_price_pending` and written only when the next run sees it again
   (within 10%). Each accepted price's history row is written before the
   product row, so an interrupted run never leaves a product marked updated
   without its history.
```

15b. `README.md`, directly after the code block that ends with `./run_scraper.sh` (`:140-141`), add:

```markdown
`run_scraper.sh` holds a `flock` run lock on `.scraper.lock`; if the previous
run is still going, the next cron invocation logs "skipping this run" and
exits 0. Run it as an unprivileged user: Chrome keeps its sandbox unless the
process is root (or `POKEFIN_CHROME_NO_SANDBOX=1` is set in the env file for a
host whose kernel blocks the sandbox), and chromedriver and Chrome receive a
copy of the environment with every `SUPABASE_*`, `SMTP_*`, `SHOPIFY_*`,
`REVALIDATE_*` and other secret-looking variable removed.
```

15c. `audits/HARDENING_FOLLOWUPS.md` section 7 (`## 7. Round-2 follow-ups`, `:139`). The old bullet about migrations 0008 to 0014 stays where it is (WP04 put its "Signed-in data ran as anon" bullet above it; leave that too). The newest-first run of migration bullets starts right below the 0008-0014 bullet. Insert this bullet directly above the topmost bullet added by WP10, WP06 or WP01 (their text starts with "**Migrations 0027, 0028 and 0029", "**Migration 0026" or "**Migrations 0024 and 0025"), whichever is highest in the file. If none of those is present, insert it directly above the bullet that starts with `- **Migration 0022 applied**`:

```markdown
- **Migration 0030: pending apply** (WP16, review finding F083). Adds
  `products_usd_price_sane` and `product_price_history_usd_price_sane`
  (usd_price below 1000000, products also above 0) and the scraper-only
  table `product_price_pending` (RLS on, no policies, no anon or
  authenticated privileges). Owner: run the pre-check in the file header
  first, then replace "pending apply" with "applied (YYYY-MM-DD, via
  Supabase MCP)" or "(..., via SQL editor)".
```

Do not write "applied" yourself.

## Pitfalls: do not do this

- **Do not hard-reject prices outside +/-5x (or any ratio) of the current price.** Verifier correction on F083: it would permanently lock in a previously wrong price, since nothing could ever move it back, and it would reject legitimate jumps on new releases and thin vintage items. Hold and confirm on the next run, as step 5 does. `test_a_wrong_stored_price_can_always_be_corrected` guards this.
- **Do not use the reviewer's 50,000 USD cap.** The catalogue tracks vintage sealed product; keep `PRICE_ABSOLUTE_MAX_USD = 500000` and let the owner confirm the real maximum.
- **Do not store the pending value in new columns on `products`.** `products` is anon-readable through PostgREST and feeds frontend payloads; a separate RLS-locked table keeps held values private and keeps WP21's grants explicit.
- **Do not bump `last_updated` (or write history) for a held or rejected price.** The product must be selected again on the next cron run; that re-read is the confirmation.
- **Do not fail closed when `product_price_pending` is unreadable.** Holding every large move with nowhere to store it would freeze those prices forever. Accept and log at ERROR, as the code does.
- **Do not keep a price-history buffer that is flushed after `products.update`.** That ordering is the F084 bug. Write the history row first; treat a `23505` duplicate as success, any other failure as "do not advance the product row".
- **Do not treat the duplicate-key error as a failure.** It means today's row already exists (an earlier attempt died after the insert). Treating it as failure would block the product's price update until tomorrow.
- **Do not rely on `finally` alone.** Without `install_sigterm_handler()` a SIGTERM skips `finally`, so the flush never runs on a cron or systemd stop.
- **Do not flush in `finally` without clearing the lists after the in-loop flushes,** and do not keep the old post-loop flush as well: rows would be upserted twice and the written counters double-counted.
- **Do not change `price_update_interval_hours = 23` or reformat that line.** `TestNoScrapeTimeDrift` reads it from source, and the value is load-bearing (see the comment above it).
- **Do not pass `env={}` or build an allowlist of variables to Chrome.** Selenium's `Service` treats a falsy `env` as `os.environ`, and an allowlist drops `HOME`, `DISPLAY`, `XDG_*`, `TMPDIR` and locale variables Chrome needs. Use the denylist; `scrubbed_browser_env` never returns an empty dict.
- **Do not remove `--no-sandbox` unconditionally.** Chrome refuses to start as root without it. Keep the root check and the `POKEFIN_CHROME_NO_SANDBOX=1` escape hatch.
- **Do not treat the environment scrub as enough on its own.** An unsandboxed renderer runs as the same user and can open `~/.config/pokefin/env` directly. The conditional sandbox in step 3b is the required part of F082; never add `--no-sandbox` back for non-root users "to be safe".
- **Do not raise `PAGE_LOAD_TIMEOUT_SECONDS` to 120 or more.** Selenium's HTTP client to chromedriver times out at 120 s; the page-load timeout must fire first so `driver.get` raises `TimeoutException` and the next product's commands are not stalled behind a still-navigating chromedriver.
- **Do not add an absolute price floor (for example "reject below $0.50").** A legitimately cheap product would never update again and, after 14 days, migration 0023's freshness guard would blank it. A glitch to a near-zero value on a product with a stored price is already caught by the 3x hold; a brand-new product has no stored price to protect.
- **Do not change copy in `generate_weekly_report.py` beyond step 10A,** and do not spell the source "TCGPlayer" anywhere: the company writes "TCGplayer", and WP15's conventions test bans the other casing in the site.
- **Do not wrap the Python call as `flock -n lockfile python main.py | ...`.** `PIPESTATUS[0]` would then be flock's status, and Chrome would inherit the lock descriptor, so an orphaned Chrome could hold the lock forever and silently skip every later run. Lock fd 9 in the shell and close it for Python with `9>&-`.
- **Do not use a pidfile or `flock` without `-n`.** A pidfile goes stale after `kill -9`; a blocking `flock` queues runs behind a slow one instead of skipping.
- **Do not let the page-load `TimeoutException` fall through to the outer `except`.** That path returns `price: None` and throws away the API price. Catch `TimeoutException` before `WebDriverException` (it is a subclass).
- **Do not move `fetch_validated_image` into a new module.** Existing tests patch `main._ip_is_safe` and `main.requests.get`, and the backfill already imports from `main`.
- **Do not let the backfill follow redirects or trust `raise_for_status()`.** `requests.Session.get` follows redirects by default, and `raise_for_status()` does not raise on 3xx. `fetch_validated_image` passes `allow_redirects=False` and refuses any status other than 200.
- **Do not allow `*.supabase.co` in the backfill.** Only the project's own host from `SUPABASE_URL`.
- **Do not keep writing the raw TCGPlayer `src` to `products.image_url` for every upload failure.** Only an `https` URL on an allowlisted host may be stored as the fallback.
- **Do not use `subprocess.run(..., timeout=180)` for the PDF render.** It kills only the direct child; use `Popen(start_new_session=True)` and `os.killpg`.
- **Do not replace the `build_thumbnail` pixel check with a global `PILImage.MAX_IMAGE_PIXELS = ...`.** It changes Pillow for the whole process and is not what `TestThumbnailPixelCap` checks.
- **Do not just delete `--shopify-token`.** argparse would then print "unrecognized arguments: --shopify-token shpat_..." to stderr and into `reports/`-style logs. Keep it hidden and fail with `parser.error` without echoing the value.
- **Do not remove the `secretsFile.py` fallback from `secrets_loader.py`.** Out of scope; it is the local-development path for every credential.
- **Do not edit `schema.sql`, `verify_migration.py`, existing migrations, or anything under `frontend/`.**
- **Do not apply the migration or run `main.py`, `run_scraper.sh`, `backfill_thumbnails.py`, `compare_prices.py` or `generate_weekly_report.py` against production.** You have no production access; the owner does this.
- **Do not change WP11's `run_jobs_once`, `revalidate_hook.py` or the revalidation calls.** If WP11 added a denylist entry for `REVALIDATE_SECRET`, the `REVALIDATE_` prefix above already covers it.

## Tests

### Update `tests/test_new_functions.py`

- Delete the class `TestFlushPriceHistoryBatch` (`:378-452`, four tests). The function it tests is deleted in step 6e; its replacement `_insert_price_history_row` is covered by `TestInsertPriceHistoryRow` below. This is a replacement, not a weakening.
- In the module docstring, delete the line `- _flush_price_history_batch(batch)`.
- Leave every other test in the file untouched.

### Add `tests/test_pipeline_hardening.py`

65 tests. Coverage by class:

- `TestEvaluateScrapedPrice`: ordinary moves accepted; no stored price accepted; `0`, negative, NaN, infinity, `500000` and `1499999` rejected; 3x-or-more moves held without pending; matching pending (within 10%, under 48 h old) confirms; non-matching or stale pending holds again; a wrong stored price is corrected after two runs; `PRICE_ABSOLUTE_MAX_USD < PRICE_DB_MAX_USD == 1000000` and the migration file contains `usd_price < 1000000` and `product_price_pending`.
- `TestPendingPriceStore`: `load_pending_prices` parses rows, skips incomplete ones, returns `None` when the table is missing.
- `TestInsertPriceHistoryRow`: success; `23505` duplicate returns True; other errors return False.
- `TestUpdatePricesOrdering`: history insert happens before `products.update`; a failed history insert leaves `usd_price` and `last_updated` out of the update; a 10x move is held (pending upsert, no history, no price write); a matching pending is confirmed and cleared; a 750,000 price is rejected; a missing pending table fails open; the function returns the updated count.
- `TestFlushOnEveryExitPath`: buffered sales rows are flushed exactly once when the run dies with `RuntimeError`, `SystemExit` or `KeyboardInterrupt`, and exactly once on a normal run; `install_sigterm_handler` turns a real SIGTERM into `SystemExit(143)`.
- `TestImageFallback`: a non-allowlisted image URL is never stored; an allowlisted TCGPlayer CDN URL is kept as the fallback.
- `TestCreateDriver`: non-root keeps the sandbox; root and `POKEFIN_CHROME_NO_SANDBOX=1` disable it; the Service `env` keeps `PATH`/`HOME` and drops `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`, `REVALIDATE_SECRET`, `SHOPIFY_ADMIN_API_TOKEN`; `set_page_load_timeout(30)` is called; the scrubbed env is never empty.
- `TestPageLoadTimeout`: a `TimeoutException` from `driver.get` keeps the API price and skips image extraction.
- `TestFetchValidatedImage`: metadata IP and foreign hosts refused without a request; private resolution refused; the extra host plus a session works with `allow_redirects=False` and `stream=True`; 302, `text/html`, oversize `Content-Length`, oversize stream, wrong magic bytes and too-small bodies are refused.
- `TestThumbnailPixelCap`: a source above `THUMBNAIL_MAX_SOURCE_PIXELS` is refused; the same image under the cap still produces a thumbnail.
- `TestBackfillUsesValidatedFetch`: `backfill_thumbnails.main()` routes every fetch through `fetch_validated_image` with `extra_allowed_hosts` set to the host of `SUPABASE_URL` only (`("test.supabase.co",)` under the mocked `secretsFile`) and uploads nothing when it refuses.
- `TestRenderPdf`: success with a temp `--user-data-dir` that is removed afterwards and `start_new_session=True`; timeout kills the process group and returns False; non-zero exit and a missing binary return False; a stale PDF from an earlier run is deleted and not reported.
- `TestWeeklyReportCopy` (Track 2): the rendered edition names "TCGplayer Market Price in USD", carries the site disclaimer and the TCGplayer trademark line, and contains no "TCGPlayer", "internal analytical report", "invest accordingly", `&mdash;` or `\u2014`.
- `TestComparePricesToken`: the token comes from `SHOPIFY_ADMIN_API_TOKEN`; `--shopify-token` exits 2 before any network call, names the env var, and never prints the token.
- `TestDeadCodeRemoved`: no `check_shopify_prices`, no `import uuid`, no `price_monitor` in `main.py`.

Full file content. The first 61 tests were validated against the implementation above (61 passed; against the unmodified code, 59 of them failed). The four added in the full re-review (`TestThumbnailPixelCap`, `TestWeeklyReportCopy`) fail against the unmodified code by construction (missing constant; old copy), so expect 65 passed after the change and 63 failures before it. The `TestWeeklyReportCopy` assertions were checked against `build_html` with the step 10A replacements applied.

```python
#!/usr/bin/env python3
"""
Tests for the scraper and report pipeline hardening (audit 2026-09-25, WP16):
F083 price plausibility, F084 history-first writes and flush-on-exit,
F086 page-load timeout, F082 browser env and sandbox, F136 shared image
fetch and thumbnail pixel cap, F137 PDF render timeout, F138 no token on
argv, F141 dead code, and the weekly PDF's reader-facing copy (Track 2).

Run with: python -m pytest tests/test_pipeline_hardening.py -v
"""
import glob
import os
import signal
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

# Mock external dependencies before importing main
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 2000


# --------------------------------------------------------------------------- #
# F083: evaluate_scraped_price
# --------------------------------------------------------------------------- #
class TestEvaluateScrapedPrice:
    def test_ordinary_move_is_accepted(self):
        from main import evaluate_scraped_price
        assert evaluate_scraped_price(120.0, 100.0, None, NOW) == "accept"
        assert evaluate_scraped_price(40.0, 100.0, None, NOW) == "accept"

    def test_no_stored_price_is_accepted(self):
        from main import evaluate_scraped_price
        assert evaluate_scraped_price(5000.0, None, None, NOW) == "accept"

    @pytest.mark.parametrize("bad", [0.0, -1.0, float("nan"), float("inf"), 500_000.0, 1_499_999.0])
    def test_impossible_values_are_rejected(self, bad):
        from main import evaluate_scraped_price
        assert evaluate_scraped_price(bad, 100.0, None, NOW) == "reject"
        assert evaluate_scraped_price(bad, None, None, NOW) == "reject"

    @pytest.mark.parametrize("new", [300.0, 1000.0, 33.0, 0.01])
    def test_large_move_without_pending_is_held(self, new):
        from main import evaluate_scraped_price
        assert evaluate_scraped_price(new, 100.0, None, NOW) == "hold"

    def test_large_move_matching_previous_run_is_confirmed(self):
        from main import evaluate_scraped_price
        pending = {"usd_price": 1000.0, "observed_at": NOW - timedelta(hours=4)}
        assert evaluate_scraped_price(1050.0, 100.0, pending, NOW) == "confirm"

    def test_large_move_not_matching_pending_is_held_again(self):
        from main import evaluate_scraped_price
        pending = {"usd_price": 1000.0, "observed_at": NOW - timedelta(hours=4)}
        assert evaluate_scraped_price(2000.0, 100.0, pending, NOW) == "hold"

    def test_stale_pending_does_not_confirm(self):
        from main import evaluate_scraped_price
        pending = {"usd_price": 1000.0, "observed_at": NOW - timedelta(hours=49)}
        assert evaluate_scraped_price(1000.0, 100.0, pending, NOW) == "hold"

    def test_a_wrong_stored_price_can_always_be_corrected(self):
        """Verifier correction: a hard +/-5x reject would lock a wrong price in forever."""
        from main import evaluate_scraped_price
        first = evaluate_scraped_price(100.0, 10.0, None, NOW)
        assert first == "hold"
        pending = {"usd_price": 100.0, "observed_at": NOW}
        assert evaluate_scraped_price(101.0, 10.0, pending, NOW + timedelta(hours=4)) == "confirm"

    def test_caps_match_migration(self):
        import main
        assert main.PRICE_ABSOLUTE_MAX_USD < main.PRICE_DB_MAX_USD == 1_000_000
        files = glob.glob(os.path.join(REPO_ROOT, "migrations", "*_price_plausibility_guard.sql"))
        assert len(files) == 1, files
        sql = open(files[0]).read()
        assert "usd_price < 1000000" in sql
        assert "product_price_pending" in sql


class TestPendingPriceStore:
    @patch('main.supabase')
    def test_load_pending_prices_parses_rows(self, mock_supabase):
        mock_supabase.table.return_value.select.return_value.execute.return_value = MagicMock(data=[
            {"product_id": 7, "usd_price": 99.5, "observed_at": "2026-09-28T08:00:00+00:00"},
            {"product_id": 8, "usd_price": None, "observed_at": "2026-09-28T08:00:00+00:00"},
        ])
        from main import load_pending_prices
        pending = load_pending_prices()
        assert list(pending) == [7]
        assert pending[7]["usd_price"] == 99.5
        assert pending[7]["observed_at"].tzinfo is not None
        mock_supabase.table.assert_called_with("product_price_pending")

    @patch('main.supabase')
    def test_load_pending_prices_returns_none_when_table_missing(self, mock_supabase):
        mock_supabase.table.return_value.select.return_value.execute.side_effect = Exception(
            "relation \"public.product_price_pending\" does not exist 42P01")
        from main import load_pending_prices
        assert load_pending_prices() is None


# --------------------------------------------------------------------------- #
# F084: _insert_price_history_row
# --------------------------------------------------------------------------- #
class TestInsertPriceHistoryRow:
    @patch('main.supabase')
    def test_success(self, mock_supabase):
        from main import _insert_price_history_row
        assert _insert_price_history_row(1, 10.0) is True
        mock_supabase.table.assert_called_with("product_price_history")
        mock_supabase.table.return_value.insert.assert_called_once_with({"product_id": 1, "usd_price": 10.0})

    @patch('main.supabase')
    def test_duplicate_day_counts_as_written(self, mock_supabase):
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = Exception(
            "{'code': '23505', 'message': 'duplicate key value violates unique constraint "
            "\"product_price_history_product_day_uidx\"'}")
        from main import _insert_price_history_row
        assert _insert_price_history_row(1, 10.0) is True

    @patch('main.supabase')
    def test_other_failure_returns_false(self, mock_supabase):
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = Exception("timeout")
        from main import _insert_price_history_row
        assert _insert_price_history_row(1, 10.0) is False


# --------------------------------------------------------------------------- #
# update_prices: ordering, hold/confirm/reject, flush on every exit path
# --------------------------------------------------------------------------- #
def _product(pid, price=100.0, hours_ago=30):
    return {
        "id": pid, "url": f"https://www.tcgplayer.com/product/{pid}", "usd_price": price,
        "image_url": "https://test.supabase.co/x.jpg",
        "last_updated": (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat(),
        "last_image_update": datetime.now(timezone.utc).isoformat(),
        "variant": None, "set_id": 1, "product_type_id": 1,
    }


def _scraped(price, sales=None, image=None):
    return {"price": price, "image_url": image, "sales_buckets": sales or [], "tcgplayer_product_id": None}


class _Recorder:
    """A fake supabase client that records (table, operation, payload) in order."""

    def __init__(self, fail_history=None):
        self.calls = []
        self.fail_history = fail_history

    def table(self, name):
        rec = self
        chain = MagicMock()

        def op(kind):
            def _call(payload=None, *args, **kwargs):
                rec.calls.append((name, kind, payload))
                inner = MagicMock()
                if name == "product_price_history" and kind == "insert" and rec.fail_history:
                    inner.execute.side_effect = rec.fail_history
                    inner.eq.return_value.execute.side_effect = rec.fail_history
                return inner
            return _call

        chain.insert.side_effect = op("insert")
        chain.update.side_effect = op("update")
        chain.upsert.side_effect = op("upsert")
        chain.delete.side_effect = op("delete")
        return chain


def _run_update_prices(products, scraped, pending=None, recorder=None):
    import main
    recorder = recorder or _Recorder()
    side = scraped if isinstance(scraped, list) else [scraped]
    with patch.object(main, "supabase", recorder), \
         patch.object(main, "fetch_products_needing_update", return_value=products), \
         patch.object(main, "create_driver", return_value=(MagicMock(), None)), \
         patch.object(main, "cleanup_driver") as cleanup, \
         patch.object(main, "get_price_and_image_from_url", side_effect=side), \
         patch.object(main, "load_pending_prices", return_value=pending if pending is not None else {}), \
         patch.object(main.time, "sleep"):
        result = main.update_prices()
    return result, recorder, cleanup


class TestUpdatePricesOrdering:
    def test_history_row_is_written_before_products_update(self):
        _, rec, _ = _run_update_prices([_product(1)], _scraped(110.0))
        names = [(t, k) for t, k, _ in rec.calls]
        assert names.index(("product_price_history", "insert")) < names.index(("products", "update"))
        update_payload = [p for t, k, p in rec.calls if (t, k) == ("products", "update")][0]
        assert update_payload["usd_price"] == 110.0
        assert "last_updated" in update_payload

    def test_failed_history_write_leaves_price_and_timestamp_alone(self):
        rec = _Recorder(fail_history=Exception("network down"))
        _, rec, _ = _run_update_prices([_product(1)], _scraped(110.0), recorder=rec)
        for t, k, p in rec.calls:
            if (t, k) == ("products", "update"):
                assert "usd_price" not in p and "last_updated" not in p

    def test_large_move_is_held_not_written(self):
        _, rec, _ = _run_update_prices([_product(1, price=100.0)], _scraped(1000.0))
        tables = [(t, k) for t, k, _ in rec.calls]
        assert ("product_price_history", "insert") not in tables
        assert ("product_price_pending", "upsert") in tables
        for t, k, p in rec.calls:
            if (t, k) == ("products", "update"):
                assert "usd_price" not in p

    def test_confirmed_move_is_written_and_pending_cleared(self):
        pending = {1: {"usd_price": 1000.0, "observed_at": datetime.now(timezone.utc) - timedelta(hours=4)}}
        _, rec, _ = _run_update_prices([_product(1, price=100.0)], _scraped(1010.0), pending=pending)
        tables = [(t, k) for t, k, _ in rec.calls]
        assert ("product_price_history", "insert") in tables
        assert ("product_price_pending", "delete") in tables

    def test_implausible_price_is_rejected(self):
        _, rec, _ = _run_update_prices([_product(1)], _scraped(750_000.0))
        tables = [(t, k) for t, k, _ in rec.calls]
        assert ("product_price_history", "insert") not in tables
        assert ("product_price_pending", "upsert") not in tables

    def test_missing_pending_table_fails_open(self):
        import main
        rec = _Recorder()
        with patch.object(main, "supabase", rec), \
             patch.object(main, "fetch_products_needing_update", return_value=[_product(1, price=100.0)]), \
             patch.object(main, "create_driver", return_value=(MagicMock(), None)), \
             patch.object(main, "cleanup_driver"), \
             patch.object(main, "get_price_and_image_from_url", return_value=_scraped(1000.0)), \
             patch.object(main, "load_pending_prices", return_value=None), \
             patch.object(main.time, "sleep"):
            main.update_prices()
        assert ("product_price_history", "insert") in [(t, k) for t, k, _ in rec.calls]

    def test_returns_updated_count(self):
        result, _, _ = _run_update_prices([_product(1), _product(2)], [_scraped(110.0), _scraped(111.0)])
        assert result == 2


class TestFlushOnEveryExitPath:
    SALES = [{"product_id": 1, "bucket_date": "2026-09-27", "granularity": "day", "quantity_sold": 2}]

    @pytest.mark.parametrize("exc", [RuntimeError("chrome died"), SystemExit(143), KeyboardInterrupt()])
    def test_buffered_sales_rows_are_flushed_when_the_run_dies(self, exc):
        import main
        with patch.object(main, "_flush_sales_history_batch", return_value=(1, 0)) as flush, \
             pytest.raises(type(exc)):
            _run_update_prices(
                [_product(1), _product(2)],
                [_scraped(110.0, sales=self.SALES), exc],
            )
        flush.assert_called_once()
        assert flush.call_args[0][0] == self.SALES

    def test_flush_happens_once_on_a_normal_run(self):
        import main
        with patch.object(main, "_flush_sales_history_batch", return_value=(1, 0)) as flush:
            _run_update_prices([_product(1)], _scraped(110.0, sales=self.SALES))
        flush.assert_called_once()

    def test_sigterm_becomes_system_exit(self):
        import main
        previous = signal.getsignal(signal.SIGTERM)
        try:
            main.install_sigterm_handler()
            with pytest.raises(SystemExit) as info:
                os.kill(os.getpid(), signal.SIGTERM)
            assert info.value.code == 128 + signal.SIGTERM
        finally:
            signal.signal(signal.SIGTERM, previous)


class TestImageFallback:
    def _run(self, tcg_url):
        import main
        product = _product(1)
        product["last_image_update"] = None
        with patch.object(main, "download_and_upload_image", return_value=None):
            _, rec, _ = _run_update_prices([product], _scraped(110.0, image=tcg_url))
        return [p for t, k, p in rec.calls if (t, k) == ("products", "update")][0]

    def test_disallowed_host_is_never_stored(self):
        payload = self._run("https://ads.example.com/product-banner.png")
        assert "image_url" not in payload
        assert "last_image_update" in payload

    def test_allowlisted_host_is_kept_as_fallback(self):
        payload = self._run("https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg")
        assert payload["image_url"].startswith("https://tcgplayer-cdn.tcgplayer.com/")


# --------------------------------------------------------------------------- #
# F086 + F082: create_driver and page-load timeout
# --------------------------------------------------------------------------- #
class TestCreateDriver:
    def _create(self, euid, extra_env=None):
        import main
        env = {"PATH": "/usr/bin", "HOME": "/home/scraper",
               "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_x", "SMTP_PASS": "p",
               "REVALIDATE_SECRET": "r", "SHOPIFY_ADMIN_API_TOKEN": "shpat"}
        env.update(extra_env or {})
        with patch.dict(os.environ, env, clear=True), \
             patch.object(main.platform, "system", return_value="Linux"), \
             patch.object(main.os, "geteuid", return_value=euid, create=True), \
             patch.object(main, "ChromeDriverManager") as cdm, \
             patch.object(main, "Service") as service, \
             patch.object(main.webdriver, "Chrome") as chrome:
            cdm.return_value.install.return_value = "/tmp/chromedriver"
            driver, _ = main.create_driver()
        options = chrome.call_args.kwargs["options"]
        return driver, options, service

    def test_non_root_keeps_the_sandbox(self):
        _, options, _ = self._create(euid=1000)
        assert "--no-sandbox" not in options.arguments

    def test_root_disables_the_sandbox(self):
        _, options, _ = self._create(euid=0)
        assert "--no-sandbox" in options.arguments

    def test_override_disables_the_sandbox(self):
        _, options, _ = self._create(euid=1000, extra_env={"POKEFIN_CHROME_NO_SANDBOX": "1"})
        assert "--no-sandbox" in options.arguments

    def test_driver_env_has_no_secrets(self):
        _, _, service = self._create(euid=1000)
        env = service.call_args.kwargs["env"]
        assert env["PATH"] == "/usr/bin" and env["HOME"] == "/home/scraper"
        for secret in ("SUPABASE_SERVICE_ROLE_KEY", "SMTP_PASS", "REVALIDATE_SECRET", "SHOPIFY_ADMIN_API_TOKEN"):
            assert secret not in env

    def test_page_load_timeout_is_set(self):
        import main
        driver, _, _ = self._create(euid=1000)
        driver.set_page_load_timeout.assert_called_once_with(main.PAGE_LOAD_TIMEOUT_SECONDS)
        assert main.PAGE_LOAD_TIMEOUT_SECONDS == 30

    def test_scrubbed_env_is_never_empty(self):
        import main
        assert main.scrubbed_browser_env({"SUPABASE_URL": "x"}) == {"PATH": os.defpath}


class TestPageLoadTimeout:
    def test_timeout_keeps_the_api_price(self):
        import main
        from selenium.common.exceptions import TimeoutException
        driver = MagicMock()
        driver.get.side_effect = TimeoutException("slow")
        with patch.object(main, "fetch_latest_market_data_from_api",
                          return_value={"price": 42.0, "daily_buckets": []}):
            result = main.get_price_and_image_from_url(
                driver, "https://www.tcgplayer.com/product/123", session=MagicMock(), db_product_id=1)
        assert result["price"] == 42.0
        assert result["image_url"] is None
        assert result["tcgplayer_product_id"] == "123"
        driver.find_elements.assert_not_called()


# --------------------------------------------------------------------------- #
# F136: fetch_validated_image
# --------------------------------------------------------------------------- #
def _http_response(status=200, headers=None, chunks=(PNG,)):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = headers if headers is not None else {"Content-Type": "image/png"}
    resp.iter_content.return_value = list(chunks)
    ctx = MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


class TestFetchValidatedImage:
    def test_disallowed_host_is_refused_without_a_request(self):
        import main
        with patch.object(main.requests, "get") as get:
            assert main.fetch_validated_image("https://169.254.169.254/latest/meta-data") is None
            assert main.fetch_validated_image("https://evil.example.com/a.png") is None
        get.assert_not_called()

    def test_private_address_is_refused(self):
        import main
        with patch.object(main, "_ip_is_safe", return_value=False), \
             patch.object(main.requests, "get") as get:
            assert main.fetch_validated_image("https://product-images.tcgplayer.com/a.png") is None
        get.assert_not_called()

    def test_extra_host_is_allowed_and_session_is_used(self):
        import main
        session = MagicMock()
        session.get.return_value = _http_response()
        with patch.object(main, "_ip_is_safe", return_value=True):
            got = main.fetch_validated_image(
                "https://test.supabase.co/storage/v1/object/public/product-images/products/1.png",
                extra_allowed_hosts=("test.supabase.co",), session=session)
        assert got == (PNG, "png")
        assert session.get.call_args.kwargs["allow_redirects"] is False
        assert session.get.call_args.kwargs["stream"] is True

    @pytest.mark.parametrize("response", [
        _http_response(status=302, headers={"Location": "http://127.0.0.1/"}),
        _http_response(headers={"Content-Type": "text/html"}),
        _http_response(headers={"Content-Type": "image/png", "Content-Length": str(9 * 1024 * 1024)}),
        _http_response(chunks=[b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024)] * 2),
        _http_response(chunks=[b"<svg>" + b"\x00" * 2000]),
        _http_response(chunks=[b"\x89PNG\r\n\x1a\n" + b"\x00" * 10]),
    ])
    def test_bad_responses_are_refused(self, response):
        import main
        with patch.object(main, "_ip_is_safe", return_value=True), \
             patch.object(main.requests, "get", return_value=response):
            assert main.fetch_validated_image("https://product-images.tcgplayer.com/a.png") is None


class TestThumbnailPixelCap:
    def test_oversized_source_is_refused_before_decoding(self):
        import io
        import main
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (40, 40), (255, 0, 0)).save(buf, format="PNG")
        assert main.build_thumbnail(buf.getvalue()) is not None
        with patch.object(main, "THUMBNAIL_MAX_SOURCE_PIXELS", 1000):  # 40 x 40 = 1600
            assert main.build_thumbnail(buf.getvalue()) is None


class TestBackfillUsesValidatedFetch:
    def test_backfill_routes_every_fetch_through_the_guard(self):
        import main
        import backfill_thumbnails
        from urllib.parse import urlparse
        # "test.supabase.co" from the mocked secretsFile, unless the shell
        # running the tests exports SUPABASE_URL (secrets_loader prefers it).
        expected_host = urlparse(backfill_thumbnails.SUPABASE_URL).hostname
        products = [{"id": 1, "image_url": "http://169.254.169.254/latest/meta-data"}]
        with patch.object(backfill_thumbnails, "fetch_products_with_images", return_value=products), \
             patch.object(main, "fetch_validated_image", return_value=None) as guarded, \
             patch.object(main, "upload_thumbnail") as upload, \
             patch.object(sys, "argv", ["backfill_thumbnails.py", "--force"]):
            assert backfill_thumbnails.main() == 0
        guarded.assert_called_once()
        assert guarded.call_args.kwargs["extra_allowed_hosts"] == (expected_host,)
        upload.assert_not_called()


# --------------------------------------------------------------------------- #
# F137: render_pdf timeout
# --------------------------------------------------------------------------- #
class TestRenderPdf:
    def _render(self, tmp_path, wait_side_effect=None, returncode=0, create_pdf=True, popen_error=None):
        import generate_weekly_report as gwr
        pdf = tmp_path / "out.pdf"
        html = tmp_path / "in.html"
        html.write_text("<html></html>")
        seen = {}

        def fake_popen(cmd, **kwargs):
            if popen_error:
                raise popen_error
            seen["cmd"] = cmd
            seen["kwargs"] = kwargs
            proc = MagicMock()
            proc.pid = 4242
            if wait_side_effect is not None:
                proc.wait.side_effect = wait_side_effect
            else:
                if create_pdf:
                    pdf.write_bytes(b"%PDF-1.7")
                proc.wait.return_value = returncode
            return proc

        with patch.object(gwr, "find_chrome", return_value="/usr/bin/google-chrome"), \
             patch.object(gwr.subprocess, "Popen", side_effect=fake_popen), \
             patch.object(gwr.os, "killpg", create=True) as killpg:
            ok = gwr.render_pdf(str(html), str(pdf))
        return ok, seen, killpg, pdf

    def test_success(self, tmp_path):
        import generate_weekly_report as gwr
        ok, seen, _, _ = self._render(tmp_path)
        assert ok is True
        profile = [a for a in seen["cmd"] if a.startswith("--user-data-dir=")]
        assert len(profile) == 1
        assert not os.path.exists(profile[0].split("=", 1)[1])  # temp profile removed
        assert seen["kwargs"]["start_new_session"] is True
        assert gwr.PDF_RENDER_TIMEOUT_SECONDS == 180

    def test_timeout_kills_chrome_and_returns_false(self, tmp_path):
        ok, _, killpg, _ = self._render(
            tmp_path, wait_side_effect=[subprocess.TimeoutExpired("chrome", 180), 0])
        assert ok is False
        killpg.assert_called_once()

    def test_nonzero_exit_returns_false(self, tmp_path):
        ok, _, _, _ = self._render(tmp_path, returncode=1)
        assert ok is False

    def test_missing_binary_returns_false(self, tmp_path):
        ok, _, _, _ = self._render(tmp_path, popen_error=FileNotFoundError("chrome"))
        assert ok is False

    def test_stale_pdf_from_an_earlier_run_is_not_reported(self, tmp_path):
        (tmp_path / "out.pdf").write_bytes(b"%PDF old")
        ok, _, _, pdf = self._render(tmp_path, create_pdf=False)
        assert ok is False
        assert not pdf.exists()


# --------------------------------------------------------------------------- #
# Track 2: the weekly PDF's reader-facing copy
# --------------------------------------------------------------------------- #
class TestWeeklyReportCopy:
    DISCLAIMER = ("Market data for information only, not financial advice. "
                  "Past prices do not predict future prices.")

    def _html(self):
        import generate_weekly_report as gwr
        # Exercises every changed string: an empty category cell, an empty set
        # cell, a missing release date, no best set, and the excluded note.
        cats = [{"category": "Booster Box", "n": 5, "1m": 2.0, "3m": None, "6m": 10.0,
                 "1y": None, "n_1m": 5, "n_3m": 1, "n_6m": 4, "n_1y": 0}]
        sets_rows = [{"set_name": "Base Set", "release_date": None,
                      "avg_3m": None, "avg_6m": 5.0, "avg_1y": None}]
        meta = {"n_products": 5, "n_sets": 1, "n_obs": 100,
                "earliest": "Sep 1, 2025", "excluded": 2}
        return gwr.build_html(date(2026, 9, 25), [], cats, sets_rows,
                              {"1y": [], "6m": []}, meta)

    def test_caveat_names_the_source(self):
        doc = self._html()
        assert "Figures are TCGplayer Market Price in USD" in doc
        assert "TCGPlayer" not in doc
        assert "likely" not in doc

    def test_footer_uses_the_site_disclaimer(self):
        doc = self._html()
        assert self.DISCLAIMER in doc
        assert "TCGplayer is a trademark of TCGplayer, Inc." in doc
        assert "internal analytical report" not in doc
        assert "invest accordingly" not in doc

    def test_no_em_dashes_in_the_edition(self):
        doc = self._html()
        assert "&mdash;" not in doc
        assert "\u2014" not in doc
        assert "<td>--</td>" in doc


# --------------------------------------------------------------------------- #
# F138: compare_prices never takes the token from argv
# --------------------------------------------------------------------------- #
class TestComparePricesToken:
    def test_token_comes_from_the_environment(self):
        import compare_prices
        # Both variables set explicitly: an exported SHOPIFY_STORE_DOMAIN in
        # the test shell would otherwise win over the module attribute.
        with patch.dict(os.environ, {"SHOPIFY_ADMIN_API_TOKEN": "shpat_env",
                                     "SHOPIFY_STORE_DOMAIN": "store.myshopify.com"}), \
             patch.object(compare_prices, "SHOPIFY_STORE_DOMAIN", "other.myshopify.com"):
            domain, token, _ = compare_prices._get_shopify_credentials(None, None)
        assert token == "shpat_env"
        assert domain == "store.myshopify.com"

    def test_shopify_token_flag_is_refused_without_echoing_it(self, capsys):
        import compare_prices
        with patch.object(sys, "argv", ["compare_prices.py", "--shopify-source", "api",
                                        "--shopify-token", "shpat_do_not_print"]), \
             patch.object(compare_prices, "fetch_exchange_rate") as rate, \
             pytest.raises(SystemExit) as info:
            compare_prices.main()
        assert info.value.code == 2
        rate.assert_not_called()
        err = capsys.readouterr().err
        assert "SHOPIFY_ADMIN_API_TOKEN" in err
        assert "shpat_do_not_print" not in err


# --------------------------------------------------------------------------- #
# F141: dead code removed
# --------------------------------------------------------------------------- #
class TestDeadCodeRemoved:
    def test_check_shopify_prices_and_uuid_are_gone(self):
        import main
        assert not hasattr(main, "check_shopify_prices")
        source = open(os.path.join(REPO_ROOT, "main.py")).read()
        assert "import uuid" not in source
        assert "price_monitor" not in source
```

### Existing tests that must pass unchanged

`tests/test_main.py` (including `TestNoScrapeTimeDrift`), `tests/test_sales_volume.py`, `tests/test_backfill_enhanced.py`, the rest of `tests/test_new_functions.py`, and any Python tests added by WP01 (`tests/test_migration_volatility.py`) and WP11 (`tests/test_revalidate_hook.py`, `TestRunJobsOnce` in `tests/test_main.py`).

## Verification

Run from the repo root (`/home/user/Pokefin`) with the venv from "Before you start".

```bash
# 1. Whole Python suite. Expect: all pass, count = N - 4 + 65 (N from the baseline run).
/tmp/wp16-venv/bin/python -m pytest tests/ -q -p no:cacheprovider

# 2. The new file alone. Expect: "65 passed".
/tmp/wp16-venv/bin/python -m pytest tests/test_pipeline_hardening.py -v -p no:cacheprovider

# 3. No new pyflakes findings. Expect only these pre-existing lines (line numbers may differ):
#    main.py: local variable 'result' is assigned to but never used   (fetch_and_store_exchange_rate; absent if WP11 removed it)
#    backfill_thumbnails.py: 'PIL' imported but unused
#    generate_weekly_report.py: 'glob' imported but unused
#    compare_prices.py: 'datetime.datetime' imported but unused
/tmp/wp16-venv/bin/python -m pyflakes main.py backfill_thumbnails.py generate_weekly_report.py compare_prices.py tests/test_pipeline_hardening.py

# 4. Shell syntax. Expect no output, exit 0.
bash -n run_scraper.sh

# 5. Migration parser. verify_migration.py writes the SQL to paste to STDOUT and its
#    "-- privilege ..." / "-- rls ..." / "NOT VERIFIED ..." summary to STDERR, so capture
#    them separately. Expect exit=3, 26 summary lines, and the line
#    "-- NOT VERIFIED (out of scope, check by hand): 1 x CREATE (table/type/etc), 2 x DO block".
python3 verify_migration.py migrations/0030_price_plausibility_guard.sql \
  > /tmp/wp16_0030_check.sql 2> /tmp/wp16_0030_check.txt; echo "exit=$?"
grep -c "^-- privilege\|^-- rls" /tmp/wp16_0030_check.txt     # expect 26
grep -n "NOT VERIFIED" /tmp/wp16_0030_check.txt               # expect the line above
head -1 /tmp/wp16_0030_check.sql                              # expect: WITH pv_expected(src, objkind, obj, role, priv, want, fname, types) AS (

# 6. Static proofs. Each comment states the expected output.
grep -n "import uuid\|price_monitor\|check_shopify_prices\|_flush_price_history_batch\|price_history_batch" main.py   # no output
grep -n '"--no-sandbox"' main.py                  # exactly 1 hit, inside "if chrome_needs_no_sandbox():"
grep -n "set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)" main.py   # 1 hit
grep -n "fetch_validated_image" backfill_thumbnails.py               # 2 hits (import, call)
grep -n "session.get(image_url" backfill_thumbnails.py               # no output
grep -n "timeout=PDF_RENDER_TIMEOUT_SECONDS" generate_weekly_report.py   # 1 hit
grep -c "&mdash;" generate_weekly_report.py                          # 0
grep -n "likely TCGPlayer\|internal analytical report\|invest accordingly\|TCGPlayer" generate_weekly_report.py   # no output
grep -n "Market data for information only, not financial advice. Past prices do not predict future prices." generate_weekly_report.py   # 1 hit
grep -n "width \* height > THUMBNAIL_MAX_SOURCE_PIXELS" main.py       # 1 hit
grep -n "token_arg\|args.shopify_token," compare_prices.py           # no output
grep -n "flock -n 9\|9>&-" run_scraper.sh                            # 3 hits (flock line, comment, python line)
grep -n "price_update_interval_hours = 23" main.py                   # 1 hit
grep -rn $'\xe2\x80\x94' migrations/0030_price_plausibility_guard.sql tests/test_pipeline_hardening.py   # no output

# 7. Scope. Run after committing. Compare with the point this branch left master
#    (a local "master" can be stale, so use origin/master).
git fetch origin master
BASE="$(git merge-base HEAD origin/master)"
git diff --stat "$BASE" HEAD -- frontend schema.sql verify_migration.py secrets_loader.py run_weekly_report.sh   # expect no output
git diff --name-status "$BASE" HEAD -- migrations   # expect exactly one line: A	migrations/0030_price_plausibility_guard.sql
git diff --name-status "$BASE" HEAD   # expect exactly these 11 paths (A = added, M = modified), nothing else:
#   M .gitignore, M README.md, M audits/HARDENING_FOLLOWUPS.md, M backfill_thumbnails.py,
#   M compare_prices.py, M generate_weekly_report.py, M main.py,
#   A migrations/0030_price_plausibility_guard.sql, M run_scraper.sh,
#   M tests/test_new_functions.py, A tests/test_pipeline_hardening.py
```

Frontend commands (`tsc`, lint, jest, `pnpm build:stub` from WP00) are not affected: this package changes no file under `frontend/`. Step 7 above proves that; running them is optional.

Manual check A, run lock (local, no secrets needed). Copy the script into a throwaway directory with a fake venv and a slow fake `main.py`, then start two runs one second apart:

```bash
T=$(mktemp -d) && mkdir -p "$T/venv/bin" && cp run_scraper.sh "$T/"
printf 'deactivate() { :; }\n' > "$T/venv/bin/activate"
printf 'import os, time\nprint("fd9 open:", os.path.exists("/proc/self/fd/9"))\ntime.sleep(3)\nprint("done")\n' > "$T/main.py"
cd "$T" && (bash run_scraper.sh > a.out 2>&1 &) ; sleep 1; bash run_scraper.sh > b.out 2>&1; echo "second exit=$?"; sleep 4
grep -h "lock\|SCRAPER" a.out b.out; cd - >/dev/null; rm -rf "$T"
```

Correct: `second exit=0`; `a.out` shows "Acquired run lock", `SCRAPER: fd9 open: False` and `SCRAPER: done`; `b.out` shows "Another scraper run still holds ...; skipping this run". (Needs a `python` on PATH; use `ln -s "$(command -v python3)" "$T/venv/bin/python"` and `PATH="$T/venv/bin:$PATH"` if `python` is missing.)

Manual check B, migration replay (optional; needs a local Postgres 16, as in WP10's spec). Create stub roles `anon`, `authenticated`, `service_role` and minimal `products(id, usd_price)` / `product_price_history(id, product_id, usd_price, recorded_at)` tables, apply the file twice with `psql -v ON_ERROR_STOP=1 --single-transaction -f`, then run the SQL printed by `verify_migration.py`. Correct: both applies succeed (the second prints `relation "product_price_pending" already exists, skipping`), 26 rows `OK`, and `UPDATE products SET usd_price = 1500000` fails with `violates check constraint "products_usd_price_sane"`.

## Owner actions

1. **Pre-check the data (SQL editor, production, nothing selected).**

   ```sql
   SELECT 'products' AS tbl, id, usd_price FROM public.products
    WHERE usd_price IS NOT NULL AND (usd_price <= 0 OR usd_price >= 1000000)
   UNION ALL
   SELECT 'product_price_history', id, usd_price FROM public.product_price_history
    WHERE usd_price >= 1000000;
   SELECT max(usd_price) AS max_product_price FROM public.products;
   ```

   Expect zero rows from the first query. If any `products` row is listed, null it so the scraper refills it: `UPDATE public.products SET usd_price = NULL WHERE usd_price <= 0 OR usd_price >= 1000000;`. If any `product_price_history` row is listed, confirm it is bogus and delete it by id. If `max_product_price` is above 250000, do not deploy the scraper yet: open a one-line follow-up PR that raises `PRICE_ABSOLUTE_MAX_USD` in `main.py` to about twice that maximum (it must stay below 1000000, and `test_caps_match_migration` enforces that), merge it, then continue. Do not edit `main.py` on the scraper host, because the next `git pull` would conflict.

2. **Apply 0030, after the PR is merged to master** (so the file you apply is the one `verify_migration.py` checks; the merged code runs safely before or after the apply because it fails open when the table is missing). Preferred: Supabase MCP `apply_migration` with name `0030_price_plausibility_guard` and the full file contents. Alternative: SQL editor, paste the whole file, make sure no text is selected, Run. Do it while the scraper is not running (it briefly locks `products` and `product_price_history`; the history table is ~141k rows, so seconds). If it fails with `violates check constraint`, step 1 found rows you did not fix; the transaction rolled back, nothing changed.

3. **Verify 0030.** Run the two header queries: the `pg_constraint` query returns 2 rows with `convalidated = true`. Then run `python3 verify_migration.py migrations/0030_price_plausibility_guard.sql` locally, paste the printed SQL into the SQL editor, Run: expect 26 rows, all `OK`. Also `SELECT has_table_privilege('anon', 'public.product_price_pending', 'SELECT');` returns `false`. The Supabase Security Advisor will now list an INFO-level "RLS Enabled No Policy" entry for `public.product_price_pending`. That is intended (only `service_role`, which bypasses RLS, may use the table; WP21 adds a policy for its scraper role); do not add a policy for `anon` or `authenticated` to silence it.

4. **Deploy the scraper code on the scraper host** (after the PR merges and after step 3): `cd ~/pokefin && git pull`. `requirements.txt` is unchanged. Confirm `command -v flock` prints a path (package `util-linux`). Check which user cron runs it as: `crontab -l` for your user and `sudo crontab -l` for root; the line calls `run_scraper.sh`.

5. **Chrome sandbox smoke test, as the same user cron uses:**

   ```bash
   cd ~/pokefin && set -a && . ~/.config/pokefin/env && set +a
   ./venv/bin/python -c "import main; d,u=main.create_driver(); d.get('https://www.tcgplayer.com'); print('title:', d.title); main.cleanup_driver(d,u)"
   ```

   Correct: it prints a TCGPlayer title. As a non-root user there must be no "Chrome is running WITHOUT its sandbox" warning. If it fails with "No usable sandbox" (common on Ubuntu 23.10 and later, which restrict unprivileged user namespaces), either make sure `/opt/google/chrome/chrome-sandbox` is owned by root with mode 4755 (`sudo chown root:root /opt/google/chrome/chrome-sandbox && sudo chmod 4755 /opt/google/chrome/chrome-sandbox`) and retry, or add `POKEFIN_CHROME_NO_SANDBOX=1` to `~/.config/pokefin/env` (same exposure as before this PR, but the environment is still scrubbed). If cron runs as root, the code keeps `--no-sandbox` automatically and logs a warning every run. Move the cron job to an unprivileged user in that case: the sandbox is the control that contains a renderer exploit. Without it the renderer runs as the cron user and can read `~/.config/pokefin/env` (mode 600 is still owner-readable) and `secretsFile.py` directly, which the environment scrub cannot prevent. The same applies to `POKEFIN_CHROME_NO_SANDBOX=1`: use it only while you fix the host's sandbox.

6. **Watch the first cron run.** `tail -f ~/pokefin/scraper.log`. Correct: "Acquired run lock", per-product lines as before, a closing "Prices held for confirmation: N; rejected as implausible: M" line, and no "product_price_pending could not be read" ERROR. On the following run, any product held earlier shows "Confirmed large price move" or is held again.

7. **Weekly report.** No action needed; the next scheduled run uses the bounded render. Optional: run `./run_weekly_report.sh` once and confirm `reports/weekly_report.log` ends with `OK -> pokefin_weekly_<date>.pdf`.

8. **compare_prices.py users.** If any alias, script or note passes `--shopify-token`, change it to `SHOPIFY_ADMIN_API_TOKEN=... python compare_prices.py ...` (or put the variable in the env file) and clear the old command from shell history (`history -d <n>` or edit `~/.bash_history`, `~/.zsh_history`). If the token was ever passed with `--shopify-token`, rotate it: it sits in plaintext in shell history and in any backup or dotfile sync of it. `compare_prices.py` only issues `GET .../products.json`, so the replacement can be a custom-app token with `read_products` scope only.

9. **Periodic check for stuck holds** (weekly, or when a price looks stale):

   ```sql
   SELECT pp.product_id, pp.usd_price AS held, pp.observed_at, p.usd_price AS stored, p.last_updated
     FROM public.product_price_pending pp
     JOIN public.products p ON p.id = pp.product_id
    WHERE p.last_updated < now() - interval '30 hours';
   ```

   Rows here are products whose price keeps jumping without two runs agreeing. Inspect the product on TCGPlayer; if the held value is right, write it by hand (`UPDATE public.products SET usd_price = <value> WHERE id = <id>;`) and `DELETE FROM public.product_price_pending WHERE product_id = <id>;`.

10. **Record it.** In `audits/HARDENING_FOLLOWUPS.md` section 7, change "**Migration 0030: pending apply**" to "**Migration 0030 applied** (YYYY-MM-DD, via Supabase MCP)".

## Acceptance criteria

- [ ] `python -m pytest tests/ -q` passes in a fresh venv; `tests/test_pipeline_hardening.py` reports 65 passed.
- [ ] `tests/test_new_functions.py` no longer contains `TestFlushPriceHistoryBatch`; no other existing test was edited or skipped.
- [ ] `main.py` has no `uuid` import, no `check_shopify_prices`, no `price_monitor`, no `_flush_price_history_batch`, no `price_history_batch`.
- [ ] `main.py` writes `product_price_history` before `products.update` for every accepted price, and never advances `last_updated` for a held, rejected or history-failed price.
- [ ] A price that is non-finite, not positive or at least `PRICE_ABSOLUTE_MAX_USD` (500000) is never written; a move of 3x or more is written only after a second run observes it within 10%.
- [ ] Sales and listings buffers flush at 25 rows and in `update_prices`' `finally`; `install_sigterm_handler()` is called in `__main__`.
- [ ] `create_driver` passes `env=scrubbed_browser_env()` to `Service`, adds `--no-sandbox` only for root or `POKEFIN_CHROME_NO_SANDBOX=1`, and calls `set_page_load_timeout(30)`.
- [ ] A `TimeoutException` from `driver.get` returns the API price instead of `None`.
- [ ] `backfill_thumbnails.py` fetches only through `fetch_validated_image`, allowing just the project's Supabase host in addition to the TCGplayer allowlist.
- [ ] `build_thumbnail` returns None, without decoding, for a source whose header declares more than `THUMBNAIL_MAX_SOURCE_PIXELS` (20,000,000) pixels.
- [ ] `main.py` stores a TCGPlayer fallback image URL only when it is `https` on an allowlisted host.
- [ ] `render_pdf` uses a temp `--user-data-dir`, a 180 s timeout that kills the process group, deletes a stale PDF first, and returns False on timeout, non-zero exit or a missing binary.
- [ ] (Track 2) The rendered weekly edition says "Figures are TCGplayer Market Price in USD", ends its footer with the site disclaimer "Market data for information only, not financial advice. Past prices do not predict future prices." and the Pokémon and TCGplayer trademark lines, and contains no "TCGPlayer", "internal analytical report", "invest accordingly" or em dash; `grep -c "&mdash;" generate_weekly_report.py` prints 0.
- [ ] `compare_prices.py --shopify-token X` exits 2 with a message naming `SHOPIFY_ADMIN_API_TOKEN` and never prints `X`; the token is read only from the environment or `secretsFile.py`.
- [ ] `run_scraper.sh` skips with exit 0 when another run holds `.scraper.lock` (manual check A), and `.scraper.lock` is in `.gitignore`.
- [ ] `migrations/0030_price_plausibility_guard.sql` exists, is idempotent, and `verify_migration.py` on it exits 3 with 26 expectations.
- [ ] `README.md` and `audits/HARDENING_FOLLOWUPS.md` carry the step 15 edits, with 0030 marked "pending apply".
- [ ] Nothing under `frontend/`, `schema.sql`, `verify_migration.py`, `secrets_loader.py` or existing migrations changed.
- [ ] (Owner) The pre-check returned zero rows (or the listed rows were fixed), 0030 is applied, and its verification returns 26 `OK` rows plus 2 validated constraints.
- [ ] (Owner) The Chrome smoke test prints a title on the scraper host, and the first cron run logs "Acquired run lock" and the held/rejected summary line with no pending-table ERROR.

## Rollback

- **Code**: revert the PR commit and `git pull` on the scraper host. The old code works with 0030 applied: it never writes `product_price_pending`, and the new CHECKs only reject values of 1,000,000 or more (or products at 0 or below), which the old code logs as a failed insert or update.
- **Partial rollback of the sandbox change only**: set `POKEFIN_CHROME_NO_SANDBOX=1` in `~/.config/pokefin/env`; no code change needed.
- **Migration 0030**: normally keep it. If it must be undone, add a new numbered migration (never edit 0030) containing:

  ```sql
  ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_usd_price_sane;
  ALTER TABLE public.product_price_history DROP CONSTRAINT IF EXISTS product_price_history_usd_price_sane;
  DROP TABLE IF EXISTS public.product_price_pending;
  ```

  With the table gone, the new code logs "product_price_pending could not be read" each run and accepts large moves unconfirmed (the pre-WP16 behaviour); nothing else breaks. Mark the HARDENING_FOLLOWUPS bullet accordingly.

## Commit and PR

Commit message:

```
fix(scraper): price plausibility guard, history-first writes, run lock, Chrome hardening

- F083: drop non-finite, non-positive and >= $500k prices; hold 3x+ moves in
  product_price_pending and write them only when the next run agrees
  (migration 0030 adds the table plus usd_price CHECK bounds).
- F084: write each price-history row before its products row; flush
  sales/listings every 25 rows and in finally; SIGTERM now runs finally.
- F086: flock run lock in run_scraper.sh; 30 s Selenium page-load timeout
  that keeps the API price.
- F082: chromedriver/Chrome get a scrubbed environment; --no-sandbox only
  as root or with POKEFIN_CHROME_NO_SANDBOX=1.
- F136: fetch_validated_image shared by the scraper and
  backfill_thumbnails.py; never store a non-allowlisted image URL;
  build_thumbnail refuses sources above 20M pixels before decoding.
- F137: weekly PDF render has a 180 s timeout, kills the process group and
  uses a throwaway profile.
- Track 2: weekly PDF names its source as TCGplayer Market Price in USD,
  carries the site's disclaimer and trademark lines, and drops "internal
  analytical report", "invest accordingly" and em dashes.
- F138: compare_prices.py reads the Shopify token from the environment only.
- F141: remove dead check_shopify_prices() and the unused uuid import.

Findings: F082, F083, F084, F086, F136, F137, F138, F141
```

PR title: `fix(scraper): harden the price pipeline and correct weekly report copy (F083, F084, F086, F082, F136, F137, F138, F141)`

PR body summary:

- What: `main.py` (price guard, history-first writes, flush on exit, SIGTERM, Chrome env and sandbox, page-load timeout, shared image fetch, dead code), `backfill_thumbnails.py`, `generate_weekly_report.py`, `compare_prices.py`, `run_scraper.sh`, `.gitignore`, `migrations/0030_price_plausibility_guard.sql`, `tests/test_pipeline_hardening.py`, `tests/test_new_functions.py`, `README.md`, `audits/HARDENING_FOLLOWUPS.md`.
- Why: one glitched API price became the displayed price for about a day and a permanent one-day spike in history and returns (F083); a run killed at the process level lost up to 99 history rows (F084); overlapping runs, and hung pages that discarded the API price (F086); secrets in an unsandboxed Chrome (F082); unguarded fetch in the backfill and unbounded thumbnail decode (F136); a report render that could hang forever (F137); a token on argv (F138); dead code (F141); a reader-facing PDF that called itself internal, guessed at its source and told readers to "invest accordingly" (Track 2, `research/trust-seo-brand.md` §3).
- Verification output: paste the results of every command in the Verification section and of manual check A.
- **Owner actions required before this is done**: run the pre-check, apply 0030 (MCP `apply_migration` preferred), verify (26 rows OK), deploy on the scraper host, run the Chrome sandbox smoke test as the cron user, watch the first run, update HARDENING_FOLLOWUPS. Full steps in `audits/remediation/WP16-python-pipeline-hardening.md`, section "Owner actions".
- Out of scope, noted for later: `run_scraper.sh` still exports the whole env file into the scraper's environment (WP21 narrows the scraper's key); `send_weekly_email.py`'s body still uses em dashes (rewritten by the Track 2 newsletter work). WP21 must grant its least-privilege scraper role SELECT, INSERT, UPDATE, DELETE on `product_price_pending` and include 0030 in the schema baseline.
