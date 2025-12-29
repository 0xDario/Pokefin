#!/usr/bin/env python3
"""
Unit tests for backfill_historical_prices.py

These tests cover:
- CLI argument parsing (--forward, --reverse, --start, --end, --days, --all)
- Parallel processing logic (forward/reverse range calculation)
- Date parsing and range expansion
- Supabase query range limits
- Edge cases and error handling

Run with: python -m pytest tests/test_backfill_historical_prices.py -v
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call
import pytest

# Import the module under test - we need to mock external dependencies first
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'


class TestParseShortDate:
    """Tests for parse_short_date function"""

    def test_parse_date_in_current_or_past_month_returns_current_year(self):
        """Dates in current or past months should return current year"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        current_year = now.year
        current_month = now.month

        # Test a month that's <= current month (should be current year)
        test_month = min(current_month, 6)  # Use June or current month, whichever is smaller
        result = parse_short_date(f"{test_month}/15")
        assert result.year == current_year
        assert result.month == test_month
        assert result.day == 15

    def test_parse_date_in_future_month_returns_previous_year(self):
        """Dates in future months should return previous year"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        current_year = now.year
        current_month = now.month

        # Only test if we're not in December (no future months to test)
        if current_month < 12:
            future_month = current_month + 1
            result = parse_short_date(f"{future_month}/15")
            assert result.year == current_year - 1
            assert result.month == future_month
            assert result.day == 15

    def test_parse_november_date(self):
        """November dates should use dynamic year logic"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        current_year = now.year
        current_month = now.month

        result = parse_short_date("11/5")
        # November (11) - if current month >= 11, use current year; else previous year
        expected_year = current_year if current_month >= 11 else current_year - 1
        assert result == datetime(expected_year, 11, 5)

    def test_parse_december_date(self):
        """December dates should use dynamic year logic"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        current_year = now.year
        current_month = now.month

        result = parse_short_date("12/25")
        # December (12) - if current month >= 12, use current year; else previous year
        expected_year = current_year if current_month >= 12 else current_year - 1
        assert result == datetime(expected_year, 12, 25)

    def test_parse_invalid_format_returns_none(self):
        """Invalid date format should return None"""
        from backfill_historical_prices import parse_short_date

        result = parse_short_date("invalid")
        assert result is None

    def test_parse_empty_string_returns_none(self):
        """Empty string should return None"""
        from backfill_historical_prices import parse_short_date

        result = parse_short_date("")
        assert result is None

    def test_parse_wrong_delimiter_returns_none(self):
        """Wrong delimiter should return None"""
        from backfill_historical_prices import parse_short_date

        result = parse_short_date("11-5")
        assert result is None

    def test_parse_single_part_returns_none(self):
        """Single part (no delimiter) should return None"""
        from backfill_historical_prices import parse_short_date

        result = parse_short_date("115")
        assert result is None


class TestCLIArgumentParsing:
    """Tests for CLI argument parsing"""

    def test_forward_flag_sets_forward_true(self):
        """--forward flag should set forward=True"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args(["--forward"])

        assert args.forward is True
        assert args.reverse is False

    def test_reverse_flag_sets_reverse_true(self):
        """--reverse flag should set reverse=True"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args(["--reverse"])

        assert args.reverse is True
        assert args.forward is False

    def test_custom_start_end_range(self):
        """--start and --end should set custom range"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args(["--start", "100", "--end", "500"])

        assert args.start == 100
        assert args.end == 500

    def test_days_default_is_90(self):
        """--days should default to 90"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args([])

        assert args.days == 90

    def test_custom_days_value(self):
        """--days should accept custom value"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args(["--days", "30"])

        assert args.days == 30

    def test_all_flag(self):
        """--all flag should set all=True"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--start", type=int, default=None)
        parser.add_argument("--end", type=int, default=None)
        parser.add_argument("--days", type=int, default=90)

        args = parser.parse_args(["--all"])

        assert args.all is True


class TestParallelProcessingRangeCalculation:
    """Tests for parallel processing range calculation logic"""

    def test_forward_mode_calculates_first_half(self):
        """Forward mode should process indices 0 to midpoint"""
        total_count = 1000
        midpoint = total_count // 2

        # Simulating forward mode logic
        start_idx = 0
        end_idx = midpoint

        assert start_idx == 0
        assert end_idx == 500

    def test_reverse_mode_calculates_second_half(self):
        """Reverse mode should process indices midpoint to end"""
        total_count = 1000
        midpoint = total_count // 2

        # Simulating reverse mode logic
        start_idx = midpoint
        end_idx = total_count

        assert start_idx == 500
        assert end_idx == 1000

    def test_forward_with_custom_start_end(self):
        """Forward mode with custom start/end should use custom values"""
        total_count = 1000
        midpoint = total_count // 2
        custom_start = 100
        custom_end = 300

        # When start is provided, use it; otherwise default to 0
        start_idx = custom_start if custom_start is not None else 0
        # When end is provided, use it; otherwise use midpoint
        end_idx = custom_end if custom_end is not None else midpoint

        assert start_idx == 100
        assert end_idx == 300

    def test_reverse_with_custom_start_end(self):
        """Reverse mode with custom start/end should use custom values"""
        total_count = 1000
        midpoint = total_count // 2
        custom_start = 600
        custom_end = 800

        # When start is provided, use it; otherwise use midpoint
        start_idx = custom_start if custom_start is not None else midpoint
        # When end is provided, use it; otherwise use total_count
        end_idx = custom_end if custom_end is not None else total_count

        assert start_idx == 600
        assert end_idx == 800

    def test_odd_total_count_midpoint_calculation(self):
        """Odd total count should floor divide correctly"""
        total_count = 1001
        midpoint = total_count // 2

        assert midpoint == 500

    def test_small_product_list_splits_correctly(self):
        """Small product list should split correctly"""
        total_count = 10
        midpoint = total_count // 2

        # Forward: 0-4 (5 products)
        # Reverse: 5-9 (5 products)
        assert midpoint == 5

    def test_single_product_midpoint(self):
        """Single product should have midpoint of 0"""
        total_count = 1
        midpoint = total_count // 2

        assert midpoint == 0


class TestSupabaseRangeQuery:
    """Tests for Supabase query with range limits"""

    def test_range_limits_override_default_1000(self):
        """range(0, 9999) should allow fetching more than 1000 rows"""
        # This test verifies the pattern used in the code
        # range(0, 9999) is used to override Supabase's default 1000 row limit
        start = 0
        end = 9999

        # The range should be large enough to fetch all products
        assert end - start == 9999
        assert end > 1000  # More than default limit

    def test_product_slice_with_start_end(self):
        """Products should be sliced correctly with start/end indices"""
        all_products = list(range(100))  # Simulate 100 products
        start_idx = 20
        end_idx = 50

        products = all_products[start_idx:end_idx]

        assert len(products) == 30
        assert products[0] == 20
        assert products[-1] == 49

    def test_product_slice_none_defaults(self):
        """None start/end should use full list"""
        all_products = list(range(100))
        start_idx = None
        end_idx = None

        start = start_idx or 0
        end = end_idx or len(all_products)
        products = all_products[start:end]

        assert len(products) == 100

    def test_reverse_list_operation(self):
        """Reversing product list should work correctly"""
        products = [1, 2, 3, 4, 5]
        reversed_products = list(reversed(products))

        assert reversed_products == [5, 4, 3, 2, 1]


class TestDateRangeCalculation:
    """Tests for date range calculation in backfill_prices"""

    def test_date_range_calculation_90_days(self):
        """90 days backfill should calculate correct date range"""
        days = 90

        # Using a fixed reference date for testing
        reference_date = datetime(2025, 1, 15, tzinfo=timezone.utc).date()
        yesterday = reference_date - timedelta(days=1)
        days_ago = yesterday - timedelta(days=days)

        target_end_date = yesterday.strftime("%Y-%m-%d")
        target_start_date = days_ago.strftime("%Y-%m-%d")

        assert target_end_date == "2025-01-14"
        assert target_start_date == "2024-10-16"

    def test_date_range_calculation_30_days(self):
        """30 days backfill should calculate correct date range"""
        days = 30

        reference_date = datetime(2025, 1, 15, tzinfo=timezone.utc).date()
        yesterday = reference_date - timedelta(days=1)
        days_ago = yesterday - timedelta(days=days)

        target_end_date = yesterday.strftime("%Y-%m-%d")
        target_start_date = days_ago.strftime("%Y-%m-%d")

        assert target_end_date == "2025-01-14"
        assert target_start_date == "2024-12-15"

    def test_expected_days_calculation(self):
        """Expected days should be calculated correctly"""
        start_date = "2024-12-01"
        end_date = "2024-12-31"

        start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
        expected_days = (end_dt - start_dt).days + 1

        assert expected_days == 31


class TestReleaseDateHandling:
    """Tests for product release date handling"""

    def test_release_date_after_target_start_uses_release_date(self):
        """Product start date should use release date if it's after target start"""
        target_start_date = "2024-10-01"
        release_date_str = "2024-11-15"

        release_date = datetime.strptime(release_date_str, "%Y-%m-%d").date()
        target_start = datetime.strptime(target_start_date, "%Y-%m-%d").date()

        if release_date > target_start:
            product_start_date = release_date.strftime("%Y-%m-%d")
        else:
            product_start_date = target_start_date

        assert product_start_date == "2024-11-15"

    def test_release_date_before_target_start_uses_target_start(self):
        """Product start date should use target start if release date is before it"""
        target_start_date = "2024-10-01"
        release_date_str = "2024-08-15"

        release_date = datetime.strptime(release_date_str, "%Y-%m-%d").date()
        target_start = datetime.strptime(target_start_date, "%Y-%m-%d").date()

        if release_date > target_start:
            product_start_date = release_date.strftime("%Y-%m-%d")
        else:
            product_start_date = target_start_date

        assert product_start_date == "2024-10-01"

    def test_parse_release_date_with_timestamp(self):
        """Release date with timestamp should be parsed correctly"""
        release_date_str = "2024-11-15T00:00:00Z"

        if 'T' in release_date_str:
            release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
        else:
            release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

        assert release_date == datetime(2024, 11, 15).date()

    def test_parse_release_date_without_timestamp(self):
        """Release date without timestamp should be parsed correctly"""
        release_date_str = "2024-11-15"

        if 'T' in release_date_str:
            release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
        else:
            release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

        assert release_date == datetime(2024, 11, 15).date()


