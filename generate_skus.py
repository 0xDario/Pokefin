"""
SKU Generation Script for Pokefin Products

Generates SKUs in the format: {GENERATION}-{SET_CODE}-{PRODUCT_TYPE}-{VARIANT}
Examples:
  - SV-SVI-BB           (Scarlet & Violet - Scarlet Violet Base - Booster Box)
  - SV-PRE-ETB-PC       (Scarlet & Violet - Prismatic Evolutions - ETB - Pokemon Center)
  - SV-BLK-BB-JP        (Scarlet & Violet - Black Bolt - Booster Box - Japanese)
  - SWSH-EVS-BB         (Sword & Shield - Evolving Skies - Booster Box)

Usage:
  python generate_skus.py              # Dry run - shows what would be updated
  python generate_skus.py --apply      # Actually update the database
  python generate_skus.py --export     # Export SKU mapping to CSV for Shopify
"""

import argparse
import csv
import logging
from datetime import datetime
from supabase import create_client
from secretsFile import SUPABASE_URL, SUPABASE_KEY

# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# === Generation Abbreviations ===
GENERATION_CODES = {
    "scarlet & violet": "SV",
    "scarlet and violet": "SV",
    "sword & shield": "SWSH",
    "sword and shield": "SWSH",
    "sun & moon": "SM",
    "sun and moon": "SM",
    "xy": "XY",
    "black & white": "BW",
    "black and white": "BW",
    "heartgold & soulsilver": "HGSS",
    "heartgold and soulsilver": "HGSS",
    "platinum": "PL",
    "diamond & pearl": "DP",
    "diamond and pearl": "DP",
    "ex": "EX",
    "e-card": "EC",
    "neo": "NEO",
    "classic": "CLS",
    "pokemon go": "PGO",
}

# === Product Type Abbreviations ===
PRODUCT_TYPE_CODES = {
    "booster_box": "BB",
    "booster_bundle": "BUN",
    "elite_trainer_box": "ETB",
    "ultra_premium_collection": "UPC",
    "premium_collection": "PC",
    "special_collection": "SC",
    "super_premium_collection": "SPC",
    "poster_collection": "PST",
    "tech_sticker_collection": "TSC",
    "collection": "COL",
    "build_and_battle_box": "BBB",
    "three_pack_blister": "3PB",
    "blister": "BLS",
    "mini_tin": "MTN",
    "tin": "TIN",
    "booster_pack": "BP",
}

# === Variant Abbreviations ===
VARIANT_CODES = {
    "pokemon center": "PC",
    "pokemon center exclusive": "PC",
    "costco": "CST",
    "costco exclusive": "CST",
    "walmart": "WMT",
    "walmart exclusive": "WMT",
    "target": "TGT",
    "target exclusive": "TGT",
    "gamestop": "GS",
    "gamestop exclusive": "GS",
    "japanese": "JP",
    "japan": "JP",
    "korean": "KR",
    "korea": "KR",
    "chinese": "CN",
    "china": "CN",
    "promo": "PRM",
    "special": "SPL",
    "exclusive": "EXC",
}


def get_generation_code(generation_name: str | None) -> str:
    """Convert generation name to abbreviation code."""
    if not generation_name:
        return "UNK"

    gen_lower = generation_name.lower().strip()

    # Check for exact matches first
    if gen_lower in GENERATION_CODES:
        return GENERATION_CODES[gen_lower]

    # Check for partial matches
    for key, code in GENERATION_CODES.items():
        if key in gen_lower or gen_lower in key:
            return code

    # If no match, create a short code from the name
    # Take first letter of each word, max 4 chars
    words = gen_lower.split()
    code = "".join(w[0].upper() for w in words[:4])
    return code if code else "UNK"


def get_variant_code(variant: str | None) -> str | None:
    """Convert variant text to abbreviation code."""
    if not variant:
        return None

    variant_lower = variant.lower().strip()

    # Check for exact matches first
    if variant_lower in VARIANT_CODES:
        return VARIANT_CODES[variant_lower]

    # Check for partial matches
    for key, code in VARIANT_CODES.items():
        if key in variant_lower:
            return code

    # If no match, create a short code from the variant
    # Take first 3 chars of each word, max 2 words
    words = variant_lower.split()[:2]
    code = "".join(w[:3].upper() for w in words)
    return code if code else None


def generate_sku(generation_name: str | None, set_code: str, product_type_name: str, variant: str | None) -> str:
    """Generate a SKU from generation, set code, product type, and variant."""
    # Get generation code
    gen_code = get_generation_code(generation_name)

    # Get product type code
    type_code = PRODUCT_TYPE_CODES.get(product_type_name, product_type_name[:3].upper())

    # Build SKU parts
    parts = [gen_code, set_code.upper(), type_code]

    # Add variant code if present
    variant_code = get_variant_code(variant)
    if variant_code:
        parts.append(variant_code)

    return "-".join(parts)


def fetch_all_products():
    """Fetch all products with their set, generation, and product type information."""
    logger.info("Fetching products from database...")

    try:
        response = supabase.table("products").select(
            "id, variant, sku, "
            "sets(id, code, name, generations(id, name)), "
            "product_types(id, name, label)"
        ).execute()
        return response.data
    except Exception as e:
        error_msg = str(e)
        if "402" in error_msg or "quota" in error_msg.lower():
            logger.error("Supabase storage quota exceeded. Please resolve at https://supabase.help")
            raise SystemExit("Database unavailable - storage quota exceeded")
        raise


