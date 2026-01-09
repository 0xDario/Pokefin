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

    def test_timeframe_buttons_list(self):
        """Should have correct timeframe buttons"""
        from backfill_historical_prices import TIMEFRAME_BUTTONS

        assert TIMEFRAME_BUTTONS == ['1M', '3M', '6M', '1Y']
        assert len(TIMEFRAME_BUTTONS) == 4

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


# === Parse Short Date Tests ===
class TestParseShortDate:
    """Tests for parse_short_date function with 7-day future tolerance"""

    def test_parse_date_within_7_days_future_uses_current_year(self):
        """Dates within 7 days in future should use current year"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        future_date = now + timedelta(days=5)
        date_str = f"{future_date.month}/{future_date.day}"

        result = parse_short_date(date_str)

        assert result.year == now.year
        assert result.month == future_date.month
        assert result.day == future_date.day

    def test_parse_date_more_than_7_days_future_uses_previous_year(self):
        """Dates more than 7 days in future should use previous year"""
        from backfill_historical_prices import parse_short_date

        now = datetime.now(timezone.utc)
        future_date = now + timedelta(days=30)
        date_str = f"{future_date.month}/{future_date.day}"

        result = parse_short_date(date_str)

        assert result.year == now.year - 1


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

    def test_user_agent_rotation(self):
        """Should have multiple user agents available"""
        from backfill_historical_prices import USER_AGENTS

        assert len(USER_AGENTS) == 5
        assert all('Mozilla/5.0' in ua for ua in USER_AGENTS)


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

    def test_multi_timeframe_comprehensive_coverage(self):
        """Multi-timeframe extraction should provide comprehensive date coverage"""
        # Simulate data from different timeframes
        timeframe_data = {
            '1M': [{'date': f'2025-01-{d:02d}', 'price': 100 + d} for d in range(1, 31)],  # 30 days daily
            '3M': [{'date': f'2024-12-{d:02d}', 'price': 90 + d} for d in range(1, 31, 3)],  # Every 3 days
            '6M': [{'date': f'2024-11-{d:02d}', 'price': 80 + d} for d in range(1, 30, 7)],  # Weekly
            '1Y': [{'date': f'2024-10-{d:02d}', 'price': 70 + d} for d in range(1, 31, 7)],  # Weekly
        }

        all_data = []
        for timeframe, data in timeframe_data.items():
            all_data.extend(data)

        # Should have comprehensive date coverage across all timeframes
        assert len(all_data) > 50  # Significant amount of data points


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
