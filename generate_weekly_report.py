#!/usr/bin/env python3
"""
The Pokefin Weekly — automated sealed-product investment report.

Pulls the full price history from Supabase (reusing the scraper's
credentials via secrets_loader), computes per-product returns over the
1M / 3M / 6M / 1Y windows anchored to the latest data date, rolls the
results up by product category and by set, finds the top individual
products, and renders a newspaper-styled PDF via headless Chrome.

Output: reports/pokefin_weekly_<anchor-date>.{html,pdf}

Run:  python generate_weekly_report.py
No hardcoded dates — safe to run on any schedule.
"""

from __future__ import annotations

import os
import sys
import glob
import html
import shutil
import json
import statistics
import subprocess
import time
from datetime import date, datetime, timedelta, timezone

import httpx
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secrets_loader import load_supabase_credentials  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "reports")

# lookback windows: label -> (days back, how far BEFORE the target we will
# reach for a baseline). The tolerance is one-sided on purpose: the baseline
# must sit on or before target, never after it, so a "1y" figure can never be
# computed from a shorter span than its label claims. Both reference
# implementations do the same — get_market_product_metrics() in
# migrations/20260506_market_performance_functions.sql and getReturnPercent()
# in frontend/app/components/MarketView/returns.ts — so matching them keeps the
# newspaper and the website from disagreeing about the same product.
WINDOWS = [("1m", 30, 12), ("3m", 90, 18), ("6m", 180, 20), ("1y", 365, 25)]
PRICE_FLOOR = 15.0          # ignore trivially cheap items in "top product" lists
MIN_CAT_SAMPLE = 3          # categories/sets need at least this many products

# An item whose entire tracked year contains this many distinct prices or fewer
# has had no real price discovery — it is one thin listing that stepped, not a
# market. Ranking on it manufactures triple-digit "returns" from a single
# change. Catches 4 of 302 products today; only one of those also has a >=2x
# step, which is the one that was topping every table.
LIQUIDITY_MIN_DISTINCT_PRICES = 3
LIQUIDITY_WINDOW_DAYS = 365

# How far the newest price row may trail today before the edition is treated as
# stale. Matches the 3-day tolerance used by the listings guard in
# migrations/0022 and isListingsSnapshotFresh() in marketPulse.ts, and the
# scraper's roughly-daily cadence.
ANCHOR_STALE_AFTER_DAYS = 3

# How far a single product's newest price row may trail the anchor before that
# product is dropped from the edition entirely. ANCHOR_STALE_AFTER_DAYS above
# is a whole-report check and cannot fire while any one product is current, so
# without this a dead SKU keeps contributing its last successful price as an
# "end price" and anchors every window return on it — the same
# fabricated-confidence bug migrations/0023 and the frontend guard exist to
# stop. 14 = PRICE_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts;
# keep the three in sync.
PRICE_STALENESS_TOLERANCE_DAYS = 14


# --------------------------------------------------------------------------- #
# Data access
# --------------------------------------------------------------------------- #
# One page failing must not cost the whole edition. product_price_history is
# ~104k rows at 1000 a request, so a full run is 100+ sequential calls and the
# chance that none of them is reset is not the chance any single one succeeds.
# The 2026-08-14 edition was lost exactly this way: httpx.ReadError, "Connection
# reset by peer", partway through the history fetch, and no report that week.
FETCH_MAX_ATTEMPTS = 5
FETCH_BACKOFF_SECONDS = 2.0


# 429 and 5xx only, plus transport faults. A 4xx is a bad request or bad
# credentials and will fail identically five times in a row, so retrying it
# turns a clear error into a slow one.
#
# postgrest-py raises APIError for every non-2xx and throws the HTTP status
# away, so `code` is whichever of two unrelated things the response body
# happened to contain: when the body is not JSON, generate_default_error_message
# puts the HTTP status there as an int; when it IS JSON — which is what
# PostgREST returns for a 500 — it is a PostgreSQL SQLSTATE ('XX000') or a
# PostgREST identifier ('PGRST116'). Reading one as the other is why this has
# to look at both. The library retries on its own, but only 503 and 520 on GET
# (send_with_retry / should_retry, MAX_RETRIES=3), so 500, 502 and 504 reach us
# unretried.
RETRYABLE_SQLSTATE_CLASSES = frozenset({
    "08",  # connection_exception
    "53",  # insufficient_resources - out of memory, too many connections
    "57",  # operator_intervention - query_canceled, admin_shutdown
    "XX",  # internal_error
})

# PostgREST's own identifiers carry no status once APIError has dropped it, so
# the transient ones have to be named. Group 0 is connectivity and group X is
# an internal fault in its database driver; every other group is a request,
# schema-cache or JWT problem that will fail the same way five times.
# PGRST003 is the one that matters most in practice: a pool-acquisition
# timeout, returned as 504, which the client library's own retry does not
# cover because it only retries 503 and 520.
RETRYABLE_PGRST_CODES = frozenset({
    "PGRST000",  # 503 could not connect to the database
    "PGRST001",  # 503 could not connect, internal error
    "PGRST002",  # 503 could not connect while building the schema cache
    "PGRST003",  # 504 timed out waiting for a pool connection
    "PGRSTX00",  # 500 internal error in the connection library
})


