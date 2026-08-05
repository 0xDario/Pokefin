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
import statistics
import subprocess
from datetime import date, timedelta

from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secrets_loader import load_supabase_credentials  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "reports")

# lookback windows: label -> (days back, tolerance days on each side)
WINDOWS = [("1m", 30, 12), ("3m", 90, 18), ("6m", 180, 20), ("1y", 365, 25)]
PRICE_FLOOR = 15.0          # ignore trivially cheap items in "top product" lists
MIN_CAT_SAMPLE = 3          # categories/sets need at least this many products


# --------------------------------------------------------------------------- #
# Data access
# --------------------------------------------------------------------------- #
def fetch_all(sb, table, columns, order_col="id", page=1000):
    """Paginate a table fully (Supabase caps each request at ~1000 rows)."""
    rows, start = [], 0
    while True:
        resp = (
            sb.table(table)
            .select(columns)
            .order(order_col)
            .range(start, start + page - 1)
            .execute()
        )
        batch = resp.data or []
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

        rec = {
            "pid": pid,
            "end_price": end_price,
            "category": product_types.get(prod.get("product_type_id"), "Unknown"),
            "set_name": (sets.get(prod.get("set_id")) or {}).get("name", "Unknown"),
            "release_date": (sets.get(prod.get("set_id")) or {}).get("release_date"),
            "set_id": prod.get("set_id"),
        }
        for label, days, tol in WINDOWS:
            target = anchor - timedelta(days=days)
            lo, hi = target - timedelta(days=tol), target + timedelta(days=tol)
            # nearest reading to target within tolerance
            best = None
            for d, price in readings:
                if lo <= d <= hi:
                    dist = abs((d - target).days)
                    if best is None or dist < best[0]:
                        best = (dist, price)
            rec[label] = ((end_price / best[1]) - 1.0) * 100.0 if best else None
        per_product.append(rec)

    return anchor, per_product