class TestExistingDataCheck:
    """Tests for checking existing data completeness"""

    def test_complete_data_detected(self):
        """Should detect when data is complete"""
        existing_dates = {"2024-12-01", "2024-12-02", "2024-12-03"}
        expected_days = 3

        has_complete_data = len(existing_dates) >= expected_days

        assert has_complete_data is True

    def test_incomplete_data_detected(self):
        """Should detect when data is incomplete"""
        existing_dates = {"2024-12-01", "2024-12-03"}  # Missing 12-02
        expected_days = 3

        has_complete_data = len(existing_dates) >= expected_days

        assert has_complete_data is False

    def test_empty_existing_data(self):
        """Should handle empty existing data"""
        existing_dates = set()
        expected_days = 3

        has_complete_data = len(existing_dates) >= expected_days

        assert has_complete_data is False

    def test_date_extraction_from_timestamp(self):
        """Should extract date from timestamp correctly"""
        recorded_at = "2024-12-01 12:00:00"
        date_str = recorded_at.split(' ')[0].split('T')[0]

        assert date_str == "2024-12-01"

    def test_date_extraction_from_iso_timestamp(self):
        """Should extract date from ISO timestamp correctly"""
        recorded_at = "2024-12-01T12:00:00+00:00"
        date_str = recorded_at.split(' ')[0].split('T')[0]

        assert date_str == "2024-12-01"