def _http_status(exc: Exception) -> int | None:
    """The HTTP status behind an exception, where one is recoverable."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):  # httpx.HTTPStatusError, if it ever surfaces
        return status
    code = getattr(exc, "code", None)
    if isinstance(code, int) and not isinstance(code, bool):
        return code
    # Length is what separates a status from a SQLSTATE: '500' is three
    # digits, '08006' and '57014' are five.
    if isinstance(code, str) and len(code) == 3 and code.isdigit():
        return int(code)
    return None


def _error_code(exc: Exception) -> str | None:
    code = getattr(exc, "code", None)
    return code.strip().upper() if isinstance(code, str) else None


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    status = _http_status(exc)
    if status is not None:
        return status == 429 or 500 <= status < 600
    code = _error_code(exc)
    if code is None:
        return False
    if code.startswith("PGRST"):
        return code in RETRYABLE_PGRST_CODES
    # A SQLSTATE is five characters; its first two are the condition class.
    return len(code) == 5 and code[:2] in RETRYABLE_SQLSTATE_CLASSES


def fetch_page(sb, table, columns, order_col, start, page):
    """One page, retried on transient failure with exponential backoff."""
    for attempt in range(1, FETCH_MAX_ATTEMPTS + 1):
        try:
            resp = (
                sb.table(table)
                .select(columns)
                .order(order_col)
                .range(start, start + page - 1)
                .execute()
            )
            return resp.data or []
        except Exception as exc:  # noqa: BLE001 - re-raised below unless retryable
            if attempt == FETCH_MAX_ATTEMPTS or not _is_retryable(exc):
                raise
            delay = FETCH_BACKOFF_SECONDS * (2 ** (attempt - 1))
            print(f"    {table} rows {start}-{start + page - 1}: "
                  f"{type(exc).__name__} ({exc}); retry {attempt}"
                  f"/{FETCH_MAX_ATTEMPTS - 1} in {delay:.0f}s",
                  file=sys.stderr, flush=True)
            time.sleep(delay)
    return []  # unreachable: the loop either returns or raises


def fetch_all(sb, table, columns, order_col="id", page=1000):
    """Paginate a table fully (Supabase caps each request at ~1000 rows)."""
    rows, start = [], 0
    while True:
        batch = fetch_page(sb, table, columns, order_col, start, page)
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def load_data():
    url, key = load_supabase_credentials()
    sb = create_client(url, key)

    product_types = {r["id"]: (r.get("label") or r["name"])
                     for r in fetch_all(sb, "product_types", "id,name,label")}
    sets = {r["id"]: r for r in fetch_all(sb, "sets", "id,name,release_date")}
    products = {r["id"]: r for r in fetch_all(
        sb, "products", "id,set_id,product_type_id,variant,active")}

    print("  fetching price history (this is the big one)...", flush=True)
    history = fetch_all(
        sb, "product_price_history", "product_id,usd_price,recorded_at")

    return product_types, sets, products, history


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #

def utc_today() -> date:
    """
    Today's date in UTC.

    Not date.today(): recorded_at is written by the scraper from
    datetime.now(timezone.utc) and parse_day reads its date part as a UTC date,
    so measuring an age against the host's local date mixes two calendars. On a
    host west of UTC, in the hours after UTC midnight, that admits a price a
    day older than the tolerance the site enforces — the report and the site
    then disagree about the same product.

    The Linux scraper host happens to run UTC, where the two agree and this is
    a no-op. The macOS checkout the report ran from does not, and neither is a
    property the correctness of an edition should rest on.
    """
    return datetime.now(timezone.utc).date()


def parse_day(ts: str) -> date:
    # recorded_at is naive UTC, e.g. "2026-06-18T04:12:00" or with space
    return date.fromisoformat(ts[:10])


def compute_returns(product_types, sets, products, history):
    # group readings by product: list of (day, price), price>0
    by_product: dict[int, list[tuple[date, float]]] = {}
    global_latest = date.min
    for h in history:
        p = h.get("usd_price")
        pid = h.get("product_id")
        if p is None or p <= 0 or pid is None:
            continue
        d = parse_day(h["recorded_at"])
        by_product.setdefault(pid, []).append((d, p))
        if d > global_latest:
            global_latest = d

    anchor = global_latest  # "as of" date for the whole report

    per_product = []  # dicts with returns + metadata
    for pid, readings in by_product.items():
        prod = products.get(pid)
        if not prod or not prod.get("active"):
            continue
        readings.sort()
        end_day, end_price = readings[-1]

        # A product whose newest reading is older than the tolerance has no
        # current price, so it has no end price to report and nothing to
        # measure a return to. Dropping it here keeps it out of the spotlight
        # tables and out of the category and set medians, rather than letting a
        # months-old figure count as today's.
        #
        # Measured from the publication date, not from `anchor`. The anchor is
        # the newest reading in the whole catalogue and is allowed to trail
        # today by up to ANCHOR_STALE_AFTER_DAYS, so anchoring here would admit
        # a product that is tolerance + 3 days old at publication — 17 days,
        # against the 14 the site enforces. The two guards then disagree about
        # the same product on the same day.
        if (utc_today() - end_day).days > PRICE_STALENESS_TOLERANCE_DAYS:
            continue

        rec = {
            "pid": pid,
            "end_price": end_price,
            "category": product_types.get(prod.get("product_type_id"), "Unknown"),
            "set_name": (sets.get(prod.get("set_id")) or {}).get("name", "Unknown"),
            "release_date": (sets.get(prod.get("set_id")) or {}).get("release_date"),
            "set_id": prod.get("set_id"),
            # Without this, "{set} {category}" collides for 26 product pairs
            # (e.g. Chilling Reign ETB is +60% as Shadow Rider Calyrex and
            # -22% as Ice Rider) and the reader cannot tell which one a
            # spotlight row describes.
            "variant": prod.get("variant"),
        }
        for label, days, tol in WINDOWS:
            target = anchor - timedelta(days=days)
            # One-sided: on or before the target, reaching back at most `tol`
            # days. A reading AFTER the target would measure a shorter span
            # than the label claims and would disagree with the site, which
            # reports nothing rather than a short-span figure.
            lo = target - timedelta(days=tol)
            best = None
            for d, price in readings:
                if lo <= d <= target:
                    dist = (target - d).days
                    if best is None or dist < best[0]:
                        best = (dist, price)
            rec[label] = ((end_price / best[1]) - 1.0) * 100.0 if best else None

        # Liquidity: how much price discovery is behind those returns.
        cutoff = anchor - timedelta(days=LIQUIDITY_WINDOW_DAYS)
        recent_prices = {price for d, price in readings if d >= cutoff}
        rec["distinct_prices"] = len(recent_prices)
        per_product.append(rec)

    return anchor, per_product


def is_artifact(rec) -> bool:
    """Illiquid outlier: too few distinct prices in the trailing year to call
    anything a market return.

    This used to infer the artifact from all four window returns rounding to
    the same value. That condition can only hold while the spike is younger
    than the SHORTEST window (30d): once it ages past that the 1m return
    collapses to 0, the equality breaks and the screen goes permanently blind —
    exactly when such an item is most likely to top the tables. Steam Siege
    Elite Trainer Box (554 readings, two distinct prices, $449.95 -> $1,800)
    slipped through that way and became the #1 one-year hold, the #1 six-month
    mover and the top set, under a printed claim that outliers were removed.

    Screening the price series instead is stable over time: a product with two
    prices in a year has had no price discovery regardless of when the step
    happened.
    """
    return rec.get("distinct_prices", 0) < LIQUIDITY_MIN_DISTINCT_PRICES


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def category_table(per_product):
    """Median return per category, per window.

    Each window carries its OWN sample count and its own MIN_CAT_SAMPLE gate.
    A single row-level `n` taken from the 1m window used to be printed against
    all four columns, which meant "Special Collection (3)" advertised three
    products next to a 1-Year median computed from exactly one — while the
    methodology box told the reader to trust larger samples.

    Artifacts are excluded here too. set_table() and top_products() already
    screened them; category_table() did not, so a product the report had
    identified as an outlier still moved the master-table medians.
    """
    cats: dict[str, list] = {}
    for rec in per_product:
        if is_artifact(rec):
            continue
        cats.setdefault(rec["category"], []).append(rec)
    rows = []
    for cat, recs in cats.items():
        if len(recs) < MIN_CAT_SAMPLE:
            continue
        row = {"category": cat, "n": len(recs)}
        for label, _days, _tol in WINDOWS:
            vals = [r[label] for r in recs if r[label] is not None]
            # Below the gate the median is not worth printing: show a dash
            # rather than a number the reader would weigh as a category fact.
            row[label] = med(vals) if len(vals) >= MIN_CAT_SAMPLE else None
            row["n_" + label] = len(vals)
        rows.append(row)
    rows.sort(key=lambda x: (x["6m"] is None, -(x["6m"] or -1e9)))
    return rows


def set_table(per_product):
    groups: dict[str, list] = {}
    for rec in per_product:
        if is_artifact(rec):
            continue
        groups.setdefault(rec["set_name"], []).append(rec)
    rows = []
    for name, recs in groups.items():
        n6 = sum(1 for r in recs if r["6m"] is not None)
        if n6 < MIN_CAT_SAMPLE:
            continue
        rd = recs[0]["release_date"]
        rows.append({
            "set_name": name,
            "release_date": rd,
            **{"avg_" + w[0]: (statistics.mean([r[w[0]] for r in recs if r[w[0]] is not None])
                               if any(r[w[0]] is not None for r in recs) else None)
               for w in WINDOWS},
        })
    rows.sort(key=lambda x: (x["avg_6m"] is None, -(x["avg_6m"] or -1e9)))
    return rows[:9]


def top_products(per_product, window, k=5):
    pool = [r for r in per_product
            if r[window] is not None and r["end_price"] >= PRICE_FLOOR
            and not is_artifact(r)]
    pool.sort(key=lambda r: -r[window])
    return pool[:k]


# --------------------------------------------------------------------------- #
# Rendering helpers
# --------------------------------------------------------------------------- #
def pct(v, bold=False):
    if v is None:
        return '<td>&mdash;</td>'
    # Round FIRST, then take the sign and colour from the rounded figure.
    # Deriving them from the raw value printed "-0%" in loss red and "+0%" in
    # gain green for returns flat to within half a percent, so statistically
    # identical categories were painted as opposite outcomes on page one.
    r = round(v)
    if r == 0:
        cls, sign = "flat", ""
    else:
        cls, sign = ("pos", "+") if r > 0 else ("neg", "")
    if bold:
        cls += " big"
    return f'<td class="{cls}">{sign}{r:.0f}%</td>'


def pct_n(v, n, bold=False):
    """A percentage cell that states the sample it was computed from.

    The master table used to print one row-level count — taken from the 1m
    window — beside all four columns, so a 1-Year median of a single product
    sat under a "(3)".
    """
    if v is None:
        return '<td>&mdash;</td>'
    inner = pct(v, bold=bold)
    body = inner[inner.index(">") + 1:inner.rindex("</td>")]
    cls = inner[inner.index('class="') + 7:inner.index('">')]
    return f'<td class="{cls}">{body} <span class="n">({n})</span></td>'


def money(v):
    return f"${v:,.0f}"


def fmt_release(rd):
    if not rd:
        return "&mdash;"
    try:
        d = date.fromisoformat(rd[:10])
        return d.strftime("%b %Y")
    except Exception:
        return html.escape(str(rd))


MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def build_html(anchor, per_product, cats, sets_rows, tops, meta):
    long_date = f"{anchor.strftime('%A')}, {MONTHS[anchor.month]} {anchor.day}, {anchor.year}"
    iso_year, iso_week, _ = anchor.isocalendar()
    vol = iso_year - 2024  # Vol I in 2025
    issue = iso_week

    # headline stats — pull a few marquee numbers dynamically
    cat_by_name = {c["category"]: c for c in cats}
    def cat6(name):
        c = cat_by_name.get(name)
        return f"{c['6m']:+.0f}%" if c and c["6m"] is not None else "n/a"
    def cat1y(name):
        c = cat_by_name.get(name)
        return f"{c['1y']:+.0f}%" if c and c["1y"] is not None else "n/a"

    best_set_1y = max((s for s in sets_rows if s["avg_1y"] is not None),
                      key=lambda s: s["avg_1y"], default=None)
    best_set_stat = (f"{best_set_1y['avg_1y']:+.0f}%", best_set_1y["set_name"]) \
        if best_set_1y else ("n/a", "—")

    # find the fastest and slowest categories for the lede narrative
    ranked6 = [c for c in cats if c["6m"] is not None]
    fastest = ranked6[0]["category"] if ranked6 else "Bundles"
    slowest = ranked6[-1]["category"] if ranked6 else "Booster Boxes"

    def cat_rows_html():
        out = []
        for c in cats:
            best6 = c["6m"] is not None and c is (ranked6[0] if ranked6 else None)
            # Each cell carries its own n: the windows cover different
            # populations, since older windows drop products whose history
            # does not reach back that far.
            out.append(
                "<tr><td>{name}</td>{c1}{c3}{c6}{cy}</tr>".format(
                    name=html.escape(c["category"]),
                    c1=pct_n(c["1m"], c["n_1m"]),
                    c3=pct_n(c["3m"], c["n_3m"]),
                    c6=pct_n(c["6m"], c["n_6m"], bold=best6),
                    cy=pct_n(c["1y"], c["n_1y"])))
        return "\n".join(out)

    def set_rows_html():
        out = []
        top_set = sets_rows[0]["set_name"] if sets_rows else None
        for s in sets_rows:
            out.append(
                "<tr><td>{name}</td><td>{rd}</td>{c3}{c6}{cy}</tr>".format(
                    name=html.escape(s["set_name"]), rd=fmt_release(s["release_date"]),
                    c3=pct(s["avg_3m"]),
                    c6=pct(s["avg_6m"], bold=(s["set_name"] == top_set)),
                    cy=pct(s["avg_1y"])))
        return "\n".join(out)

    def top_rows_html(window):
        out = []
        for r in tops[window]:
            v = r[window]
            out.append(
                '<tr><td>{name}</td><td>{price}</td><td class="pos">+{v:.0f}%</td></tr>'.format(
                    name=html.escape(
                        f"{r['set_name']} {r['category']}"
                        + (f" ({r['variant']})" if r.get("variant") else "")),
                    price=money(r["end_price"]), v=v))
        return "\n".join(out)

    excluded = meta["excluded"]
    excluded_note = (
        f"The liquidity screen <strong>excluded {excluded} "
        f"product{'s' if excluded != 1 else ''}</strong> from every ranking "
        f"&mdash; fewer than {LIQUIDITY_MIN_DISTINCT_PRICES} distinct tracked "
        "prices in the trailing year, which is one thin listing rather than a "
        "market. "
        if excluded else
        "Every tracked product cleared the liquidity screen this week. "
    )

    # The narrative below is DERIVED, not asserted. An earlier revision hard-
    # coded a fixed thesis ("Booster Boxes close the gap at twelve months",
    # "overweight ETBs & Bundles") that the generated table contradicted on the
    # very first run and drifted further from every week.
    def _rank_note():
        r6 = [c for c in cats if c["6m"] is not None]
        r1y = [c for c in cats if c["1y"] is not None]
        if not r6:
            return ("Too few categories cleared the sample threshold this week "
                    "to rank them.")
        top6, bot6 = r6[0], r6[-1]
        bits = [
            f"Over six months <strong>{html.escape(top6['category'])}</strong> "
            f"leads at {top6['6m']:+.0f}% and "
            f"<strong>{html.escape(bot6['category'])}</strong> trails at "
            f"{bot6['6m']:+.0f}%"
        ]
        if r1y:
            best1y = max(r1y, key=lambda c: c["1y"])
            worst1y = min(r1y, key=lambda c: c["1y"])
            bits.append(
                f"; over a year <strong>{html.escape(best1y['category'])}</strong> "
                f"leads at {best1y['1y']:+.0f}% and "
                f"<strong>{html.escape(worst1y['category'])}</strong> trails at "
                f"{worst1y['1y']:+.0f}%"
            )
        return "".join(bits) + "."

    standings_note = _rank_note()
    deck_note = (
        f"{html.escape(fastest)} leads the six-month table; "
        f"{html.escape(slowest)} trails it."
        if [c for c in cats if c["6m"] is not None]
        else "Not enough categories cleared the sample threshold to rank them."
    )
    _r1y = [c for c in cats if c["1y"] is not None]
    verdict_note = (
        f"<strong>{html.escape(max(_r1y, key=lambda c: c['1y'])['category'])}</strong> "
        f"posted the strongest one-year median at "
        f"{max(_r1y, key=lambda c: c['1y'])['1y']:+.0f}%, over "
        f"{max(_r1y, key=lambda c: c['1y'])['n_1y']} products."
        if _r1y else
        "No category had enough one-year history to rank this week."
    )

    return TEMPLATE.format(
        long_date=long_date, vol=_roman(vol), issue=issue,
        n_products=meta["n_products"], n_sets=meta["n_sets"],
        n_obs=f"{meta['n_obs']:,}",
        earliest=meta["earliest"], anchor=anchor.isoformat(),
        stat_bundle6=cat6("Booster Bundle"),
        stat_etb1y=cat1y("Elite Trainer Box"),
        stat_box6=cat6("Booster Box"),
        stat_set=best_set_stat[0], stat_set_name=html.escape(best_set_stat[1]),
        fastest=html.escape(fastest), slowest=html.escape(slowest),
        cat_rows=cat_rows_html(), set_rows=set_rows_html(),
        top1y=top_rows_html("1y"), top6m=top_rows_html("6m"),
        excluded_note=excluded_note, price_floor=PRICE_FLOOR,
        standings_note=standings_note, deck_note=deck_note,
        verdict_note=verdict_note,
    )


def _roman(n):
    if n <= 0:
        return str(n)
    vals = [(10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = ""
    for v, s in vals:
        while n >= v:
            out += s
            n -= v
    return out


# --------------------------------------------------------------------------- #
# PDF
# --------------------------------------------------------------------------- #
def find_chrome():
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chrome"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def render_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if not chrome:
        print("  ! Chrome not found — HTML written but PDF skipped.", file=sys.stderr)
        return False
    subprocess.run(
        [chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={pdf_path}", html_path],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return os.path.exists(pdf_path)


# --------------------------------------------------------------------------- #
def write_summary(path, anchor, cats, sets_rows, tops, meta):
    """
    A small machine-readable digest beside the PDF.

    The emailer needs the same marquee figures the front page carries, and the
    alternatives are worse: recomputing them would let the email and the PDF
    drift apart, and scraping them back out of the rendered HTML would break
    the first time the layout changes. The generator already has them in hand.
    """
    def cat_entry(c):
        # n_6m, not n: category_table gates each window on its own sample, so
        # a category's 6M median can come from fewer products than the category
        # holds. The PDF prints the window-specific count; the email quotes this
        # one beside the 6M figure and would otherwise overstate the sample.
        return {"category": c["category"], "n": c["n"],
                "n_6m": c.get("n_6m"), "n_1y": c.get("n_1y"),
                "m6": c.get("6m"), "y1": c.get("1y")}

    ranked6 = [c for c in cats if c.get("6m") is not None]
    best_set = max((s for s in sets_rows if s["avg_1y"] is not None),
                   key=lambda s: s["avg_1y"], default=None)

    def product_entry(r):
        return {"name": f"{r['set_name']} {r['category']}".strip(),
                "variant": r.get("variant"),
                "end_price": r.get("end_price"),
                "return": r.get("1y")}

    summary = {
        "anchor": anchor.isoformat(),
        "n_products": meta["n_products"],
        "n_sets": meta["n_sets"],
        "excluded": meta["excluded"],
        "categories": [cat_entry(c) for c in cats],
        "fastest_category": cat_entry(ranked6[0]) if ranked6 else None,
        "slowest_category": cat_entry(ranked6[-1]) if ranked6 else None,
        "best_set_1y": ({"set_name": best_set["set_name"],
                         "avg_1y": best_set["avg_1y"]} if best_set else None),
        "top_1y": [product_entry(r) for r in tops.get("1y", [])[:3]],
    }
    with open(path, "w") as f:
        json.dump(summary, f, indent=2)
    return summary


def main():
    print("The Pokefin Weekly — generating report")
    print("  loading data from Supabase...", flush=True)
    product_types, sets, products, history = load_data()

    anchor, per_product = compute_returns(product_types, sets, products, history)

    # A stalled scraper must not yield a normal-looking edition. The anchor is
    # disclosed in the filename and masthead, but nothing previously alerted:
    # the job exited 0 and the wrapper announced a fresh report.
    staleness = (utc_today() - anchor).days
    if staleness > ANCHOR_STALE_AFTER_DAYS:
        print(f"! Price data is stale: newest row is {anchor} "
              f"({staleness} days old, tolerance {ANCHOR_STALE_AFTER_DAYS}). "
              f"Refusing to publish an edition that would read as current.",
              file=sys.stderr)
        return 1

    excluded = sum(1 for r in per_product if is_artifact(r))

    cats = category_table(per_product)
    sets_rows = set_table(per_product)
    tops = {"1y": top_products(per_product, "1y"),
            "6m": top_products(per_product, "6m")}

    earliest = min(parse_day(h["recorded_at"]) for h in history
                   if h.get("usd_price"))
    meta = {
        "n_products": len(per_product),
        "n_sets": len({r["set_id"] for r in per_product if r["set_id"]}),
        "n_obs": len(history),
        "earliest": earliest.strftime("%b %-d, %Y"),
        "excluded": excluded,
    }

    doc = build_html(anchor, per_product, cats, sets_rows, tops, meta)

    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = anchor.isoformat()
    html_path = os.path.join(OUT_DIR, f"pokefin_weekly_{stamp}.html")
    pdf_path = os.path.join(OUT_DIR, f"pokefin_weekly_{stamp}.pdf")
    with open(html_path, "w") as f:
        f.write(doc)
    print(f"  wrote {html_path}")

    # Fail loudly. Previously a missing Chrome meant render_pdf() returned
    # False, main() ignored it and exited 0, pokefin_weekly_latest.pdf kept
    # last week's contents, and the wrapper announced a stale PDF as new.
    if not render_pdf(html_path, pdf_path) or not os.path.exists(pdf_path):
        print(f"! No PDF was produced at {pdf_path}. HTML is at {html_path}.",
              file=sys.stderr)
        return 1
    print(f"  wrote {pdf_path}")

    # keep a stable "latest" copy for convenience
    latest = os.path.join(OUT_DIR, "pokefin_weekly_latest.pdf")
    shutil.copyfile(pdf_path, latest)
    print(f"  updated {latest}")

    summary_path = os.path.join(OUT_DIR, f"pokefin_weekly_{stamp}.summary.json")
    write_summary(summary_path, anchor, cats, sets_rows, tops, meta)
    print(f"  wrote {summary_path}")

    print(f"Done. Anchor date {anchor}, {meta['n_products']} products, "
          f"{excluded} illiquid product(s) excluded.")
    # The wrapper greps this to confirm THIS run produced THIS file.
    print(f"REPORT_PDF={pdf_path}")
    print(f"REPORT_SUMMARY={summary_path}")
    return 0


# --------------------------------------------------------------------------- #
# Newspaper template (same design as the one-off report, now parameterized)
# --------------------------------------------------------------------------- #
TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>
  @page {{ size: Letter; margin: 14mm 12mm; }}
  * {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  html, body {{ margin:0; padding:0; }}
  body {{ font-family: Georgia,"Times New Roman",serif; color:#111; background:#fff; line-height:1.42; font-size:10.2px; }}
  .masthead {{ text-align:center; border-bottom:3px double #000; padding-bottom:6px; }}
  .masthead .toprule {{ display:flex; justify-content:space-between; font-size:8.5px; letter-spacing:.5px; text-transform:uppercase; border-bottom:1px solid #000; padding-bottom:3px; margin-bottom:6px; }}
  .title {{ font-family:"Playbill","Bodoni 72","Didot",Georgia,serif; font-weight:900; font-size:52px; line-height:1; letter-spacing:-1px; margin:2px 0; text-transform:uppercase; }}
  .subtitle {{ font-style:italic; font-size:11px; margin-top:4px; }}
  .dateline {{ display:flex; justify-content:space-between; font-size:8.5px; text-transform:uppercase; letter-spacing:1px; border-top:1px solid #000; border-bottom:1px solid #000; padding:3px 0; margin-top:6px; }}
  .lede {{ text-align:center; margin:10px 0 4px; }}
  .lede h1 {{ font-size:26px; line-height:1.08; margin:0; font-weight:900; letter-spacing:-.3px; }}
  .lede .deck {{ font-style:italic; font-size:12px; margin-top:5px; color:#333; }}
  .byline {{ text-align:center; font-size:8.5px; text-transform:uppercase; letter-spacing:1px; margin:6px 0 8px; border-top:1px solid #ccc; border-bottom:1px solid #ccc; padding:3px 0; }}
  .cols {{ column-count:3; column-gap:14px; column-rule:1px solid #bbb; }}
  .cols2 {{ column-count:2; column-gap:16px; column-rule:1px solid #bbb; }}
  p {{ margin:0 0 7px; text-align:justify; hyphens:auto; }}
  p.drop::first-letter {{ font-size:34px; font-weight:900; float:left; line-height:.8; padding:2px 5px 0 0; }}
  h2.sec {{ font-size:13px; text-transform:uppercase; letter-spacing:.6px; border-bottom:2px solid #000; padding-bottom:2px; margin:4px 0 7px; break-after:avoid; }}
  h3.kick {{ font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:#a11; margin:0 0 2px; font-weight:bold; }}
  .break-avoid {{ break-inside:avoid; }}
  table {{ width:100%; border-collapse:collapse; font-size:8.8px; margin:2px 0 8px; }}
  caption {{ caption-side:top; text-align:left; font-weight:bold; font-size:9px; text-transform:uppercase; letter-spacing:.5px; padding-bottom:3px; }}
  th {{ background:#111; color:#fff; text-align:right; padding:3px 4px; font-size:8px; text-transform:uppercase; letter-spacing:.3px; }}
  th:first-child, td:first-child {{ text-align:left; }}
  td {{ padding:2.5px 4px; border-bottom:1px solid #ddd; }}
  tbody tr:nth-child(even) {{ background:#f3f1ec; }}
  .pos {{ color:#0a6b2e; font-weight:bold; }}
  .neg {{ color:#b00; font-weight:bold; }}
  .big {{ font-weight:bold; }}
  .flat {{ color:#555; font-weight:bold; }}
  .n {{ color:#777; font-weight:normal; font-size:0.82em; }}
  .box {{ border:1px solid #000; padding:8px 9px; margin:0 0 9px; background:#f7f5ef; break-inside:avoid; }}
  .verdict {{ border:3px double #000; padding:10px 12px; background:#fbfbf7; break-inside:avoid; }}
  .verdict h2 {{ border:0; margin-top:0; }}
  ul {{ margin:0 0 7px; padding-left:16px; }} li {{ margin-bottom:4px; }}
  .stat {{ text-align:center; padding:4px; }}
  .stat .num {{ font-size:22px; font-weight:900; display:block; line-height:1; }}
  .stat .lbl {{ font-size:7.5px; text-transform:uppercase; letter-spacing:.5px; color:#444; }}
  .statrow {{ display:flex; justify-content:space-between; gap:8px; border-top:1px solid #000; border-bottom:1px solid #000; padding:6px 0; margin:6px 0; }}
  .footer {{ border-top:2px solid #000; margin-top:10px; padding-top:5px; font-size:7.8px; color:#444; text-align:justify; }}
  .pagebreak {{ break-before:page; }}
  .caveat {{ font-size:8.6px; font-style:italic; }}
</style></head><body>

<div class="masthead">
  <div class="toprule"><span>Vol. {vol} &mdash; No. {issue}</span><span>The Sealed Investor's Weekly</span><span>Price &bull; One Booster Pack</span></div>
  <div class="title">The Pok&eacute;fin Weekly</div>
  <div class="subtitle">&ldquo;All the Sealed Product That's Fit to Hold&rdquo; &mdash; A Data Report on Pok&eacute;mon TCG Investing</div>
  <div class="dateline"><span>{long_date}</span><span>Automated Analytics Edition</span><span>{n_products} Products &bull; {n_sets} Sets</span></div>
</div>

<div class="lede">
  <h1>{fastest} Lead the Board; {slowest} Lag the Short Game</h1>
  <div class="deck">This week&rsquo;s read of the price history, anchored to {anchor}. {deck_note}</div>
</div>
<div class="byline">By the Pok&eacute;fin Data Desk &nbsp;|&nbsp; Source: product_price_history ({earliest} &ndash; {long_date}) &nbsp;|&nbsp; Median price change unless noted</div>

<div class="statrow">
  <div class="stat"><span class="num">{stat_bundle6}</span><span class="lbl">Bundle 6-Mo (median)</span></div>
  <div class="stat"><span class="num">{stat_etb1y}</span><span class="lbl">ETB 1-Year (median)</span></div>
  <div class="stat"><span class="num">{stat_box6}</span><span class="lbl">Booster Box 6-Mo</span></div>
  <div class="stat"><span class="num">{stat_set}</span><span class="lbl">Top Set 1-Yr: {stat_set_name}</span></div>
  <div class="stat"><span class="num">{n_products}</span><span class="lbl">Products Tracked</span></div>
</div>

<div class="cols">
  <p class="drop">This is the automated weekly read of every active sealed Pok&eacute;mon product in the Pok&eacute;fin database. For each product the current market price is compared against the price recorded nearest to one month, three months, six months and one year ago; results are then rolled up by category and by set.</p>
  <p>Because a handful of thin-market vintage items can distort a simple average, the <em>median</em> is reported as the headline figure throughout, and an automated screen removes flat-then-spike outliers before any ranking is done.</p>
  <p>{standings_note}</p>
  <p>The usual intuition is that a lower-priced Bundle or ETB turns over quickly and responds rapidly to a set going out of print, whereas an expensive Booster Box trades thinly and moves on a slower clock. Whether that held this week is a question for the table below, not for this paragraph.</p>
  <h3 class="kick">This Week's Screen</h3>
  <p>{excluded_note}The category and set tables that follow reflect the current standings.</p>
</div>

<h2 class="sec">Returns by Product Category &mdash; The Master Table</h2>
<table>
  <caption>Median price change by category (per-column sample size in parentheses) &mdash; ranked by 6-month return</caption>
  <thead><tr><th>Category</th><th>1 Month</th><th>3 Month</th><th>6 Month</th><th>1 Year</th></tr></thead>
  <tbody>
{cat_rows}
  </tbody>
</table>

<div class="cols2">
  <div class="box break-avoid">
    <h3 class="kick">How To Read This</h3>
    <p class="caveat" style="margin-bottom:0;">Figures are <strong>unrealized</strong> tracked prices (likely TCGPlayer market/listing values, before fees). A median of +47% means the typical product in that category is worth 47% more than at the lookback date &mdash; not that every product rose. Each cell states the number of products behind it; windows differ because older windows exclude products whose history does not reach back that far. Cells with fewer than three products are shown as &mdash; rather than a figure.</p>
  </div>
  <div class="break-avoid">
    <h3 class="kick">Methodology In Brief</h3>
    <p>Current price vs. the reading nearest each lookback target date (within a tolerance window). Category figures are medians of per-product percentage change; set figures are averages across a set's tracked products. Products under ${price_floor:.0f} and flagged outliers are excluded from the &ldquo;top product&rdquo; lists.</p>
  </div>
</div>

<div class="pagebreak"></div>

<h2 class="sec">Best-Performing Sets &mdash; The Out-of-Print Effect</h2>
<div class="cols2" style="margin-bottom:6px;">
  <p>At the set level two archetypes tend to dominate: recently out-of-print special sets with chase appeal, and freshly-released hot sets still in their post-launch run-up. The largest one-year gains cluster in anniversary and special sets &mdash; precisely the products that became impossible to restock.</p>
  <p>The lesson for the investor is about timing the print cycle. Buying just ahead of an out-of-print transition has been the single most reliable edge in this dataset. The table at right shows this week's leaders.</p>
</div>

<table>
  <caption>Top sets by average return across all tracked products (&ge;3 products per set)</caption>
  <thead><tr><th>Set</th><th>Released</th><th>3 Month</th><th>6 Month</th><th>1 Year</th></tr></thead>
  <tbody>
{set_rows}
  </tbody>
</table>

<h2 class="sec">Single-Product Spotlight</h2>
<div class="cols2">
  <div class="break-avoid" style="margin-bottom:6px;">
    <h3 class="kick">Best One-Year Holds</h3>
    <table style="margin-top:0;"><thead><tr><th>Product</th><th>Price Now</th><th>1-Yr</th></tr></thead>
    <tbody>
{top1y}
    </tbody></table>
  </div>
  <div class="break-avoid" style="margin-bottom:6px;">
    <h3 class="kick">Hottest Six-Month Momentum</h3>
    <table style="margin-top:0;"><thead><tr><th>Product</th><th>Price Now</th><th>6-Mo</th></tr></thead>
    <tbody>
{top6m}
    </tbody></table>
  </div>
</div>

<div class="verdict">
  <h2 class="sec" style="border-bottom:2px solid #000;">The Investor's Verdict &mdash; What To Actually Do</h2>
  <div class="cols2">
    <div>
      <h3 class="kick">1. Where The Return Was This Week</h3>
      <p style="margin-bottom:6px;">{verdict_note} These are medians of tracked prices over the stated window &mdash; a description of what happened, not a forecast or a recommendation to buy.</p>
      <h3 class="kick">2. Sample Before Signal</h3>
      <p style="margin-bottom:0;">Read the per-column counts before the percentages. A category&rsquo;s one-year figure often rests on far fewer products than its one-month figure, because only products tracked that long can contribute.</p>
    </div>
    <div>
      <h3 class="kick">3. Thin Markets Flatter Themselves</h3>
      <p style="margin-bottom:6px;">Vintage sealed items can sit at one asking price for months and then step once. That single step reads as a triple-digit &ldquo;return&rdquo; even though nothing traded. Products with fewer than three distinct prices in the trailing year are excluded from every ranking here for that reason.</p>
      <h3 class="kick">4. Mind The Caveats</h3>
      <p class="caveat" style="margin-bottom:0;">Returns are unrealized and pre-fee. The dataset carries survivorship bias (only tracked products appear). Vintage items trade thin &mdash; one listing can move the price. Past appreciation does not guarantee future returns.</p>
    </div>
  </div>
</div>

<div class="footer">
  THE POK&Eacute;FIN WEEKLY &mdash; Automated Analytics Edition. Generated from the Pok&eacute;fin Supabase database, covering {n_obs} price observations across {n_products} active products and {n_sets} sets, from {earliest} to {long_date}. Methodology: current price compared to the nearest reading on or before each lookback target date, within a tolerance window; category figures are medians and set figures are averages of per-product percentage change; products with fewer than three distinct tracked prices in the trailing year are excluded from all rankings as illiquid. Prices in USD. This document is an internal analytical report and does not constitute financial advice. Sealed collectible markets are volatile and illiquid; invest accordingly.
</div>

</body></html>
"""


if __name__ == "__main__":
    sys.exit(main() or 0)
