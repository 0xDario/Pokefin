"""
Update Shopify Product Export with SKUs from Pokefin

This script matches products between your Shopify export (products_export.csv)
and the Pokefin SKU mapping (sku_mapping.csv), then outputs an updated CSV
ready for Shopify import.

Usage:
  python update_shopify_skus.py                    # Preview matches
  python update_shopify_skus.py --apply            # Generate updated CSV
  python update_shopify_skus.py --apply --output updated_products.csv
"""

import argparse
import csv
import re
import logging
from difflib import SequenceMatcher

# === Logging Setup ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# === Product Type Keywords ===
PRODUCT_TYPE_PATTERNS = [
    ("Elite Trainer Box", ["elite trainer box", "etb"]),
    ("Booster Box", ["booster box"]),
    ("Booster Bundle", ["booster bundle"]),
    ("Booster Pack", ["booster pack", "3 booster pack", "3-pack blister"]),
    ("Ultra Premium Collection", ["ultra premium collection", "upc"]),
    ("Premium Collection", ["premium collection"]),
    ("Pokemon Center Exclusive Elite Trainer Box", ["pokemon center", "pokémon center"]),
    ("Build & Battle Box", ["build & battle", "build and battle"]),
    ("Collection", ["collection", "box"]),
    ("Tin", ["tin"]),
    ("Blister", ["blister"]),
]


def normalize_text(text: str) -> str:
    """Normalize text for matching."""
    return re.sub(r'[^a-z0-9\s]', '', text.lower()).strip()


