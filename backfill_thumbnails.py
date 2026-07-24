#!/usr/bin/env python3
"""
One-time backfill of product-image thumbnails.

The scraper generates a small WebP derivative alongside each product image
(see upload_thumbnail in main.py), but products imaged before that shipped
have only the full-size original. List views download whatever exists, so
until every product has a derivative the market table still streams ~91 KB
JPEGs into 56px boxes.

This downloads each product's stored image once, resizes it, and uploads
products/{id}_thumb.webp next to it. Idempotent: re-running simply overwrites
the derivatives (upsert), so an interrupted run can be restarted freely.

The frontend falls back to the full-size image whenever a derivative is
missing, so this is purely a bandwidth optimisation — nothing breaks if it
is never run, and nothing breaks halfway through.

Usage:
  python backfill_thumbnails.py              # all products with an image
  python backfill_thumbnails.py --limit 5    # smoke-test a handful first
  python backfill_thumbnails.py --force      # rebuild even if one exists
  python backfill_thumbnails.py --debug
"""
import argparse
import logging
import sys
import time

import requests
from supabase import create_client

from secrets_loader import load_supabase_credentials

SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

BUCKET = "product-images"
REQUEST_TIMEOUT = 30


def fetch_products_with_images(batch_size=500):
    """All active products that have a stored image, ordered by id."""
    all_products = []
    offset = 0
    while True:
        response = (
            supabase.table("products")
            .select("id, image_url")
            .not_.is_("image_url", "null")
            .order("id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        if not response.data:
            break
        all_products.extend(response.data)
        if len(response.data) < batch_size:
            break
        offset += batch_size
    return all_products


def thumbnail_exists(product_id) -> bool:
    """True when a derivative is already stored for this product."""
    from main import thumbnail_object_path

    path = thumbnail_object_path(product_id)
    prefix, _, name = path.rpartition("/")
    try:
        listing = supabase.storage.from_(BUCKET).list(prefix)
        return any(item.get("name") == name for item in (listing or []))
    except Exception as e:
        logger.debug(f"Could not list {prefix} for product {product_id}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Backfill WebP thumbnails for existing product images",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python backfill_thumbnails.py --limit 5    # verify output before the full run
  python backfill_thumbnails.py              # backfill everything
        """,
    )
    parser.add_argument("--limit", type=int, help="Only process the first N products")
    parser.add_argument("--force", action="store_true",
                        help="Rebuild thumbnails that already exist")
    parser.add_argument("--debug", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    if args.debug:
        logger.setLevel(logging.DEBUG)

    try:
        from main import build_thumbnail, upload_thumbnail  # noqa: F401
    except ImportError as e:
        logger.error(f"Could not import thumbnail helpers from main.py: {e}")
        return 1

    if build_thumbnail(b"") is None:
        # Distinguish "Pillow missing" from "that was not an image".
        try:
            import PIL  # noqa: F401
        except ImportError:
            logger.error(
                "Pillow is not installed in this environment. "
                "Run: pip install -r requirements.txt"
            )
            return 1

    products = fetch_products_with_images()
    if args.limit:
        products = products[: args.limit]
    logger.info(f"Found {len(products)} products with images")

    session = requests.Session()
    built = skipped = failed = 0
    saved_bytes = 0

    try:
        for idx, product in enumerate(products, start=1):
            product_id = product["id"]
            image_url = product.get("image_url")
            logger.info(f"[{idx}/{len(products)}] Product {product_id}...")

            if not image_url:
                skipped += 1
                continue

            if not args.force and thumbnail_exists(product_id):
                logger.debug("   Thumbnail already present, skipping")
                skipped += 1
                continue

            try:
                response = session.get(image_url, timeout=REQUEST_TIMEOUT)
                if response.status_code != 200:
                    logger.warning(f"   Image fetch returned {response.status_code}")
                    failed += 1
                    continue
                original = response.content
            except Exception as e:
                logger.warning(f"   Image fetch failed: {e}")
                failed += 1
                continue

            thumb = build_thumbnail(original)
            if not thumb:
                logger.warning("   Could not build a thumbnail from this image")
                failed += 1
                continue

            if upload_thumbnail(product_id, original):
                built += 1
                saved_bytes += max(0, len(original) - len(thumb))
                logger.info(
                    f"   {len(original) / 1024:.0f} KB -> {len(thumb) / 1024:.0f} KB"
                )
            else:
                logger.warning("   Thumbnail upload failed")
                failed += 1

            time.sleep(0.1)  # be gentle with storage
    except KeyboardInterrupt:
        logger.info("\nInterrupted. Re-run to continue (already-built thumbs are skipped).")
    finally:
        session.close()

    logger.info("=" * 60)
    logger.info("Thumbnail backfill complete!")
    logger.info(f"  Built:   {built}")
    logger.info(f"  Skipped: {skipped}")
    logger.info(f"  Failed:  {failed}")
    logger.info(f"  Approx. bytes saved per full page scroll: {saved_bytes / 1024 / 1024:.1f} MB")
    logger.info("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