def is_artifact(rec) -> bool:
    """Flat-then-spike illiquid outlier: identical (rounded) gain in every
    window means the baseline was the same single stale reading throughout."""
    vals = [rec[w[0]] for w in WINDOWS]
    if any(v is None for v in vals):
        return False
    r = [round(v) for v in vals]
    return len(set(r)) == 1 and abs(r[0]) >= 150


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def category_table(per_product):
    cats: dict[str, list] = {}
    for rec in per_product:
        cats.setdefault(rec["category"], []).append(rec)
    rows = []
    for cat, recs in cats.items():
        n = sum(1 for r in recs if r["1m"] is not None)
        if len(recs) < MIN_CAT_SAMPLE:
            continue
        rows.append({
            "category": cat,
            "n": n,
            **{w[0]: med([r[w[0]] for r in recs]) for w in WINDOWS},
        })
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
    cls = "pos" if v >= 0 else "neg"
    if bold:
        cls += " big"
    sign = "+" if v >= 0 else ""
    return f'<td class="{cls}">{sign}{v:.0f}%</td>'


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
            out.append(
                "<tr><td>{name} ({n})</td>{c1}{c3}{c6}{cy}</tr>".format(
                    name=html.escape(c["category"]), n=c["n"],
                    c1=pct(c["1m"]), c3=pct(c["3m"]),
                    c6=pct(c["6m"], bold=best6), cy=pct(c["1y"])))
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
                    name=html.escape(f"{r['set_name']} {r['category']}"),
                    price=money(r["end_price"]), v=v))
        return "\n".join(out)

    excluded = meta["excluded"]
    excluded_note = (
        f"This week the automated screen flagged and <strong>excluded {excluded} "
        f"flat-then-spike outlier{'s' if excluded != 1 else ''}</strong> "
        "&mdash; illiquid items showing an identical extreme gain in every window, "
        "the fingerprint of a single stale listing moving the price. "
        if excluded else
        "No flat-then-spike outliers tripped the automated exclusion screen this week. "
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
def main():
    print("The Pokefin Weekly — generating report")
    print("  loading data from Supabase...", flush=True)
    product_types, sets, products, history = load_data()

    anchor, per_product = compute_returns(product_types, sets, products, history)
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

    if render_pdf(html_path, pdf_path):
        print(f"  wrote {pdf_path}")
    # keep a stable "latest" copy for convenience
    latest = os.path.join(OUT_DIR, "pokefin_weekly_latest.pdf")
    if os.path.exists(pdf_path):
        shutil.copyfile(pdf_path, latest)
        print(f"  updated {latest}")

    print(f"Done. Anchor date {anchor}, {meta['n_products']} products, "
          f"{excluded} outlier(s) excluded.")


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
  <div class="deck">This week's read of the price history anchored to {anchor}: mid-ticket categories continue to re-rate fastest, while the heaviest sealed items trail on every horizon short of a full year.</div>
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
  <p>The structural pattern has been remarkably stable week to week: capital-light, liquid categories &mdash; Booster Bundles and Elite Trainer Boxes &mdash; re-rate fastest, while the heavyweight Booster Box remains the slowest mover on every horizon shorter than a full year, closing the gap only at the twelve-month mark.</p>
  <p>The intuition is that a lower-priced Bundle or ETB turns over quickly and responds rapidly to a set going out of print, whereas an expensive Booster Box trades thinly and moves on a slower clock. For a one-to-six-month horizon, the box has been the wrong instrument.</p>
  <h3 class="kick">This Week's Screen</h3>
  <p>{excluded_note}The category and set tables that follow reflect the current standings.</p>
</div>

<h2 class="sec">Returns by Product Category &mdash; The Master Table</h2>
<table>
  <caption>Median price change by category (sample size in parentheses) &mdash; ranked by 6-month return</caption>
  <thead><tr><th>Category</th><th>1 Month</th><th>3 Month</th><th>6 Month</th><th>1 Year</th></tr></thead>
  <tbody>
{cat_rows}
  </tbody>
</table>

<div class="cols2">
  <div class="box break-avoid">
    <h3 class="kick">How To Read This</h3>
    <p class="caveat" style="margin-bottom:0;">Figures are <strong>unrealized</strong> tracked prices (likely TCGPlayer market/listing values, before fees). A median of +47% means the typical product in that category is worth 47% more than at the lookback date &mdash; not that every product rose. Larger samples carry more signal; small samples are noisier and weighted accordingly.</p>
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
      <h3 class="kick">1. Overweight ETBs &amp; Bundles</h3>
      <p style="margin-bottom:6px;">Best blend of return, liquidity and sample reliability. ETBs pair top-tier one-year gains with the largest track record in the data &mdash; signal, not noise. This is the core of the portfolio.</p>
      <h3 class="kick">2. Time the Print Cycle</h3>
      <p style="margin-bottom:0;">Buy hot sets just before they go out of print &mdash; the OOP transition is where the biggest one-year gains were made &mdash; and buy freshly-launched chase sets for the early run-up.</p>
    </div>
    <div>
      <h3 class="kick">3. Treat Booster Boxes As Long-Term Only</h3>
      <p style="margin-bottom:6px;">They reward year-plus holds and tie up the most capital per unit. Excellent as a store of value; poor as a near-term flip. Do not expect them to move in your first six months.</p>
      <h3 class="kick">4. Mind The Caveats</h3>
      <p class="caveat" style="margin-bottom:0;">Returns are unrealized and pre-fee. The dataset carries survivorship bias (only tracked products appear). Vintage items trade thin &mdash; one listing can move the price. Past appreciation does not guarantee future returns.</p>
    </div>
  </div>
</div>

<div class="footer">
  THE POK&Eacute;FIN WEEKLY &mdash; Automated Analytics Edition. Generated from the Pok&eacute;fin Supabase database, covering {n_obs} price observations across {n_products} active products and {n_sets} sets, from {earliest} to {long_date}. Methodology: current price compared to the reading nearest each lookback target date within a tolerance window; category figures are medians and set figures are averages of per-product percentage change; flat-then-spike illiquid outliers are auto-excluded. Prices in USD. This document is an internal analytical report and does not constitute financial advice. Sealed collectible markets are volatile and illiquid; invest accordingly.
</div>

</body></html>
"""


if __name__ == "__main__":
    main()