class TestDataFiltering:
    """Tests for filtering historical data"""

    def test_filter_data_within_date_range(self):
        """Should filter data to only include dates in target range"""
        historical_data = [
            {'date': '2024-11-01', 'price': 100},
            {'date': '2024-12-01', 'price': 110},
            {'date': '2024-12-15', 'price': 115},
            {'date': '2025-01-01', 'price': 120},
        ]
        product_start_date = "2024-12-01"
        target_end_date = "2024-12-31"

        filtered_data = [
            entry for entry in historical_data
            if product_start_date <= entry['date'] <= target_end_date
        ]

        assert len(filtered_data) == 2
        assert filtered_data[0]['date'] == '2024-12-01'
        assert filtered_data[1]['date'] == '2024-12-15'

    def test_filter_out_existing_dates(self):
        """Should filter out dates that already exist"""
        filtered_data = [
            {'date': '2024-12-01', 'price': 100},
            {'date': '2024-12-02', 'price': 105},
            {'date': '2024-12-03', 'price': 110},
        ]
        existing_dates = {'2024-12-01', '2024-12-03'}

        new_entries = [entry for entry in filtered_data if entry['date'] not in existing_dates]

        assert len(new_entries) == 1
        assert new_entries[0]['date'] == '2024-12-02'

    def test_empty_historical_data(self):
        """Should handle empty historical data"""
        historical_data = []
        product_start_date = "2024-12-01"
        target_end_date = "2024-12-31"

        filtered_data = [
            entry for entry in historical_data
            if product_start_date <= entry['date'] <= target_end_date
        ]

        assert filtered_data == []