def extract_set_name(title: str, tags: str) -> str | None:
    """Extract set name from Shopify title or tags."""
    # Common patterns in titles like "Scarlet & Violet - Destined Rivals Booster Box"
    # or "Japanese - Scarlet & Violet – Black Bolt Booster Box"

    # Remove common prefixes
    title_clean = re.sub(r'^(Japanese|Korean|Chinese)\s*[-–—]\s*', '', title, flags=re.IGNORECASE)

    # Try to extract set name (usually before product type)
    for product_type, _ in PRODUCT_TYPE_PATTERNS:
        pattern = rf'(.+?)\s*[-–—]?\s*{re.escape(product_type)}'
        match = re.search(pattern, title_clean, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    # Try from tags
    if tags:
        tag_list = [t.strip() for t in tags.split(',')]
        # Look for set-like tags (not generic ones)
        skip_tags = {'sealed product', 'pokémon', 'pokemon', 'booster box', 'etb',
                     'booster pack', 'booster bundle', 'pokémon japan', 'pokemon japan'}
        for tag in tag_list:
            if tag.lower() not in skip_tags and len(tag) > 3:
                return tag

    return None


def detect_product_type(title: str, tags: str) -> str | None:
    """Detect product type from title or tags."""
    combined = f"{title} {tags}".lower()

    # Check for Pokemon Center first (variant)
    is_pokemon_center = 'pokemon center' in combined or 'pokémon center' in combined

    for product_type, keywords in PRODUCT_TYPE_PATTERNS:
        for keyword in keywords:
            if keyword in combined:
                if is_pokemon_center and 'elite trainer box' in product_type.lower():
                    return "Pokemon Center Exclusive Elite Trainer Box"
                return product_type

    return None


def detect_variant(title: str, tags: str) -> str | None:
    """Detect variant from title or tags."""
    combined = f"{title} {tags}".lower()

    if 'japanese' in combined or 'japan' in combined:
        return "Japanese"
    if 'pokemon center' in combined or 'pokémon center' in combined:
        return "Pokemon Center"
    if 'korean' in combined or 'korea' in combined:
        return "Korean"

    return None


def similarity_score(s1: str, s2: str) -> float:
    """Calculate similarity between two strings."""
    return SequenceMatcher(None, normalize_text(s1), normalize_text(s2)).ratio()


def load_sku_mapping(filepath: str) -> list[dict]:
    """Load SKU mapping from CSV."""
    mapping = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            mapping.append({
                'product_id': row['Product ID'],
                'sku': row['SKU'],
                'generation': row['Generation'],
                'set_code': row['Set Code'],
                'set_name': row['Set Name'],
                'product_type': row['Product Type'],
                'variant': row.get('Variant', ''),
                'shopify_handle': row.get('Shopify Handle (suggested)', ''),
            })
    return mapping


def load_shopify_export(filepath: str) -> tuple[list[str], list[list[str]]]:
    """Load Shopify export CSV."""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    return header, rows


def find_best_match(shopify_product: dict, sku_mapping: list[dict]) -> dict | None:
    """Find the best matching SKU for a Shopify product."""
    title = shopify_product['title']
    tags = shopify_product['tags']
    handle = shopify_product['handle']

    # Extract info from Shopify product
    detected_set = extract_set_name(title, tags)
    detected_type = detect_product_type(title, tags)
    detected_variant = detect_variant(title, tags)

    best_match = None
    best_score = 0

    for sku_entry in sku_mapping:
        score = 0

        # Match by set name
        if detected_set and sku_entry['set_name']:
            set_sim = similarity_score(detected_set, sku_entry['set_name'])
            score += set_sim * 50  # Weight: 50%

        # Match by product type
        if detected_type and sku_entry['product_type']:
            type_sim = similarity_score(detected_type, sku_entry['product_type'])
            score += type_sim * 30  # Weight: 30%

        # Match by variant
        if detected_variant and sku_entry['variant']:
            if normalize_text(detected_variant) in normalize_text(sku_entry['variant']):
                score += 15  # Weight: 15%
        elif not detected_variant and not sku_entry['variant']:
            score += 10  # Bonus for both having no variant

        # Match by handle similarity
        if handle and sku_entry['shopify_handle']:
            handle_sim = similarity_score(handle, sku_entry['shopify_handle'])
            score += handle_sim * 5  # Weight: 5%

        if score > best_score:
            best_score = score
            best_match = {
                **sku_entry,
                'match_score': score,
                'detected_set': detected_set,
                'detected_type': detected_type,
                'detected_variant': detected_variant,
            }

    # Only return if score is above threshold
    if best_score >= 40:
        return best_match
    return None


def process_shopify_export(shopify_path: str, sku_mapping_path: str) -> tuple[list, list, list]:
    """Process Shopify export and match with SKU mapping."""
    # Load data
    sku_mapping = load_sku_mapping(sku_mapping_path)
    header, rows = load_shopify_export(shopify_path)

    # Find column indices
    handle_idx = header.index('Handle')
    title_idx = header.index('Title')
    tags_idx = header.index('Tags')
    sku_idx = header.index('Variant SKU')

    matched = []
    unmatched = []
    updated_rows = [header]  # Start with header

    current_handle = None
    current_match = None

    for row in rows:
        handle = row[handle_idx]
        title = row[title_idx]
        tags = row[tags_idx] if tags_idx < len(row) else ''

        # New product (has title) or continuation (same handle, no title)
        if title:  # Main product row
            current_handle = handle
            shopify_product = {
                'handle': handle,
                'title': title,
                'tags': tags,
                'current_sku': row[sku_idx] if sku_idx < len(row) else '',
            }
            current_match = find_best_match(shopify_product, sku_mapping)

            if current_match:
                matched.append({
                    'shopify': shopify_product,
                    'match': current_match,
                })
                # Update SKU in row
                new_row = row.copy()
                if len(new_row) > sku_idx:
                    new_row[sku_idx] = current_match['sku']
                updated_rows.append(new_row)
            else:
                unmatched.append(shopify_product)
                updated_rows.append(row)
        else:
            # Image/variant row - apply same SKU as parent product
            new_row = row.copy()
            if current_match and handle == current_handle:
                if len(new_row) > sku_idx and new_row[sku_idx]:
                    new_row[sku_idx] = current_match['sku']
            updated_rows.append(new_row)

    return matched, unmatched, updated_rows


def print_summary(matched: list, unmatched: list):
    """Print matching summary."""
    print("\n" + "=" * 80)
    print("SHOPIFY SKU MATCHING SUMMARY")
    print("=" * 80)
    print(f"Total matched:    {len(matched)}")
    print(f"Total unmatched:  {len(unmatched)}")
    print("=" * 80)

    if matched:
        print("\n✓ MATCHED PRODUCTS:")
        print("-" * 80)
        for m in matched[:15]:
            shop = m['shopify']
            match = m['match']
            old_sku = shop['current_sku'] or '(none)'
            print(f"  {shop['title'][:45]:45}")
            print(f"    Old SKU: {old_sku:20} → New SKU: {match['sku']}")
            print(f"    Match: {match['set_name']} {match['product_type']} (score: {match['match_score']:.1f})")
            print()

        if len(matched) > 15:
            print(f"  ... and {len(matched) - 15} more matched products")

    if unmatched:
        print("\n✗ UNMATCHED PRODUCTS:")
        print("-" * 80)
        for u in unmatched[:10]:
            print(f"  {u['title'][:60]}")
            print(f"    Handle: {u['handle'][:50]}")
            print()

        if len(unmatched) > 10:
            print(f"  ... and {len(unmatched) - 10} more unmatched products")

    print()


def save_updated_csv(rows: list, output_path: str):
    """Save updated CSV."""
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    logger.info(f"Saved updated CSV to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Update Shopify export with Pokefin SKUs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "--shopify",
        default="products_export.csv",
        help="Path to Shopify products export CSV (default: products_export.csv)"
    )
    parser.add_argument(
        "--mapping",
        default="sku_mapping.csv",
        help="Path to SKU mapping CSV (default: sku_mapping.csv)"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Generate updated CSV file"
    )
    parser.add_argument(
        "--output",
        default="products_import.csv",
        help="Output filename for updated CSV (default: products_import.csv)"
    )

    args = parser.parse_args()

    logger.info(f"Loading Shopify export: {args.shopify}")
    logger.info(f"Loading SKU mapping: {args.mapping}")

    matched, unmatched, updated_rows = process_shopify_export(args.shopify, args.mapping)

    print_summary(matched, unmatched)

    if args.apply:
        save_updated_csv(updated_rows, args.output)
        print(f"✓ Updated CSV saved to: {args.output}")
        print(f"  Upload this file to Shopify to update your product SKUs.")
    else:
        print("DRY RUN - No file generated. Use --apply to create the updated CSV.")


if __name__ == "__main__":
    main()
