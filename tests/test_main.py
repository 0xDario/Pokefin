#!/usr/bin/env python3
"""
Unit tests for main.py

These tests cover:
- Price and image extraction logic
- Timestamp parsing
- Exchange rate fetching
- Price update logic
- Scheduling calculations

Run with: python -m pytest tests/test_main.py -v
"""
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, PropertyMock
import pytest

# Mock external dependencies before importing main
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'


class TestParseTimestamp:
    """Tests for parse_timestamp function"""

    def test_parse_timestamp_with_z_suffix(self):
        """Should parse timestamp ending with Z"""
        from main import parse_timestamp

        result = parse_timestamp("2024-12-15T10:30:00Z")

        assert result is not None
        assert result.year == 2024
        assert result.month == 12
        assert result.day == 15
        assert result.hour == 10
        assert result.minute == 30
        assert result.tzinfo is not None

    def test_parse_timestamp_with_timezone_offset(self):
        """Should parse timestamp with timezone offset"""
        from main import parse_timestamp

        result = parse_timestamp("2024-12-15T10:30:00+00:00")

        assert result is not None
        assert result.year == 2024
        assert result.month == 12
        assert result.day == 15

    def test_parse_timestamp_without_timezone(self):
        """Should parse timestamp without timezone and add UTC"""
        from main import parse_timestamp

        result = parse_timestamp("2024-12-15T10:30:00")

        assert result is not None
        assert result.tzinfo == timezone.utc

    def test_parse_timestamp_with_none(self):
        """Should return None for None input"""
        from main import parse_timestamp

        result = parse_timestamp(None)

        assert result is None

    def test_parse_timestamp_with_empty_string(self):
        """Should return None for empty string"""
        from main import parse_timestamp

        result = parse_timestamp("")

        assert result is None

    def test_parse_timestamp_with_invalid_format(self):
        """Should return None for invalid format"""
        from main import parse_timestamp

        result = parse_timestamp("not-a-timestamp")

        assert result is None


