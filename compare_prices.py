"""
Price Comparison Script - Shopify vs Market Prices

Compares your Shopify listing prices (CAD) against Pokefin market prices (USD from TCGPlayer)
to identify products that may be priced below market value.

Uses the latest USD/CAD exchange rate from Bank of Canada (stored in Pokefin).

Usage:
  python compare_prices.py                                 # Compare prices from CSV export
  python compare_prices.py --threshold 10                  # Alert if Shopify is 10%+ below market
  python compare_prices.py --export alerts.csv             # Export alerts to CSV
  python compare_prices.py --show-usd                      # Show USD prices alongside CAD
  python compare_prices.py --shopify-source api            # Pull Shopify prices via Admin API
  python compare_prices.py --shopify-source api --shopify-domain my-store.myshopify.com --shopify-token shpat_xxx
"""

import argparse
import csv
import logging
import os
import requests
from datetime import datetime
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY
try:
    from secretsFile import SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_API_VERSION
except ImportError:
    SHOPIFY_STORE_DOMAIN = ""
    SHOPIFY_ADMIN_API_TOKEN = ""
    SHOPIFY_API_VERSION = "2024-07"

# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def _get_shopify_credentials(domain_arg: str | None, token_arg: str | None, api_version_arg: str | None) -> tuple[str, str, str]:
    """Resolve Shopify credentials from CLI args, environment, or secrets."""
    domain = (domain_arg or os.getenv("SHOPIFY_STORE_DOMAIN") or SHOPIFY_STORE_DOMAIN or "").strip()
    token = (token_arg or os.getenv("SHOPIFY_ADMIN_API_TOKEN") or SHOPIFY_ADMIN_API_TOKEN or "").strip()
    api_version = (api_version_arg or os.getenv("SHOPIFY_API_VERSION") or SHOPIFY_API_VERSION or "2024-07").strip()
    return domain, token, api_version