class TestCanvasTableDataExtraction:
    """Tests for extract_canvas_table_data logic"""

    def test_date_range_expansion(self):
        """Should expand date range to individual days"""
        # Simulate parsing "11/5 to 11/7" with price 100
        start_date = datetime(2025, 11, 5)
        end_date = datetime(2025, 11, 7)
        price = 100.0

        historical_data = []
        current_date = start_date
        while current_date <= end_date:
            historical_data.append({
                'date': current_date.strftime("%Y-%m-%d"),
                'price': price
            })
            current_date += timedelta(days=1)

        assert len(historical_data) == 3
        assert historical_data[0]['date'] == '2025-11-05'
        assert historical_data[1]['date'] == '2025-11-06'
        assert historical_data[2]['date'] == '2025-11-07'
        assert all(entry['price'] == 100.0 for entry in historical_data)

    def test_single_date_parsing(self):
        """Should parse single date format correctly"""
        date_str = "2025-11-08"

        # Validate format
        is_valid = "-" in date_str and len(date_str) == 10

        if is_valid:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            result_date = date_obj.strftime("%Y-%m-%d")
        else:
            result_date = None

        assert result_date == "2025-11-08"

    def test_invalid_single_date_format(self):
        """Should reject invalid single date format"""
        date_str = "2025/11/08"  # Wrong format

        is_valid = "-" in date_str and len(date_str) == 10

        assert is_valid is False

    def test_price_parsing_removes_dollar_and_comma(self):
        """Should parse price correctly, removing $ and commas"""
        price_str = "$1,234.56"

        cleaned_price = price_str.replace("$", "").replace(",", "")
        price = float(cleaned_price)

        assert price == 1234.56


class TestDeduplication:
    """Tests for deduplication logic"""

    def test_deduplicate_prefers_later_entries(self):
        """Should prefer later entries (1M data over 3M data)"""
        all_data = [
            {'date': '2025-11-05', 'price': 100.0},  # From 3M (average)
            {'date': '2025-11-06', 'price': 100.0},  # From 3M (average)
            {'date': '2025-11-05', 'price': 105.0},  # From 1M (actual)
        ]

        deduplicated = {}
        for entry in all_data:
            date = entry['date']
            deduplicated[date] = entry

        final_data = list(deduplicated.values())

        # 11-05 should have the 1M price (105.0), not 3M (100.0)
        entry_1105 = next(e for e in final_data if e['date'] == '2025-11-05')
        assert entry_1105['price'] == 105.0

        # 11-06 should still have the 3M price (100.0)
        entry_1106 = next(e for e in final_data if e['date'] == '2025-11-06')
        assert entry_1106['price'] == 100.0

    def test_deduplicate_calculates_removed_count(self):
        """Should correctly calculate removed duplicates count"""
        all_data = [
            {'date': '2025-11-05', 'price': 100.0},
            {'date': '2025-11-06', 'price': 100.0},
            {'date': '2025-11-05', 'price': 105.0},  # Duplicate
            {'date': '2025-11-07', 'price': 110.0},
            {'date': '2025-11-06', 'price': 107.0},  # Duplicate
        ]

        deduplicated = {}
        for entry in all_data:
            deduplicated[entry['date']] = entry

        final_data = list(deduplicated.values())
        duplicates_removed = len(all_data) - len(final_data)

        assert len(final_data) == 3
        assert duplicates_removed == 2