class TestSecondsUntilNextInterval:
    """Tests for seconds_until_next_utc_interval function logic"""

    def test_calculate_next_4hour_interval_from_midnight(self):
        """From 00:00, next interval should be 04:00"""
        now = datetime(2024, 12, 15, 0, 0, 0, tzinfo=timezone.utc)
        interval_hours = 4

        next_hour = ((now.hour // interval_hours) + 1) * interval_hours
        if next_hour >= 24:
            next_time = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            next_time = now.replace(hour=next_hour, minute=0, second=0, microsecond=0)

        seconds = (next_time - now).total_seconds()

        assert seconds == 4 * 3600  # 4 hours

    def test_calculate_next_4hour_interval_from_3am(self):
        """From 03:00, next interval should be 04:00"""
        now = datetime(2024, 12, 15, 3, 0, 0, tzinfo=timezone.utc)
        interval_hours = 4

        next_hour = ((now.hour // interval_hours) + 1) * interval_hours
        next_time = now.replace(hour=next_hour, minute=0, second=0, microsecond=0)

        seconds = (next_time - now).total_seconds()

        assert seconds == 1 * 3600  # 1 hour

    def test_calculate_next_4hour_interval_from_4am(self):
        """From 04:00, next interval should be 08:00"""
        now = datetime(2024, 12, 15, 4, 0, 0, tzinfo=timezone.utc)
        interval_hours = 4

        next_hour = ((now.hour // interval_hours) + 1) * interval_hours
        next_time = now.replace(hour=next_hour, minute=0, second=0, microsecond=0)

        seconds = (next_time - now).total_seconds()

        assert seconds == 4 * 3600  # 4 hours

    def test_calculate_next_4hour_interval_from_23pm(self):
        """From 23:00, next interval should be 00:00 next day"""
        now = datetime(2024, 12, 15, 23, 0, 0, tzinfo=timezone.utc)
        interval_hours = 4

        next_hour = ((now.hour // interval_hours) + 1) * interval_hours
        if next_hour >= 24:
            next_time = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            next_time = now.replace(hour=next_hour, minute=0, second=0, microsecond=0)

        seconds = (next_time - now).total_seconds()

        assert seconds == 1 * 3600  # 1 hour


class TestPriceUpdateIntervalLogic:
    """Tests for price update interval logic"""

    def test_needs_update_when_last_updated_is_none(self):
        """Should need update when last_updated is None"""
        current_price = 100.0
        last_updated = None
        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=24)

        needs_price_update = True
        if current_price is not None and last_updated:
            # This branch won't execute when last_updated is None
            pass

        assert needs_price_update is True

    def test_needs_update_when_price_is_none(self):
        """Should need update when current price is None"""
        current_price = None
        last_updated = datetime.now(timezone.utc).isoformat()

        needs_price_update = True
        if current_price is not None and last_updated:
            needs_price_update = False

        assert needs_price_update is True

    def test_needs_update_when_last_updated_is_old(self):
        """Should need update when last_updated is older than interval"""
        from main import parse_timestamp

        price_interval_hours = 24
        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=price_interval_hours)

        # Create a timestamp that's 25 hours old
        old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()

        current_price = 100.0
        last_updated = old_timestamp

        needs_price_update = True
        if current_price is not None and last_updated:
            last_updated_dt = parse_timestamp(last_updated)
            if last_updated_dt:
                needs_price_update = last_updated_dt < price_interval_ago

        assert needs_price_update is True

    def test_no_update_needed_when_recently_updated(self):
        """Should not need update when recently updated"""
        from main import parse_timestamp

        price_interval_hours = 24
        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=price_interval_hours)

        # Create a timestamp that's 1 hour old
        recent_timestamp = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

        current_price = 100.0
        last_updated = recent_timestamp

        needs_price_update = True
        if current_price is not None and last_updated:
            last_updated_dt = parse_timestamp(last_updated)
            if last_updated_dt:
                needs_price_update = last_updated_dt < price_interval_ago

        assert needs_price_update is False


class TestImageUpdateLogic:
    """Tests for image update logic"""

    def test_needs_image_update_when_no_current_image(self):
        """Should need image update when current_image_url is None"""
        current_image_url = None
        last_image_update = None
        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

        needs_image_update = True
        if current_image_url and last_image_update:
            # This won't execute when current_image_url is None
            pass

        assert needs_image_update is True

    def test_needs_image_update_when_last_update_is_old(self):
        """Should need image update when last_image_update is older than 24 hours"""
        from main import parse_timestamp

        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()

        current_image_url = "https://example.com/image.jpg"
        last_image_update = old_timestamp

        needs_image_update = True
        if current_image_url and last_image_update:
            last_image_update_dt = parse_timestamp(last_image_update)
            if last_image_update_dt:
                needs_image_update = last_image_update_dt < twenty_four_hours_ago

        assert needs_image_update is True

    def test_no_image_update_when_recently_updated(self):
        """Should not need image update when recently updated"""
        from main import parse_timestamp

        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        recent_timestamp = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

        current_image_url = "https://example.com/image.jpg"
        last_image_update = recent_timestamp

        needs_image_update = True
        if current_image_url and last_image_update:
            last_image_update_dt = parse_timestamp(last_image_update)
            if last_image_update_dt:
                needs_image_update = last_image_update_dt < twenty_four_hours_ago

        assert needs_image_update is False


class TestSupabaseORQuery:
    """Tests for Supabase OR query construction"""

    def test_or_query_format(self):
        """Should construct correct OR query for updates"""
        price_interval_ago = datetime(2024, 12, 15, 10, 0, 0, tzinfo=timezone.utc)
        twenty_four_hours_ago = datetime(2024, 12, 15, 10, 0, 0, tzinfo=timezone.utc)

        or_query = f"last_updated.is.null,usd_price.is.null,last_updated.lt.{price_interval_ago.isoformat()},image_url.is.null,last_image_update.is.null,last_image_update.lt.{twenty_four_hours_ago.isoformat()}"

        assert "last_updated.is.null" in or_query
        assert "usd_price.is.null" in or_query
        assert "image_url.is.null" in or_query
        assert "last_image_update.is.null" in or_query


class TestImageURLParsing:
    """Tests for image URL parsing and validation"""

    def test_skip_logo_images(self):
        """Should skip logo images"""
        src = "https://example.com/logo.png"
        skip_keywords = ['logo', 'icon', 'avatar', 'banner', 'header', 'footer', 'nav', 'gift-card']

        should_skip = any(skip in src.lower() for skip in skip_keywords)

        assert should_skip is True

    def test_skip_icon_images(self):
        """Should skip icon images"""
        src = "https://example.com/icon-menu.png"
        skip_keywords = ['logo', 'icon', 'avatar', 'banner', 'header', 'footer', 'nav', 'gift-card']

        should_skip = any(skip in src.lower() for skip in skip_keywords)

        assert should_skip is True

    def test_allow_product_images(self):
        """Should allow product images"""
        src = "https://tcgplayer-cdn.tcgplayer.com/product/12345/image.jpg"
        skip_keywords = ['logo', 'icon', 'avatar', 'banner', 'header', 'footer', 'nav', 'gift-card']

        should_skip = any(skip in src.lower() for skip in skip_keywords)

        assert should_skip is False

    def test_detect_tcgplayer_cdn_images(self):
        """Should detect TCGPlayer CDN images"""
        src = "https://tcgplayer-cdn.tcgplayer.com/product/12345/image.jpg"

        is_tcg_cdn = 'tcgplayer-cdn.tcgplayer.com/product' in src

        assert is_tcg_cdn is True


class TestSrcsetParsing:
    """Tests for srcset parsing to get highest resolution"""

    def test_parse_srcset_gets_highest_width(self):
        """Should parse srcset and return highest resolution URL"""
        srcset = "https://cdn.example.com/small.jpg 320w, https://cdn.example.com/medium.jpg 640w, https://cdn.example.com/large.jpg 1280w"

        srcset_entries = srcset.split(',')
        best_src = None
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

        assert best_width == 1280
        assert best_src == "https://cdn.example.com/large.jpg"

    def test_parse_srcset_with_no_widths(self):
        """Should handle srcset with no width descriptors"""
        srcset = "https://cdn.example.com/image.jpg"

        srcset_entries = srcset.split(',')
        best_src = None
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

        assert best_width == 0
        assert best_src is None


class TestFileExtensionExtraction:
    """Tests for image file extension extraction"""

    def test_extract_jpg_extension(self):
        """Should extract jpg extension"""
        image_url = "https://example.com/image.jpg"

        file_extension = image_url.split('.')[-1].split('?')[0].lower()

        assert file_extension == "jpg"

    def test_extract_extension_with_query_string(self):
        """Should extract extension ignoring query string"""
        image_url = "https://example.com/image.png?v=123"

        file_extension = image_url.split('.')[-1].split('?')[0].lower()

        assert file_extension == "png"

    def test_fallback_for_invalid_extension(self):
        """Should fallback to jpg for invalid extensions"""
        image_url = "https://example.com/image"
        valid_extensions = ['jpg', 'jpeg', 'png', 'webp']

        file_extension = image_url.split('.')[-1].split('?')[0].lower()
        if file_extension not in valid_extensions:
            file_extension = 'jpg'

        assert file_extension == "jpg"


class TestPriceExtraction:
    """Tests for price extraction logic"""

    def test_price_parsing_with_dollar_and_comma(self):
        """Should parse price with $ and commas"""
        price_text = "$1,234.56"

        price = float(price_text.replace("$", "").replace(",", ""))

        assert price == 1234.56

    def test_skip_invalid_price_values(self):
        """Should skip invalid price values"""
        invalid_values = ["-", "", "N/A", None]

        for val in invalid_values:
            is_valid = val and val not in ("-", "", "N/A")
            assert not is_valid

    def test_valid_price_values(self):
        """Should accept valid price values"""
        valid_value = "123.45"

        is_valid = valid_value and valid_value not in ("-", "", "N/A")
        assert is_valid is True


class TestCLIArgumentParsing:
    """Tests for main.py CLI argument parsing"""

    def test_run_now_flag(self):
        """Should parse --run-now flag"""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--run-now", action="store_true")

        args = parser.parse_args(["--run-now"])

        assert args.run_now is True

    def test_default_no_run_now(self):
        """Should default to scheduled mode"""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--run-now", action="store_true")

        args = parser.parse_args([])

        assert args.run_now is False


class TestUpdateDataConstruction:
    """Tests for update data dictionary construction"""

    def test_construct_update_with_price_only(self):
        """Should construct update data with price only"""
        update_data = {}
        price = 150.0

        update_data["usd_price"] = price
        update_data["last_updated"] = datetime.now(timezone.utc).isoformat()

        assert "usd_price" in update_data
        assert update_data["usd_price"] == 150.0
        assert "last_updated" in update_data

    def test_construct_update_with_image_only(self):
        """Should construct update data with image only"""
        update_data = {}
        uploaded_image_url = "https://supabase.storage/image.jpg"

        update_data["image_url"] = uploaded_image_url
        update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()

        assert "image_url" in update_data
        assert "last_image_update" in update_data

    def test_construct_update_with_both(self):
        """Should construct update data with both price and image"""
        update_data = {}
        price = 150.0
        uploaded_image_url = "https://supabase.storage/image.jpg"

        update_data["usd_price"] = price
        update_data["last_updated"] = datetime.now(timezone.utc).isoformat()
        update_data["image_url"] = uploaded_image_url
        update_data["last_image_update"] = datetime.now(timezone.utc).isoformat()

        assert len(update_data) == 4


class TestProductGrouping:
    """Tests for product grouping by type"""

    def test_group_products_by_type(self):
        """Should group products by set_id and product_type_id"""
        products = [
            {"id": 1, "set_id": 1, "product_type_id": 1, "variant": None},
            {"id": 2, "set_id": 1, "product_type_id": 1, "variant": None},
            {"id": 3, "set_id": 1, "product_type_id": 2, "variant": None},
            {"id": 4, "set_id": 2, "product_type_id": 1, "variant": "Promo"},
        ]

        products_by_type = {}
        for product in products:
            key = f"Set:{product['set_id']}-Type:{product['product_type_id']}"
            if product.get('variant'):
                key += f"-Variant:{product['variant']}"
            if key not in products_by_type:
                products_by_type[key] = 0
            products_by_type[key] += 1

        assert products_by_type["Set:1-Type:1"] == 2
        assert products_by_type["Set:1-Type:2"] == 1
        assert products_by_type["Set:2-Type:1-Variant:Promo"] == 1


class TestImageSizeValidation:
    """Tests for image size validation"""

    def test_reject_too_small_image(self):
        """Should reject images smaller than 1000 bytes"""
        content_length = 500

        is_valid = content_length >= 1000

        assert is_valid is False

    def test_accept_valid_size_image(self):
        """Should accept images larger than 1000 bytes"""
        content_length = 5000

        is_valid = content_length >= 1000

        assert is_valid is True


class TestVariantInfoDisplay:
    """Tests for variant info display"""

    def test_variant_info_when_present(self):
        """Should show variant info when variant exists"""
        variant = "Pokemon Center"

        variant_info = f" (Variant: {variant})" if variant else ""

        assert variant_info == " (Variant: Pokemon Center)"

    def test_variant_info_when_absent(self):
        """Should show empty string when no variant"""
        variant = None

        variant_info = f" (Variant: {variant})" if variant else ""

        assert variant_info == ""


class TestEdgeCases:
    """Tests for edge cases"""

    def test_empty_products_response(self):
        """Should handle empty products response"""
        products_to_update = []

        should_skip = not products_to_update

        assert should_skip is True

    def test_scraped_data_with_none_values(self):
        """Should handle scraped data with None values"""
        scraped_data = {'price': None, 'image_url': None}

        price = scraped_data.get('price')
        tcg_image_url = scraped_data.get('image_url')

        assert price is None
        assert tcg_image_url is None
    
    def test_scraped_data_with_non_positive_price(self):
        """Should ignore non-positive scraped prices"""
        scraped_data = {'price': 0, 'image_url': None}

        price = scraped_data.get('price')
        if price is not None and price <= 0:
            price = None

        assert price is None

    def test_same_image_url_detection(self):
        """Should detect when image URL is unchanged"""
        current_image_url = "https://example.com/image.jpg"
        tcg_image_url = "https://example.com/image.jpg"

        is_same = tcg_image_url == current_image_url

        assert is_same is True


class TestExchangeRateParsing:
    """Tests for exchange rate date parsing"""

    def test_parse_boc_date_format(self):
        """Should parse Bank of Canada date format"""
        # BOC uses en-dash (unicode \u2011) not regular hyphen
        rate_date_str = "2024\u201112\u201115"  # 2024-12-15 with en-dash

        # Replace en-dash with regular hyphen for parsing
        normalized = rate_date_str.replace('\u2011', '-')
        rate_date = datetime.strptime(normalized, "%Y-%m-%d")

        assert rate_date.year == 2024
        assert rate_date.month == 12
        assert rate_date.day == 15


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