def fetch_shopify_products_api(domain: str, token: str, api_version: str) -> dict:
    """Fetch Shopify products with SKUs and prices via Admin API."""
    if not domain or not token:
        raise ValueError("Shopify domain/token missing. Set them via args, env vars, or secretsFile.py")

    logger.info("Fetching Shopify products via Admin API...")

    products: dict[str, dict] = {}
    headers = {
        "X-Shopify-Access-Token": token,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    url = f"https://{domain}/admin/api/{api_version}/products.json"
    params = {"limit": 250, "fields": "id,title,handle,variants"}

    while url:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        if response.status_code in {401, 403, 404}:
            _raise_shopify_http_error(response, domain, api_version)
        response.raise_for_status()
        payload = response.json()
        for product in payload.get("products", []):
            title = (product.get("title") or "").strip()
            handle = (product.get("handle") or "").strip()
            for variant in product.get("variants", []):
                sku = (variant.get("sku") or "").strip()
                price_str = (variant.get("price") or "").strip()
                cost_str = (variant.get("cost") or "").strip()
                if not sku or not price_str:
                    continue
                try:
                    price = float(price_str)
                except ValueError:
                    continue
                cost = None
                if cost_str:
                    try:
                        cost = float(cost_str)
                    except ValueError:
                        cost = None
                products[sku] = {
                    "sku": sku,
                    "title": title or sku,
                    "shopify_price": price,
                    "shopify_cost": cost,
                    "handle": handle,
                }

        next_url = response.links.get("next", {}).get("url")
        url = next_url
        params = None

    logger.info(f"Fetched {len(products)} Shopify products with SKUs via API")
    return products


def _raise_shopify_http_error(response: requests.Response, domain: str, api_version: str) -> None:
    """Raise a friendly error for common Shopify Admin API issues."""
    status = response.status_code
    if status == 401:
        raise SystemExit(
            "Shopify API unauthorized (401). Check that the app is installed on the store and "
            "the Admin API access token is correct."
        )
    if status == 403:
        raise SystemExit(
            "Shopify API forbidden (403). Ensure the app has read_products/read_inventory scopes "
            "and reinstall the app to apply scope changes."
        )
    if status == 404:
        raise SystemExit(
            f"Shopify API not found (404). Verify the store domain ({domain}) and API version "
            f"({api_version}). Try --shopify-api-version 2024-07 if unsure."
        )


def fetch_exchange_rate() -> tuple[float, str]:
    """Fetch the latest USD/CAD exchange rate from Pokefin."""
    logger.info("Fetching latest USD/CAD exchange rate...")

    try:
        response = supabase.table("exchange_rates").select(
            "usd_to_cad, recorded_at"
        ).order("recorded_at", desc=True).limit(1).execute()

        if response.data:
            rate = response.data[0]['usd_to_cad']
            recorded_at = response.data[0]['recorded_at']
            logger.info(f"Exchange rate: 1 USD = {rate:.4f} CAD (as of {recorded_at})")
            return rate, recorded_at
        else:
            logger.warning("No exchange rate found, using default 1.35")
            return 1.35, "unknown"

    except Exception as e:
        logger.error(f"Failed to fetch exchange rate: {e}")
        logger.warning("Using default exchange rate: 1.35")
        return 1.35, "unknown"


def load_shopify_products(filepath: str) -> dict:
    """Load Shopify products with SKUs and prices."""
    products = {}

    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            sku = row.get('Variant SKU', '').strip()
            title = row.get('Title', '').strip()
            price_str = row.get('Variant Price', '').strip()
            cost_str = row.get('Cost per item', '').strip()
            handle = row.get('Handle', '').strip()

            # Skip rows without SKU or title (image rows)
            if not sku or not title:
                continue

            # Parse price
            try:
                price = float(price_str) if price_str else None
            except ValueError:
                price = None
            try:
                cost = float(cost_str) if cost_str else None
            except ValueError:
                cost = None

            if sku and price is not None:
                products[sku] = {
                    'sku': sku,
                    'title': title,
                    'shopify_price': price,
                    'shopify_cost': cost,
                    'handle': handle,
                }

    return products


def fetch_pokefin_prices() -> dict:
    """Fetch current market prices from Pokefin database."""
    logger.info("Fetching market prices from Pokefin...")

    try:
        response = supabase.table("products").select(
            "id, sku, usd_price, last_updated, "
            "sets(name, code), "
            "product_types(name, label)"
        ).not_.is_("sku", "null").execute()

        products = {}
        for row in response.data:
            sku = row.get('sku')
            if sku:
                set_info = row.get('sets') or {}
                type_info = row.get('product_types') or {}

                products[sku] = {
                    'sku': sku,
                    'market_price': row.get('usd_price'),
                    'last_updated': row.get('last_updated'),
                    'set_name': set_info.get('name', 'Unknown'),
                    'product_type': type_info.get('label') or type_info.get('name', 'Unknown'),
                }

        return products

    except Exception as e:
        error_msg = str(e)
        if "402" in error_msg or "quota" in error_msg.lower():
            logger.error("Supabase storage quota exceeded. Please resolve at https://supabase.help")
            raise SystemExit("Database unavailable - storage quota exceeded")
        raise


def compare_prices(shopify_products: dict, pokefin_products: dict, exchange_rate: float, threshold_pct: float = 0) -> dict:
    """Compare prices between Shopify (CAD) and Pokefin (USD converted to CAD)."""
    results = {
        'matched': [],
        'below_market': [],
        'above_market': [],
        'no_market_price': [],
        'shopify_only': [],
        'pokefin_only': [],
        'exchange_rate': exchange_rate,
    }

    # Find matches and compare
    for sku, shopify in shopify_products.items():
        if sku in pokefin_products:
            pokefin = pokefin_products[sku]
            market_price_usd = pokefin.get('market_price')
            shopify_price_cad = shopify.get('shopify_price')
            shopify_cost = shopify.get('shopify_cost')

            if market_price_usd is None:
                results['no_market_price'].append({
                    **shopify,
                    **pokefin,
                    'shopify_profit': _calculate_profit(shopify_price_cad, shopify_cost),
                    'shopify_profit_pct': _calculate_profit_pct(shopify_price_cad, shopify_cost),
                })
                continue

            # Convert USD market price to CAD
            market_price_cad = market_price_usd * exchange_rate

            # Calculate difference (both in CAD now)
            diff = shopify_price_cad - market_price_cad
            diff_pct = (diff / market_price_cad) * 100 if market_price_cad > 0 else 0

            comparison = {
                **shopify,
                'market_price_usd': market_price_usd,
                'market_price_cad': market_price_cad,
                'difference': diff,
                'difference_pct': diff_pct,
                'shopify_profit': _calculate_profit(shopify_price_cad, shopify_cost),
                'shopify_profit_pct': _calculate_profit_pct(shopify_price_cad, shopify_cost),
                'market_profit': _calculate_profit(market_price_cad, shopify_cost),
                'market_profit_pct': _calculate_profit_pct(market_price_cad, shopify_cost),
                'set_name': pokefin.get('set_name'),
                'product_type': pokefin.get('product_type'),
                'last_updated': pokefin.get('last_updated'),
            }

            results['matched'].append(comparison)

            # Categorize by threshold
            if diff_pct < -threshold_pct:
                results['below_market'].append(comparison)
            elif diff_pct > threshold_pct:
                results['above_market'].append(comparison)
        else:
            results['shopify_only'].append(shopify)

    # Find Pokefin products not in Shopify
    for sku, pokefin in pokefin_products.items():
        if sku not in shopify_products:
            results['pokefin_only'].append(pokefin)

    return results


def _calculate_profit(price: float | None, cost: float | None) -> float | None:
    if price is None or cost is None:
        return None
    return price - cost


def _calculate_profit_pct(price: float | None, cost: float | None) -> float | None:
    if price is None or cost is None or price == 0:
        return None
    return ((price - cost) / price) * 100


def _fmt_currency(value: float | None, width: int) -> str:
    if value is None:
        return f"{'N/A':>{width}}"
    return f"${value:>{width - 1}.2f}"


def _fmt_signed_currency(value: float | None, width: int) -> str:
    if value is None:
        return f"{'N/A':>{width}}"
    sign = "-" if value < 0 else "+"
    return f"{sign}${abs(value):>{width - 2}.2f}"


def _fmt_percent(value: float | None, width: int, show_sign: bool = False) -> str:
    if value is None:
        return f"{'N/A':>{width}}"
    if show_sign and value >= 0:
        return f"+{value:>{width - 1}.1f}%"
    return f"{value:>{width}.1f}%"


def print_report(results: dict, threshold_pct: float, show_usd: bool = False):
    """Print price comparison report."""
    matched = results['matched']
    below = results['below_market']
    above = results['above_market']
    no_price = results['no_market_price']
    shopify_only = results['shopify_only']
    pokefin_only = results['pokefin_only']
    exchange_rate = results.get('exchange_rate', 1.0)

    print("\n" + "=" * 100)
    print("PRICE COMPARISON REPORT - Shopify (CAD) vs Market (USD → CAD)")
    print("=" * 100)
    print(f"Exchange Rate:            1 USD = {exchange_rate:.4f} CAD")
    print(f"Total matched by SKU:     {len(matched)}")
    print(f"Below market (>{threshold_pct}%):    {len(below)}")
    print(f"Above market (>{threshold_pct}%):    {len(above)}")
    print(f"No market price:          {len(no_price)}")
    print(f"Shopify only (no match):  {len(shopify_only)}")
    print(f"Pokefin only (not sold):  {len(pokefin_only)}")
    print("=" * 100)

    # Alert: Below market
    if below:
        print("\n🚨 BELOW MARKET VALUE - Consider raising prices:")
        print("-" * 100)
        if show_usd:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market USD':>11} "
                f"{'Market':>11} {'Diff':>10} {'%':>7}  Product"
            )
        else:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market':>12} {'Diff':>10} {'Diff %':>8}  Product"
            )
        print("-" * 100)

        for item in sorted(below, key=lambda x: x['difference_pct']):
            shopify_price_str = _fmt_currency(item['shopify_price'], 12)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            diff_str = _fmt_signed_currency(item['difference'], 10)
            diff_pct_str = f"{item['difference_pct']:>6.1f}%"
            if show_usd:
                market_usd_str = _fmt_currency(item['market_price_usd'], 11)
                market_cad_str = _fmt_currency(item['market_price_cad'], 11)
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} {market_usd_str} "
                    f"{market_cad_str} {diff_str} {diff_pct_str}  "
                    f"{item['title'][:25]}"
                )
            else:
                market_cad_str = _fmt_currency(item['market_price_cad'], 12)
                diff_pct_str = f"{item['difference_pct']:>7.1f}%"
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} "
                    f"{market_cad_str} {diff_str} {diff_pct_str}  {item['title'][:30]}"
                )

    # Info: Above market
    if above:
        print("\n📈 ABOVE MARKET VALUE - Competitive pricing:")
        print("-" * 100)
        if show_usd:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market USD':>11} "
                f"{'Market':>11} {'Diff':>10} {'%':>7}  Product"
            )
        else:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market':>12} {'Diff':>10} {'Diff %':>8}  Product"
            )
        print("-" * 100)

        for item in sorted(above, key=lambda x: -x['difference_pct'])[:10]:
            shopify_price_str = _fmt_currency(item['shopify_price'], 12)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            diff_str = _fmt_signed_currency(item['difference'], 10)
            diff_pct_str = f"+{item['difference_pct']:>5.1f}%" if item['difference_pct'] >= 0 else f"{item['difference_pct']:>6.1f}%"
            if show_usd:
                market_usd_str = _fmt_currency(item['market_price_usd'], 11)
                market_cad_str = _fmt_currency(item['market_price_cad'], 11)
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} {market_usd_str} "
                    f"{market_cad_str} {diff_str} {diff_pct_str}  "
                    f"{item['title'][:25]}"
                )
            else:
                market_cad_str = _fmt_currency(item['market_price_cad'], 12)
                diff_pct_str = f"+{item['difference_pct']:>6.1f}%" if item['difference_pct'] >= 0 else f"{item['difference_pct']:>7.1f}%"
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} "
                    f"{market_cad_str} {diff_str} {diff_pct_str}  {item['title'][:30]}"
                )

        if len(above) > 10:
            print(f"  ... and {len(above) - 10} more above market")

    # All matched prices
    if matched:
        print("\n📊 ALL MATCHED PRODUCTS:")
        print("-" * 100)
        if show_usd:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market USD':>11} "
                f"{'Market':>11} {'Diff':>10} {'%':>7}  Status"
            )
        else:
            print(
                f"{'SKU':<22} {'Shopify':>12} {'Cost':>10} {'Market':>12} {'Diff':>10} {'Diff %':>8}  Status"
            )
        print("-" * 100)

        for item in sorted(matched, key=lambda x: x['difference_pct']):
            diff_pct = item['difference_pct']
            if diff_pct < -threshold_pct:
                status = "⚠️  BELOW"
            elif diff_pct > threshold_pct:
                status = "📈 ABOVE"
            else:
                status = "✓  OK"

            shopify_price_str = _fmt_currency(item['shopify_price'], 12)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            diff_str = _fmt_signed_currency(item['difference'], 10)
            pct_str = f"{item['difference_pct']:>6.1f}%" if item['difference_pct'] >= 0 else f"{item['difference_pct']:>6.1f}%"

            if show_usd:
                market_usd_str = _fmt_currency(item['market_price_usd'], 11)
                market_cad_str = _fmt_currency(item['market_price_cad'], 11)
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} {market_usd_str} "
                    f"{market_cad_str} {diff_str} {pct_str}  {status}"
                )
            else:
                market_cad_str = _fmt_currency(item['market_price_cad'], 12)
                print(
                    f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} "
                    f"{market_cad_str} {diff_str} {pct_str}  {status}"
                )

    # Shopify products without match
    if shopify_only:
        print("\n⚠️  SHOPIFY PRODUCTS WITHOUT POKEFIN MATCH:")
        print("-" * 100)
        for item in shopify_only:
            shopify_price_str = _fmt_currency(item['shopify_price'], 10)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            print(
                f"  {item['sku']:<25} {shopify_price_str} {shopify_cost_str}  {item['title'][:45]}"
            )

    # No market price
    if no_price:
        print("\n❓ MATCHED BUT NO MARKET PRICE (needs price update):")
        print("-" * 100)
        for item in no_price:
            shopify_price_str = _fmt_currency(item['shopify_price'], 10)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            print(
                f"  {item['sku']:<25} {shopify_price_str} {shopify_cost_str}  {item['title'][:40]}"
            )

    if matched:
        print("\n💰 SHOPIFY PROFIT SUMMARY (ALL MATCHED PRODUCTS):")
        print("-" * 100)
        print(
            f"{'SKU':<22} {'Shopify':>10} {'Cost':>10} {'Profit':>10} {'Margin':>9}"
        )
        print("-" * 100)

        for item in sorted(
            matched,
            key=lambda x: (x.get('shopify_profit_pct') is None, x.get('shopify_profit_pct', 0))
        ):
            shopify_price_str = _fmt_currency(item['shopify_price'], 10)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)
            shopify_profit_str = _fmt_signed_currency(item.get('shopify_profit'), 10)
            shopify_profit_pct_str = _fmt_percent(item.get('shopify_profit_pct'), 9)
            print(
                f"{item['sku']:<22} {shopify_price_str} {shopify_cost_str} {shopify_profit_str} {shopify_profit_pct_str}"
            )

        print("\n💰 MARKET PROFIT SUMMARY (ALL MATCHED PRODUCTS):")
        print("-" * 100)
        if show_usd:
            print(
                f"{'SKU':<22} {'Market USD':>11} {'Market':>10} {'Cost':>10} {'Profit':>10} {'Margin':>9}"
            )
        else:
            print(
                f"{'SKU':<22} {'Market':>10} {'Cost':>10} {'Profit':>10} {'Margin':>9}"
            )
        print("-" * 100)

        for item in sorted(
            matched,
            key=lambda x: (x.get('market_profit_pct') is None, x.get('market_profit_pct', 0))
        ):
            market_cad_str = _fmt_currency(item['market_price_cad'], 10)
            market_profit_str = _fmt_signed_currency(item.get('market_profit'), 10)
            market_profit_pct_str = _fmt_percent(item.get('market_profit_pct'), 9)
            shopify_cost_str = _fmt_currency(item.get('shopify_cost'), 10)

            if show_usd:
                market_usd_str = _fmt_currency(item['market_price_usd'], 11)
                print(
                    f"{item['sku']:<22} {market_usd_str} {market_cad_str} {shopify_cost_str} "
                    f"{market_profit_str} {market_profit_pct_str}"
                )
            else:
                print(
                    f"{item['sku']:<22} {market_cad_str} {shopify_cost_str} {market_profit_str} {market_profit_pct_str}"
                )

    print()


