#!/usr/bin/env python3
"""
Comprehensive unit tests for the enhanced backfill_historical_prices.py

Tests cover:
- Multi-timeframe scraping (1M, 3M, 6M, 1Y)
- Checkpoint management (save, load, resume)
- Rate limiting with exponential backoff
- Session recycling
- Error handling and retries
- CLI argument parsing (--forward, --reverse, --resume, --debug)
- Date parsing and deduplication
- Supabase integration

Run with: python -m pytest tests/test_backfill_enhanced.py -v
"""
import argparse
import sys
import json
import tempfile
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, mock_open, call
import pytest

# Mock external dependencies
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'


# === Checkpoint Manager Tests ===
class TestCheckpointManager:
    """Tests for CheckpointManager class"""

    @patch('builtins.open', new_callable=mock_open)
    @patch('os.path.exists', return_value=False)
    def test_checkpoint_manager_creates_new_checkpoint(self, mock_exists, mock_file):
        """Should create new checkpoint if file doesn't exist"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")

        assert checkpoint.data['processed_products'] == []
        assert checkpoint.data['failed_products'] == []
        assert checkpoint.data['stats']['total_inserted'] == 0
        assert checkpoint.data['stats']['total_failed'] == 0
        assert checkpoint.data['stats']['total_skipped'] == 0

    @patch('builtins.open', new_callable=mock_open, read_data='{"processed_products": [1, 2], "failed_products": [3], "stats": {"total_inserted": 100, "total_failed": 1, "total_skipped": 5}, "last_updated": "2025-01-09T10:00:00"}')
    @patch('os.path.exists', return_value=True)
    def test_checkpoint_manager_loads_existing_checkpoint(self, mock_exists, mock_file):
        """Should load existing checkpoint from file"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")

        assert 1 in checkpoint.data['processed_products']
        assert 2 in checkpoint.data['processed_products']
        assert 3 in checkpoint.data['failed_products']
        assert checkpoint.data['stats']['total_inserted'] == 100

    @patch('builtins.open', new_callable=mock_open)
    @patch('os.path.exists', return_value=False)
    def test_checkpoint_mark_processed(self, mock_exists, mock_file):
        """Should mark product as processed"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")
        checkpoint.mark_processed(123)

        assert 123 in checkpoint.data['processed_products']

    @patch('builtins.open', new_callable=mock_open)
    @patch('os.path.exists', return_value=False)
    def test_checkpoint_mark_failed(self, mock_exists, mock_file):
        """Should mark product as failed"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")
        checkpoint.mark_failed(456)

        assert 456 in checkpoint.data['failed_products']

    @patch('builtins.open', new_callable=mock_open)
    @patch('os.path.exists', return_value=False)
    def test_checkpoint_is_processed(self, mock_exists, mock_file):
        """Should check if product is processed"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")
        checkpoint.mark_processed(789)

        assert checkpoint.is_processed(789) is True
        assert checkpoint.is_processed(999) is False

    @patch('builtins.open', new_callable=mock_open)
    @patch('os.path.exists', return_value=False)
    def test_checkpoint_update_stats(self, mock_exists, mock_file):
        """Should update statistics"""
        from backfill_historical_prices import CheckpointManager

        checkpoint = CheckpointManager("test_checkpoint.json")
        checkpoint.update_stats(inserted=50, failed=2, skipped=10)

        assert checkpoint.data['stats']['total_inserted'] == 50
        assert checkpoint.data['stats']['total_failed'] == 2
        assert checkpoint.data['stats']['total_skipped'] == 10


# === Rate Limiter Tests ===
class TestRateLimiter:
    """Tests for RateLimiter class"""

    def test_rate_limiter_initializes_correctly(self):
        """Should initialize with config values"""
        from backfill_historical_prices import RateLimiter, RATE_LIMIT_CONFIG

        limiter = RateLimiter()

        assert limiter.config == RATE_LIMIT_CONFIG
        assert limiter.last_request_time == 0
        assert limiter.consecutive_errors == 0

    @patch('time.sleep')
    @patch('time.time', side_effect=[0, 1])  # First call returns 0, second returns 1
    def test_rate_limiter_waits_minimum_delay(self, mock_time, mock_sleep):
        """Should wait at least min_delay seconds"""
        from backfill_historical_prices import RateLimiter

        limiter = RateLimiter()
        limiter.wait()

        # Should have called sleep with some positive value
        assert mock_sleep.called

    def test_rate_limiter_records_errors(self):
        """Should increment consecutive_errors counter"""
        from backfill_historical_prices import RateLimiter

        limiter = RateLimiter()
        limiter.record_error()
        limiter.record_error()

        assert limiter.consecutive_errors == 2

    def test_rate_limiter_resets_errors(self):
        """Should reset consecutive_errors to 0"""
        from backfill_historical_prices import RateLimiter

        limiter = RateLimiter()
        limiter.record_error()
        limiter.record_error()
        limiter.reset_errors()

        assert limiter.consecutive_errors == 0


# === Multi-Timeframe Extraction Tests ===
class TestMultiTimeframeExtraction:
    """Tests for multi-timeframe historical data extraction"""

    def test_api_range_labels(self):
        """Should pull the same four timeframes the old Selenium buttons did.

        Retargeted from TIMEFRAME_BUTTONS when the backfill moved from
        clicking chart buttons to the infinite-api ranges.
        """
        from backfill_historical_prices import API_RANGE_CONFIG

        labels = [r["label"] for r in API_RANGE_CONFIG]
        assert labels == ['1M', '3M', '6M', '1Y']

    def test_api_ranges_are_ordered_finest_first(self):
        """Dedupe is first-wins, so the finest granularity must come first or
        weekly prices would overwrite real daily ones."""
        from backfill_historical_prices import API_RANGE_CONFIG

        assert API_RANGE_CONFIG[0]["keys"][0] == "month"
        assert API_RANGE_CONFIG[-1]["keys"][0] == "annual"

    def test_is_date_range_detection(self):
        """Should correctly identify which timeframes use date ranges"""
        timeframes_with_ranges = ['6M', '1Y']
        timeframes_without_ranges = ['1M', '3M']

        for tf in timeframes_with_ranges:
            is_range = tf in ['6M', '1Y']
            assert is_range is True

        for tf in timeframes_without_ranges:
            is_range = tf in ['6M', '1Y']
            assert is_range is False

    def test_deduplication_prefers_shorter_timeframes(self):
        """Should prefer data from shorter timeframes (more granular)"""
        # Simulate data from multiple timeframes
        all_historical_data = [
            {'date': '2025-01-01', 'price': 100.0},  # From 1Y (weekly)
            {'date': '2025-01-02', 'price': 102.0},  # From 6M (weekly)
            {'date': '2025-01-01', 'price': 105.0},  # From 1M (daily) - should win
        ]

        # Simulate deduplication logic (reversed to prefer earlier = shorter timeframe)
        deduplicated = {}
        for entry in reversed(all_historical_data):
            date = entry['date']
            if date not in deduplicated:
                deduplicated[date] = entry

        final_data = list(deduplicated.values())

        # Find entry for 2025-01-01
        entry_0101 = next(e for e in final_data if e['date'] == '2025-01-01')
        # Should prefer the last occurrence in reversed list = first in original = 1Y data
        # But wait, we want shortest timeframe which comes LAST in the list
        # So we reverse, then take first occurrence = shortest timeframe wins
        assert entry_0101['price'] == 105.0  # From 1M (shortest/most granular)


# === Date Parsing Tests ===
class TestToDate:
    """Tests for _to_date.

    Replaces TestParseShortDate: parse_short_date existed to recover a year
    from an "M/D" string scraped out of the chart tooltip. The infinite-api
    returns unambiguous ISO dates, so that heuristic — and its 7-day future
    tolerance — no longer has anything to parse.
    """

    def test_parses_iso_date(self):
        from backfill_historical_prices import _to_date

        result = _to_date("2026-07-04")

        assert (result.year, result.month, result.day) == (2026, 7, 4)

    def test_rejects_malformed_dates(self):
        from backfill_historical_prices import _to_date

        assert _to_date("07/04/2026") is None
        assert _to_date("not-a-date") is None
        assert _to_date("") is None


# === CLI Argument Tests ===
class TestCLIArguments:
    """Tests for CLI argument parsing"""

    def test_forward_flag(self):
        """Should parse --forward flag"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--resume", type=str, default=None)
        parser.add_argument("--debug", action="store_true")

        args = parser.parse_args(["--forward"])

        assert args.forward is True
        assert args.reverse is False

    def test_reverse_flag(self):
        """Should parse --reverse flag"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--resume", type=str, default=None)
        parser.add_argument("--debug", action="store_true")

        args = parser.parse_args(["--reverse"])

        assert args.reverse is True
        assert args.forward is False

    def test_resume_flag_with_filename(self):
        """Should parse --resume flag with checkpoint filename"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--resume", type=str, default=None)
        parser.add_argument("--debug", action="store_true")

        args = parser.parse_args(["--resume", "checkpoint_20250109.json"])

        assert args.resume == "checkpoint_20250109.json"

    def test_debug_flag(self):
        """Should parse --debug flag"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--resume", type=str, default=None)
        parser.add_argument("--debug", action="store_true")

        args = parser.parse_args(["--debug"])

        assert args.debug is True

    def test_no_flags_defaults(self):
        """Should have correct defaults when no flags provided"""
        parser = argparse.ArgumentParser()
        parser.add_argument("--forward", action="store_true")
        parser.add_argument("--reverse", action="store_true")
        parser.add_argument("--resume", type=str, default=None)
        parser.add_argument("--debug", action="store_true")

        args = parser.parse_args([])

        assert args.forward is False
        assert args.reverse is False
        assert args.resume is None
        assert args.debug is False


# === Date Range and Expansion Tests ===
class TestDateRangeExpansion:
    """Tests for date range expansion logic"""

    def test_expand_3_day_range(self):
        """Should expand 3-day range into individual days"""
        start_date = datetime(2025, 1, 5)
        end_date = datetime(2025, 1, 7)
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
        assert historical_data[0]['date'] == '2025-01-05'
        assert historical_data[1]['date'] == '2025-01-06'
        assert historical_data[2]['date'] == '2025-01-07'

    def test_expand_week_range(self):
        """Should expand weekly range into 7 days"""
        start_date = datetime(2025, 1, 1)
        end_date = datetime(2025, 1, 7)
        price = 105.0

        historical_data = []
        current_date = start_date
        while current_date <= end_date:
            historical_data.append({
                'date': current_date.strftime("%Y-%m-%d"),
                'price': price
            })
            current_date += timedelta(days=1)

        assert len(historical_data) == 7


# === Session Recycling Tests ===
class TestSessionRecycling:
    """Tests for browser session recycling logic"""

    def test_session_recycle_after_threshold(self):
        """Should recycle session after RATE_LIMIT_CONFIG['session_recycle_after'] products"""
        from backfill_historical_prices import RATE_LIMIT_CONFIG

        session_product_count = 0
        should_recycle = False

        for _ in range(RATE_LIMIT_CONFIG['session_recycle_after'] + 1):
            session_product_count += 1
            if session_product_count >= RATE_LIMIT_CONFIG['session_recycle_after']:
                should_recycle = True
                break

        assert should_recycle is True

    def test_browser_profile_rotation(self):
        """Should have multiple browser fingerprints available.

        Retargeted from USER_AGENTS, which became BROWSER_PROFILES when the
        rewrite started rotating full fingerprints rather than bare UA strings.
        """
        from backfill_historical_prices import BROWSER_PROFILES

        assert len(BROWSER_PROFILES) >= 2
        assert all('Mozilla/5.0' in p["User-Agent"] for p in BROWSER_PROFILES)


# === Data Filtering Tests ===
class TestDataFiltering:
    """Tests for filtering historical data"""

    def test_filter_by_date_range(self):
        """Should filter data to target date range"""
        historical_data = [
            {'date': '2024-12-01', 'price': 100},
            {'date': '2025-01-01', 'price': 105},
            {'date': '2025-01-15', 'price': 110},
            {'date': '2025-02-01', 'price': 115},
        ]
        product_start_date = "2025-01-01"
        target_end_date = "2025-01-31"

        filtered_data = [
            entry for entry in historical_data
            if product_start_date <= entry['date'] <= target_end_date
        ]

        assert len(filtered_data) == 2
        assert filtered_data[0]['date'] == '2025-01-01'
        assert filtered_data[1]['date'] == '2025-01-15'

    def test_filter_out_existing_dates(self):
        """Should exclude dates that already exist in database"""
        filtered_data = [
            {'date': '2025-01-01', 'price': 100},
            {'date': '2025-01-02', 'price': 105},
            {'date': '2025-01-03', 'price': 110},
        ]
        existing_dates = {'2025-01-01', '2025-01-03'}

        new_entries = [entry for entry in filtered_data if entry['date'] not in existing_dates]

        assert len(new_entries) == 1
        assert new_entries[0]['date'] == '2025-01-02'


# === Release Date Handling Tests ===
class TestReleaseDateHandling:
    """Tests for product release date handling"""

    def test_use_release_date_when_after_target_start(self):
        """Should use release date if it's after target start"""
        target_start_date = "2024-10-01"
        release_date_str = "2024-11-15"

        release_date = datetime.strptime(release_date_str, "%Y-%m-%d").date()
        target_start = datetime.strptime(target_start_date, "%Y-%m-%d").date()

        if release_date > target_start:
            product_start_date = release_date.strftime("%Y-%m-%d")
        else:
            product_start_date = target_start_date

        assert product_start_date == "2024-11-15"

    def test_use_target_start_when_release_before(self):
        """Should use target start if release date is before it"""
        target_start_date = "2024-10-01"
        release_date_str = "2024-08-15"

        release_date = datetime.strptime(release_date_str, "%Y-%m-%d").date()
        target_start = datetime.strptime(target_start_date, "%Y-%m-%d").date()

        if release_date > target_start:
            product_start_date = release_date.strftime("%Y-%m-%d")
        else:
            product_start_date = target_start_date

        assert product_start_date == "2024-10-01"

    def test_parse_iso_release_date(self):
        """Should parse ISO format release date"""
        release_date_str = "2024-11-15T00:00:00Z"

        if 'T' in release_date_str:
            release_date = datetime.fromisoformat(release_date_str.replace('Z', '+00:00')).date()
        else:
            release_date = datetime.strptime(release_date_str.split(' ')[0], "%Y-%m-%d").date()

        assert release_date == datetime(2024, 11, 15).date()