def fetch_sets():
    """Fetch all sets for reference."""
    response = supabase.table("sets").select("id, code, name, generations(name)").execute()
    return {s["id"]: s for s in response.data}


def fetch_product_types():
    """Fetch all product types for reference."""
    response = supabase.table("product_types").select("id, name, label").execute()
    return {pt["id"]: pt for pt in response.data}


def generate_all_skus(products: list) -> list:
    """Generate SKUs for all products."""
    results = []
    sku_counts = {}  # Track duplicate SKUs

    for product in products:
        product_id = product["id"]
        current_sku = product.get("sku")
        variant = product.get("variant")

        # Get set info
        set_info = product.get("sets")
        if not set_info:
            logger.warning(f"Product {product_id} has no set - skipping")
            continue
        set_code = set_info.get("code", "UNK")
        set_name = set_info.get("name", "Unknown")

        # Get generation info (nested in sets)
        generation_info = set_info.get("generations")
        generation_name = generation_info.get("name") if generation_info else None

        # Get product type info
        type_info = product.get("product_types")
        if not type_info:
            logger.warning(f"Product {product_id} has no product type - skipping")
            continue
        type_name = type_info.get("name", "unknown")
        type_label = type_info.get("label", type_name)

        # Generate SKU
        new_sku = generate_sku(generation_name, set_code, type_name, variant)

        # Handle duplicates by adding a numeric suffix
        base_sku = new_sku
        if base_sku in sku_counts:
            sku_counts[base_sku] += 1
            new_sku = f"{base_sku}-{sku_counts[base_sku]}"
        else:
            sku_counts[base_sku] = 1

        results.append({
            "id": product_id,
            "current_sku": current_sku,
            "new_sku": new_sku,
            "generation": generation_name or "Unknown",
            "set_code": set_code,
            "set_name": set_name,
            "product_type": type_label,
            "variant": variant,
            "needs_update": current_sku != new_sku,
        })

    return results


def apply_skus(sku_results: list) -> tuple[int, int]:
    """Update products in database with new SKUs."""
    updated = 0
    errors = 0

    for result in sku_results:
        if not result["needs_update"]:
            continue

        try:
            supabase.table("products").update({
                "sku": result["new_sku"]
            }).eq("id", result["id"]).execute()

            updated += 1
            logger.info(f"Updated product {result['id']}: {result['new_sku']}")
        except Exception as e:
            errors += 1
            logger.error(f"Failed to update product {result['id']}: {e}")

    return updated, errors


def export_to_csv(sku_results: list, filename: str):
    """Export SKU mapping to CSV for Shopify import."""
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Product ID",
            "SKU",
            "Generation",
            "Set Code",
            "Set Name",
            "Product Type",
            "Variant",
            "Shopify Handle (suggested)"
        ])

        for result in sku_results:
            # Generate a Shopify-friendly handle
            handle_parts = ["pokemon-tcg"]
            handle_parts.append(result["set_name"].lower().replace(" ", "-").replace(":", ""))
            handle_parts.append(result["product_type"].lower().replace(" ", "-"))
            if result["variant"]:
                handle_parts.append(result["variant"].lower().replace(" ", "-"))
            shopify_handle = "-".join(handle_parts)

            writer.writerow([
                result["id"],
                result["new_sku"],
                result["generation"],
                result["set_code"],
                result["set_name"],
                result["product_type"],
                result["variant"] or "",
                shopify_handle
            ])

    logger.info(f"Exported {len(sku_results)} products to {filename}")


def print_summary(sku_results: list):
    """Print a summary of the SKU generation results."""
    total = len(sku_results)
    needs_update = sum(1 for r in sku_results if r["needs_update"])
    already_set = total - needs_update

    print("\n" + "=" * 70)
    print("SKU GENERATION SUMMARY")
    print("=" * 70)
    print(f"Total products:     {total}")
    print(f"Need SKU update:    {needs_update}")
    print(f"Already have SKU:   {already_set}")
    print("=" * 70)

    # Show sample of generated SKUs
    print("\nSample SKUs (first 20):")
    print("-" * 70)
    for result in sku_results[:20]:
        status = "NEW" if result["needs_update"] else "OK"
        variant_str = f" ({result['variant']})" if result["variant"] else ""
        print(f"  [{status}] {result['new_sku']:25} - {result['set_name']} {result['product_type']}{variant_str}")

    if total > 20:
        print(f"  ... and {total - 20} more")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Generate SKUs for Pokefin products",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually update the database (default is dry run)"
    )
    parser.add_argument(
        "--export",
        action="store_true",
        help="Export SKU mapping to CSV for Shopify"
    )
    parser.add_argument(
        "--output",
        default="sku_mapping.csv",
        help="Output filename for CSV export (default: sku_mapping.csv)"
    )

    args = parser.parse_args()

    # Fetch products
    products = fetch_all_products()
    logger.info(f"Fetched {len(products)} products")

    # Generate SKUs
    sku_results = generate_all_skus(products)

    # Print summary
    print_summary(sku_results)

    # Export to CSV if requested
    if args.export:
        export_to_csv(sku_results, args.output)
        print(f"Exported to: {args.output}")

    # Apply changes if requested
    if args.apply:
        print("Applying SKU updates to database...")
        updated, errors = apply_skus(sku_results)
        print(f"Updated: {updated}, Errors: {errors}")
    else:
        print("DRY RUN - No changes made. Use --apply to update the database.")
        print("Use --export to generate a CSV for Shopify import.")


if __name__ == "__main__":
    main()