def export_alerts(results: dict, filepath: str, threshold_pct: float):
    """Export price alerts to CSV."""
    exchange_rate = results.get('exchange_rate', 1.0)

    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'SKU', 'Title', 'Shopify Price', 'Shopify Cost', 'Shopify Profit',
            'Market Price (USD)', 'Market Price', 'Market Profit',
            'Difference', 'Difference (%)', 'Status', 'Set', 'Product Type', 'Exchange Rate'
        ])

        for item in sorted(results['matched'], key=lambda x: x['difference_pct']):
            diff_pct = item['difference_pct']
            if diff_pct < -threshold_pct:
                status = "BELOW MARKET"
            elif diff_pct > threshold_pct:
                status = "ABOVE MARKET"
            else:
                status = "OK"

            writer.writerow([
                item['sku'],
                item['title'],
                f"{item['shopify_price']:.2f}",
                f"{item.get('shopify_cost'):.2f}" if item.get('shopify_cost') is not None else '',
                f"{item.get('shopify_profit'):.2f}" if item.get('shopify_profit') is not None else '',
                f"{item['market_price_usd']:.2f}",
                f"{item['market_price_cad']:.2f}",
                f"{item.get('market_profit'):.2f}" if item.get('market_profit') is not None else '',
                f"{item['difference']:.2f}",
                f"{item['difference_pct']:.1f}",
                status,
                item.get('set_name', ''),
                item.get('product_type', ''),
                f"{exchange_rate:.4f}",
            ])

        # Add unmatched
        for item in results['shopify_only']:
            writer.writerow([
                item['sku'],
                item['title'],
                f"{item['shopify_price']:.2f}",
                f"{item.get('shopify_cost'):.2f}" if item.get('shopify_cost') is not None else '',
                f"{_calculate_profit(item['shopify_price'], item.get('shopify_cost')):.2f}" if item.get('shopify_cost') is not None else '',
                '',
                '',
                '',
                '',
                'NO MATCH',
                '',
                '',
                '',
            ])

    logger.info(f"Exported price comparison to: {filepath}")