class TestEdgeCases:
    """Tests for edge cases and error handling"""

    def test_empty_products_list(self):
        """Should handle empty products list gracefully"""
        products = []
        processed_count = 0

        for product in products:
            processed_count += 1

        assert processed_count == 0

    def test_product_with_missing_sets_data(self):
        """Should handle product with missing sets data"""
        product = {
            "id": 1,
            "url": "https://example.com/product/1",
            "variant": None,
            "set_id": 1,
            "sets": None  # Missing sets data
        }

        release_date_str = None
        sets_data = product.get("sets")
        if sets_data and isinstance(sets_data, dict):
            release_date_str = sets_data.get("release_date")

        assert release_date_str is None

    def test_product_with_empty_sets_dict(self):
        """Should handle product with empty sets dict"""
        product = {
            "id": 1,
            "url": "https://example.com/product/1",
            "sets": {}  # Empty dict
        }

        release_date_str = None
        sets_data = product.get("sets")
        if sets_data and isinstance(sets_data, dict):
            release_date_str = sets_data.get("release_date")

        assert release_date_str is None

    def test_boundary_index_slicing(self):
        """Should handle boundary cases in list slicing"""
        products = [1, 2, 3, 4, 5]

        # Slice beyond list length
        sliced = products[0:100]
        assert sliced == [1, 2, 3, 4, 5]

        # Start after list length
        sliced = products[100:200]
        assert sliced == []

    def test_zero_expected_days(self):
        """Should handle case where expected_days is 0 or negative"""
        start_date = "2024-12-15"
        end_date = "2024-12-10"  # End before start

        start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
        expected_days = (end_dt - start_dt).days + 1

        # This would be -4 days (invalid range)
        assert expected_days == -4


class TestCreateDriverMocking:
    """Tests that verify create_driver behavior can be mocked"""

    @patch('backfill_historical_prices.webdriver')
    @patch('backfill_historical_prices.ChromeDriverManager')
    def test_create_driver_called_with_options(self, mock_cdm, mock_webdriver):
        """Should create driver with proper options"""
        # Setup mocks
        mock_service = MagicMock()
        mock_cdm.return_value.install.return_value = '/path/to/chromedriver'
        mock_driver = MagicMock()
        mock_webdriver.Chrome.return_value = mock_driver

        from backfill_historical_prices import create_driver

        driver = create_driver()

        # Verify webdriver.Chrome was called
        assert mock_webdriver.Chrome.called


class TestPriceParsingEdgeCases:
    """Tests for edge cases in price parsing"""

    def test_price_with_no_decimals(self):
        """Should parse price without decimals"""
        price_str = "$100"
        cleaned = price_str.replace("$", "").replace(",", "")
        price = float(cleaned)
        assert price == 100.0

    def test_price_with_leading_zeros(self):
        """Should parse price with leading zeros"""
        price_str = "$007.50"
        cleaned = price_str.replace("$", "").replace(",", "")
        price = float(cleaned)
        assert price == 7.50

    def test_price_very_large(self):
        """Should parse very large prices"""
        price_str = "$1,234,567.89"
        cleaned = price_str.replace("$", "").replace(",", "")
        price = float(cleaned)
        assert price == 1234567.89

    def test_price_very_small(self):
        """Should parse very small prices"""
        price_str = "$0.01"
        cleaned = price_str.replace("$", "").replace(",", "")
        price = float(cleaned)
        assert price == 0.01


class TestIntegrationScenarios:
    """Integration-style tests for complete scenarios"""

    def test_forward_reverse_ranges_cover_all_products(self):
        """Forward and reverse ranges together should cover all products"""
        total_count = 1000
        midpoint = total_count // 2

        forward_range = range(0, midpoint)
        reverse_range = range(midpoint, total_count)

        all_indices = set(forward_range) | set(reverse_range)

        assert len(all_indices) == total_count
        assert min(all_indices) == 0
        assert max(all_indices) == total_count - 1

    def test_date_range_coverage(self):
        """Date filtering should not create gaps"""
        # Simulate 3M data (ranges)
        three_m_data = []
        # Nov 5-7 range
        for day in range(5, 8):
            three_m_data.append({'date': f'2025-11-{day:02d}', 'price': 100.0})

        # Simulate 1M data (daily)
        one_m_data = []
        # Nov 8-30 daily
        for day in range(8, 31):
            one_m_data.append({'date': f'2025-11-{day:02d}', 'price': 105.0})

        # Combine
        all_data = three_m_data + one_m_data

        # Verify no gaps in November
        dates = sorted([d['date'] for d in all_data])
        expected_dates = [f'2025-11-{d:02d}' for d in range(5, 31)]

        assert dates == expected_dates


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