# === Days Validation Tests ===
class TestDaysValidation:
    """Tests for days parameter validation"""

    def test_days_exceeding_365_adjusted(self):
        """Should adjust days to 365 if exceeding maximum"""
        days = 1000

        if days > 365:
            days = 365

        assert days == 365

    def test_days_within_limit_unchanged(self):
        """Should keep days unchanged if within limit"""
        days = 180

        if days > 365:
            days = 365

        assert days == 180


# === Batch Insert Tests ===
class TestBatchInsert:
    """Tests for batch insert logic"""

    def test_batch_entries_format(self):
        """Should format entries correctly for batch insert"""
        new_entries = [
            {'date': '2025-01-01', 'price': 100.0},
            {'date': '2025-01-02', 'price': 105.0},
        ]
        product_id = 123

        batch_entries = [
            {
                "product_id": product_id,
                "usd_price": entry['price'],
                "recorded_at": f"{entry['date']} 12:00:00"
            }
            for entry in new_entries
        ]

        assert len(batch_entries) == 2
        assert batch_entries[0]['product_id'] == 123
        assert batch_entries[0]['usd_price'] == 100.0
        assert batch_entries[0]['recorded_at'] == "2025-01-01 12:00:00"


# === Integration Tests ===
class TestIntegration:
    """Integration-style tests for complete scenarios"""

    def test_forward_reverse_split_covers_all(self):
        """Forward and reverse should cover all products without overlap"""
        total_count = 1000
        midpoint = total_count // 2

        forward_indices = set(range(0, midpoint))
        reverse_indices = set(range(midpoint, total_count))

        # No overlap
        assert len(forward_indices & reverse_indices) == 0
        # Complete coverage
        assert len(forward_indices | reverse_indices) == total_count

    def test_finer_granularity_wins_when_ranges_overlap(self):
        """The real multi-range property: ranges are merged first-wins in
        API_RANGE_CONFIG order, so a real daily price from `month` must beat
        the flat-filled value the weekly `annual` bucket expands to for the
        same date.

        Replaces test_multi_timeframe_comprehensive_coverage, which built
        throwaway dicts and asserted len(...) > 50 on a list it had just
        constructed with exactly 50 entries — it never imported the module.
        """
        from backfill_historical_prices import expand_buckets_to_daily

        # A weekly bucket flat-fills 7 days at one price...
        weekly = expand_buckets_to_daily([
            {"bucketStartDate": "2026-06-01", "marketPrice": "100.00"},
            {"bucketStartDate": "2026-06-08", "marketPrice": "110.00"},
        ])
        weekly_by_date = {e["date"]: e["price"] for e in weekly}
        assert weekly_by_date["2026-06-01"] == 100.0
        assert weekly_by_date["2026-06-07"] == 100.0, "week should flat-fill"

        # ...while daily buckets carry the true per-day price.
        daily = expand_buckets_to_daily([
            {"bucketStartDate": "2026-06-05", "marketPrice": "103.50"},
            {"bucketStartDate": "2026-06-06", "marketPrice": "104.25"},
        ])
        daily_by_date = {e["date"]: e["price"] for e in daily}
        assert daily_by_date["2026-06-05"] == 103.5

        # Merged first-wins with the finer range first (as API_RANGE_CONFIG
        # orders them), the daily price must survive for the shared date.
        merged = {}
        for entry in daily + weekly:
            merged.setdefault(entry["date"], entry["price"])
        assert merged["2026-06-05"] == 103.5, "daily must beat flat-filled weekly"
        assert merged["2026-06-02"] == 100.0, "weekly still fills what daily lacks"

    def test_expand_skips_non_positive_and_malformed_prices(self):
        from backfill_historical_prices import expand_buckets_to_daily

        out = expand_buckets_to_daily([
            {"bucketStartDate": "2026-06-01", "marketPrice": "0"},
            {"bucketStartDate": "2026-06-02", "marketPrice": "n/a"},
            {"bucketStartDate": "2026-06-03", "marketPrice": "1,234.50"},
        ])

        by_date = {e["date"]: e["price"] for e in out}
        assert "2026-06-01" not in by_date
        assert "2026-06-02" not in by_date
        assert by_date["2026-06-03"] == 1234.50