def main():
    parser = argparse.ArgumentParser(
        description="Compare Shopify prices (CAD) vs Pokefin market prices (USD)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "--shopify",
        default="products_export.csv",
        help="Path to Shopify products export CSV (default: products_export.csv)"
    )
    parser.add_argument(
        "--shopify-source",
        choices=["csv", "api"],
        default="csv",
        help="Shopify data source: csv (default) or api"
    )
    parser.add_argument(
        "--shopify-domain",
        help="Shopify store domain (e.g., my-store.myshopify.com)."
    )
    parser.add_argument(
        "--shopify-token",
        help="Shopify Admin API access token (shpat_...)."
    )
    parser.add_argument(
        "--shopify-api-version",
        help="Shopify Admin API version (default: 2024-07)."
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=5.0,
        help="Alert threshold percentage (default: 5.0 = alert if >5%% below/above market)"
    )
    parser.add_argument(
        "--export",
        help="Export results to CSV file"
    )
    parser.add_argument(
        "--show-usd",
        action="store_true",
        help="Show USD prices alongside CAD in the report"
    )

    args = parser.parse_args()

    # Fetch exchange rate first
    exchange_rate, rate_date = fetch_exchange_rate()

    # Load Shopify products
    if args.shopify_source == "api":
        domain, token, api_version = _get_shopify_credentials(
            args.shopify_domain,
            args.shopify_token,
            args.shopify_api_version,
        )
        shopify_products = fetch_shopify_products_api(domain, token, api_version)
    else:
        logger.info(f"Loading Shopify products: {args.shopify}")
        shopify_products = load_shopify_products(args.shopify)
        logger.info(f"Loaded {len(shopify_products)} Shopify products with SKUs")

    # Fetch Pokefin market prices
    pokefin_products = fetch_pokefin_prices()
    logger.info(f"Fetched {len(pokefin_products)} Pokefin products with SKUs")

    # Compare prices (converting USD to CAD)
    results = compare_prices(shopify_products, pokefin_products, exchange_rate, args.threshold)

    # Print report
    print_report(results, args.threshold, args.show_usd)

    # Export if requested
    if args.export:
        export_alerts(results, args.export, args.threshold)
        print(f"✓ Exported to: {args.export}")


if __name__ == "__main__":
    main()