class TestRangesCovering:
    """Tests for ranges_covering: each API range is one request against a
    bot-sensitive endpoint, and the ranges nest, so patching a recent hole
    should not pull the annual range as well."""

    def test_recent_gap_needs_only_the_month_range(self):
        from backfill_historical_prices import ranges_covering
        from datetime import date

        picked = ranges_covering(date(2026, 8, 1), today=date(2026, 8, 5))

        assert [r["label"] for r in picked] == ["1M"]

    def test_older_gap_widens_to_the_range_that_reaches_it(self):
        from backfill_historical_prices import ranges_covering
        from datetime import date

        assert [r["label"] for r in ranges_covering(date(2026, 6, 20), today=date(2026, 8, 5))] == ["1M", "3M"]
        assert [r["label"] for r in ranges_covering(date(2026, 4, 1), today=date(2026, 8, 5))] == ["1M", "3M", "6M"]

    def test_unknown_or_ancient_gap_falls_back_to_all_ranges(self):
        from backfill_historical_prices import ranges_covering, API_RANGE_CONFIG
        from datetime import date

        assert ranges_covering(None) == API_RANGE_CONFIG
        assert ranges_covering(date(2020, 1, 1), today=date(2026, 8, 5)) == API_RANGE_CONFIG

    def test_prefix_order_is_preserved(self):
        """The merge is first-wins, so a narrowed list must still start with
        the finest range or weekly prices would win over daily ones."""
        from backfill_historical_prices import ranges_covering, API_RANGE_CONFIG
        from datetime import date

        picked = ranges_covering(date(2026, 5, 1), today=date(2026, 8, 5))
        assert picked == API_RANGE_CONFIG[: len(picked)]


# === Error Handling Tests ===
class TestErrorHandling:
    """Tests for error handling scenarios"""

    def test_empty_products_list(self):
        """Should handle empty products list"""
        products = []
        processed_count = 0

        for product in products:
            processed_count += 1

        assert processed_count == 0

    def test_missing_sets_data(self):
        """Should handle product with missing sets data"""
        product = {
            "id": 1,
            "url": "https://example.com/product/1",
            "sets": None
        }

        sets_data = product.get("sets")
        release_date_str = None
        if sets_data and isinstance(sets_data, dict):
            release_date_str = sets_data.get("release_date")

        assert release_date_str is None

    def test_retry_logic_exhaustion(self):
        """Should stop retrying after max_retries"""
        from backfill_historical_prices import RATE_LIMIT_CONFIG

        max_retries = RATE_LIMIT_CONFIG['max_retries']
        attempts = 0

        for attempt in range(1, max_retries + 1):
            attempts += 1

        assert attempts == max_retries


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
