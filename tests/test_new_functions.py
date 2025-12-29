#!/usr/bin/env python3
"""
Unit tests for newly added functions in main.py and backfill_historical_prices.py

These tests cover:
- cleanup_driver(driver, user_data_dir)
- fetch_products_paginated(batch_size=500)
- batch_insert_price_history(entries, batch_size=100)
- fetch_products_needing_update(...)
- _flush_price_history_batch(batch)

Run with: python -m pytest tests/test_new_functions.py -v
"""
import sys
import os
import tempfile
import shutil
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call
import pytest

# Mock external dependencies before importing modules
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'


class TestCleanupDriverMain:
    """Tests for cleanup_driver function in main.py"""

    def test_cleanup_driver_quits_driver_and_removes_directory(self):
        """Should quit driver and remove temp directory"""
        from main import cleanup_driver

        # Create a mock driver
        mock_driver = MagicMock()

        # Create a real temp directory
        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        cleanup_driver(mock_driver, temp_dir)

        # Verify driver.quit() was called
        mock_driver.quit.assert_called_once()

        # Verify temp directory was removed
        assert not os.path.exists(temp_dir)

    def test_cleanup_driver_handles_none_driver(self):
        """Should handle None driver gracefully"""
        from main import cleanup_driver

        # Create a real temp directory
        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        # Should not raise exception
        cleanup_driver(None, temp_dir)

        # Verify temp directory was still removed
        assert not os.path.exists(temp_dir)

    def test_cleanup_driver_handles_none_user_data_dir(self):
        """Should handle None user_data_dir gracefully"""
        from main import cleanup_driver

        mock_driver = MagicMock()

        # Should not raise exception
        cleanup_driver(mock_driver, None)

        # Verify driver.quit() was called
        mock_driver.quit.assert_called_once()

    def test_cleanup_driver_handles_both_none(self):
        """Should handle both driver and user_data_dir being None"""
        from main import cleanup_driver

        # Should not raise exception
        cleanup_driver(None, None)

    def test_cleanup_driver_handles_nonexistent_directory(self):
        """Should handle non-existent directory gracefully"""
        from main import cleanup_driver

        mock_driver = MagicMock()
        nonexistent_dir = "/tmp/definitely_does_not_exist_12345"

        # Ensure it doesn't exist
        if os.path.exists(nonexistent_dir):
            shutil.rmtree(nonexistent_dir)

        # Should not raise exception
        cleanup_driver(mock_driver, nonexistent_dir)

        mock_driver.quit.assert_called_once()

    def test_cleanup_driver_handles_driver_quit_exception(self):
        """Should handle exception when driver.quit() fails"""
        from main import cleanup_driver

        mock_driver = MagicMock()
        mock_driver.quit.side_effect = Exception("Driver quit failed")

        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        # Should not raise exception
        cleanup_driver(mock_driver, temp_dir)

        # Temp directory should still be cleaned up
        assert not os.path.exists(temp_dir)


class TestCleanupDriverBackfill:
    """Tests for cleanup_driver function in backfill_historical_prices.py"""

    def test_cleanup_driver_quits_driver_and_removes_directory(self):
        """Should quit driver and remove temp directory"""
        from backfill_historical_prices import cleanup_driver

        mock_driver = MagicMock()
        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        cleanup_driver(mock_driver, temp_dir)

        mock_driver.quit.assert_called_once()
        assert not os.path.exists(temp_dir)

    def test_cleanup_driver_handles_none_driver(self):
        """Should handle None driver gracefully"""
        from backfill_historical_prices import cleanup_driver

        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")
        cleanup_driver(None, temp_dir)
        assert not os.path.exists(temp_dir)

    def test_cleanup_driver_handles_none_user_data_dir(self):
        """Should handle None user_data_dir gracefully"""
        from backfill_historical_prices import cleanup_driver

        mock_driver = MagicMock()
        cleanup_driver(mock_driver, None)
        mock_driver.quit.assert_called_once()


class TestFetchProductsPaginated:
    """Tests for fetch_products_paginated function in backfill_historical_prices.py"""

    @patch('backfill_historical_prices.supabase')
    def test_fetch_products_paginated_single_batch(self, mock_supabase):
        """Should fetch all products in single batch when less than batch_size"""
        # Setup mock
        mock_response = MagicMock()
        mock_response.data = [
            {"id": 1, "url": "https://example.com/1"},
            {"id": 2, "url": "https://example.com/2"},
        ]
        mock_supabase.table.return_value.select.return_value.range.return_value.execute.return_value = mock_response

        from backfill_historical_prices import fetch_products_paginated

        result = fetch_products_paginated(batch_size=500)

        assert len(result) == 2
        assert result[0]["id"] == 1

    @patch('backfill_historical_prices.supabase')
    def test_fetch_products_paginated_multiple_batches(self, mock_supabase):
        """Should paginate through multiple batches"""
        # First batch - full
        batch1 = [{"id": i} for i in range(1, 11)]  # 10 items
        # Second batch - partial
        batch2 = [{"id": i} for i in range(11, 16)]  # 5 items

        responses = [MagicMock(data=batch1), MagicMock(data=batch2)]
        mock_supabase.table.return_value.select.return_value.range.return_value.execute.side_effect = responses

        from backfill_historical_prices import fetch_products_paginated

        result = fetch_products_paginated(batch_size=10)

        assert len(result) == 15
        assert result[0]["id"] == 1
        assert result[-1]["id"] == 15

    @patch('backfill_historical_prices.supabase')
    def test_fetch_products_paginated_empty_response(self, mock_supabase):
        """Should handle empty response"""
        mock_response = MagicMock()
        mock_response.data = []
        mock_supabase.table.return_value.select.return_value.range.return_value.execute.return_value = mock_response

        from backfill_historical_prices import fetch_products_paginated

        result = fetch_products_paginated()

        assert result == []

    @patch('backfill_historical_prices.supabase')
    def test_fetch_products_paginated_custom_batch_size(self, mock_supabase):
        """Should use custom batch size"""
        mock_response = MagicMock()
        mock_response.data = [{"id": 1}]
        mock_chain = mock_supabase.table.return_value.select.return_value.range.return_value
        mock_chain.execute.return_value = mock_response

        from backfill_historical_prices import fetch_products_paginated

        fetch_products_paginated(batch_size=100)

        # Verify range was called with correct parameters (0, 99 for batch_size=100)
        mock_supabase.table.return_value.select.return_value.range.assert_called_with(0, 99)

    @patch('backfill_historical_prices.supabase')
    def test_fetch_products_paginated_stops_at_last_page(self, mock_supabase):
        """Should stop pagination when receiving less than batch_size"""
        # First batch returns exactly batch_size items
        batch1 = [{"id": i} for i in range(5)]
        # Second batch returns fewer items (last page)
        batch2 = [{"id": i} for i in range(5, 8)]

        responses = [MagicMock(data=batch1), MagicMock(data=batch2)]
        mock_supabase.table.return_value.select.return_value.range.return_value.execute.side_effect = responses

        from backfill_historical_prices import fetch_products_paginated

        result = fetch_products_paginated(batch_size=5)

        assert len(result) == 8


class TestBatchInsertPriceHistory:
    """Tests for batch_insert_price_history function in backfill_historical_prices.py"""

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_price_history_success(self, mock_supabase):
        """Should batch insert entries successfully"""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        from backfill_historical_prices import batch_insert_price_history

        entries = [
            {"product_id": 1, "usd_price": 10.0, "recorded_at": "2024-12-01 12:00:00"},
            {"product_id": 2, "usd_price": 20.0, "recorded_at": "2024-12-01 12:00:00"},
        ]

        inserted, failed = batch_insert_price_history(entries, batch_size=10)

        assert inserted == 2
        assert failed == 0

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_price_history_multiple_batches(self, mock_supabase):
        """Should split into multiple batches"""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        from backfill_historical_prices import batch_insert_price_history

        entries = [{"product_id": i, "usd_price": i * 10.0} for i in range(15)]

        inserted, failed = batch_insert_price_history(entries, batch_size=5)

        assert inserted == 15
        assert failed == 0
        # Should have been called 3 times (5, 5, 5)
        assert mock_supabase.table.return_value.insert.call_count == 3

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_price_history_empty_entries(self, mock_supabase):
        """Should handle empty entries list"""
        from backfill_historical_prices import batch_insert_price_history

        inserted, failed = batch_insert_price_history([], batch_size=10)

        assert inserted == 0
        assert failed == 0
        mock_supabase.table.return_value.insert.assert_not_called()

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_price_history_fallback_on_batch_failure(self, mock_supabase):
        """Should fall back to individual inserts when batch fails"""
        # First batch fails, individual inserts succeed
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = [
            Exception("Batch failed"),  # First batch fails
            MagicMock(),  # Individual insert 1
            MagicMock(),  # Individual insert 2
            MagicMock(),  # Individual insert 3
        ]

        from backfill_historical_prices import batch_insert_price_history

        entries = [
            {"product_id": 1, "usd_price": 10.0},
            {"product_id": 2, "usd_price": 20.0},
            {"product_id": 3, "usd_price": 30.0},
        ]

        inserted, failed = batch_insert_price_history(entries, batch_size=10)

        assert inserted == 3
        assert failed == 0

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_price_history_individual_failure(self, mock_supabase):
        """Should count individual failures after batch failure"""
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = [
            Exception("Batch failed"),
            MagicMock(),  # First individual succeeds
            Exception("Individual failed"),  # Second individual fails
        ]

        from backfill_historical_prices import batch_insert_price_history

        entries = [
            {"product_id": 1, "usd_price": 10.0},
            {"product_id": 2, "usd_price": 20.0},
        ]

        inserted, failed = batch_insert_price_history(entries, batch_size=10)

        assert inserted == 1
        assert failed == 1


class TestFetchProductsNeedingUpdate:
    """Tests for fetch_products_needing_update function in main.py"""

    @patch('main.supabase')
    def test_fetch_products_needing_update_single_batch(self, mock_supabase):
        """Should fetch products needing updates in single batch"""
        mock_response = MagicMock()
        mock_response.data = [
            {"id": 1, "url": "https://example.com/1", "usd_price": None},
            {"id": 2, "url": "https://example.com/2", "last_updated": None},
        ]
        mock_supabase.table.return_value.select.return_value.or_.return_value.range.return_value.execute.return_value = mock_response

        from main import fetch_products_needing_update

        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

        result = fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago)

        assert len(result) == 2

    @patch('main.supabase')
    def test_fetch_products_needing_update_multiple_batches(self, mock_supabase):
        """Should paginate through multiple batches"""
        batch1 = [{"id": i} for i in range(1, 501)]  # 500 items
        batch2 = [{"id": i} for i in range(501, 601)]  # 100 items

        responses = [MagicMock(data=batch1), MagicMock(data=batch2)]
        mock_supabase.table.return_value.select.return_value.or_.return_value.range.return_value.execute.side_effect = responses

        from main import fetch_products_needing_update

        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

        result = fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago, batch_size=500)

        assert len(result) == 600

    @patch('main.supabase')
    def test_fetch_products_needing_update_empty_response(self, mock_supabase):
        """Should handle empty response"""
        mock_response = MagicMock()
        mock_response.data = []
        mock_supabase.table.return_value.select.return_value.or_.return_value.range.return_value.execute.return_value = mock_response

        from main import fetch_products_needing_update

        price_interval_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

        result = fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago)

        assert result == []

    @patch('main.supabase')
    def test_fetch_products_needing_update_or_filter_format(self, mock_supabase):
        """Should construct correct OR filter"""
        mock_response = MagicMock()
        mock_response.data = []
        mock_chain = mock_supabase.table.return_value.select.return_value.or_.return_value.range.return_value
        mock_chain.execute.return_value = mock_response

        from main import fetch_products_needing_update

        price_interval_ago = datetime(2024, 12, 15, 10, 0, 0, tzinfo=timezone.utc)
        twenty_four_hours_ago = datetime(2024, 12, 15, 10, 0, 0, tzinfo=timezone.utc)

        fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago)

        # Check that or_ was called with correct filter
        or_call = mock_supabase.table.return_value.select.return_value.or_
        assert or_call.called
        or_filter = or_call.call_args[0][0]
        assert "last_updated.is.null" in or_filter
        assert "usd_price.is.null" in or_filter
        assert "image_url.is.null" in or_filter


class TestFlushPriceHistoryBatch:
    """Tests for _flush_price_history_batch function in main.py"""

    @patch('main.supabase')
    def test_flush_price_history_batch_success(self, mock_supabase):
        """Should batch insert price history entries"""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        from main import _flush_price_history_batch

        batch = [
            {"product_id": 1, "usd_price": 10.0},
            {"product_id": 2, "usd_price": 20.0},
        ]

        success, failed = _flush_price_history_batch(batch)

        mock_supabase.table.assert_called_with("product_price_history")
        assert success == 2
        assert failed == 0

    @patch('main.supabase')
    def test_flush_price_history_batch_empty(self, mock_supabase):
        """Should handle empty batch"""
        from main import _flush_price_history_batch

        success, failed = _flush_price_history_batch([])

        assert success == 0
        assert failed == 0
        mock_supabase.table.return_value.insert.assert_not_called()

    @patch('main.supabase')
    def test_flush_price_history_batch_fallback_on_failure(self, mock_supabase):
        """Should fall back to individual inserts on batch failure"""
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = [
            Exception("Batch failed"),  # Batch fails
            MagicMock(),  # Individual 1
            MagicMock(),  # Individual 2
        ]

        from main import _flush_price_history_batch

        batch = [
            {"product_id": 1, "usd_price": 10.0},
            {"product_id": 2, "usd_price": 20.0},
        ]

        success, failed = _flush_price_history_batch(batch)

        # Should have called insert 3 times (1 batch + 2 individual)
        assert mock_supabase.table.return_value.insert.call_count == 3
        assert success == 2
        assert failed == 0

    @patch('main.supabase')
    def test_flush_price_history_batch_handles_individual_failure(self, mock_supabase):
        """Should handle individual insert failures gracefully"""
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = [
            Exception("Batch failed"),
            Exception("Individual 1 failed"),
            MagicMock(),  # Individual 2 succeeds
        ]

        from main import _flush_price_history_batch

        batch = [
            {"product_id": 1, "usd_price": 10.0},
            {"product_id": 2, "usd_price": 20.0},
        ]

        # Should not raise exception
        _flush_price_history_batch(batch)


class TestPaginationEdgeCases:
    """Edge case tests for pagination logic"""

    def test_pagination_offset_calculation(self):
        """Should calculate correct offset for pagination"""
        batch_size = 500

        # First page
        offset = 0
        assert (offset, offset + batch_size - 1) == (0, 499)

        # Second page
        offset = 500
        assert (offset, offset + batch_size - 1) == (500, 999)

        # Third page
        offset = 1000
        assert (offset, offset + batch_size - 1) == (1000, 1499)

    def test_batch_size_boundary(self):
        """Should handle batch at exactly batch_size"""
        batch_size = 100
        entries = list(range(100))

        # One full batch
        batches = []
        for i in range(0, len(entries), batch_size):
            batches.append(entries[i:i + batch_size])

        assert len(batches) == 1
        assert len(batches[0]) == 100

    def test_batch_size_plus_one(self):
        """Should split into two batches when entries is batch_size + 1"""
        batch_size = 100
        entries = list(range(101))

        batches = []
        for i in range(0, len(entries), batch_size):
            batches.append(entries[i:i + batch_size])

        assert len(batches) == 2
        assert len(batches[0]) == 100
        assert len(batches[1]) == 1


class TestCleanupDirectoryEdgeCases:
    """Edge case tests for directory cleanup"""

    def test_cleanup_directory_with_files(self):
        """Should clean up directory containing files"""
        from main import cleanup_driver

        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        # Create some files in the temp directory
        test_file = os.path.join(temp_dir, "test_file.txt")
        with open(test_file, "w") as f:
            f.write("test content")

        mock_driver = MagicMock()
        cleanup_driver(mock_driver, temp_dir)

        assert not os.path.exists(temp_dir)

    def test_cleanup_directory_with_subdirectories(self):
        """Should clean up directory containing subdirectories"""
        from main import cleanup_driver

        temp_dir = tempfile.mkdtemp(prefix="test_chrome_")

        # Create subdirectory with files
        sub_dir = os.path.join(temp_dir, "subdir")
        os.makedirs(sub_dir)
        test_file = os.path.join(sub_dir, "nested_file.txt")
        with open(test_file, "w") as f:
            f.write("nested content")

        mock_driver = MagicMock()
        cleanup_driver(mock_driver, temp_dir)

        assert not os.path.exists(temp_dir)


class TestBatchInsertReturnValues:
    """Tests for batch insert return value accuracy"""

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_returns_correct_counts_all_success(self, mock_supabase):
        """Should return correct counts when all succeed"""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        from backfill_historical_prices import batch_insert_price_history

        entries = [{"product_id": i} for i in range(25)]
        inserted, failed = batch_insert_price_history(entries, batch_size=10)

        # 25 entries, 3 batches (10, 10, 5)
        assert inserted == 25
        assert failed == 0

    @patch('backfill_historical_prices.supabase')
    def test_batch_insert_returns_correct_counts_partial_failure(self, mock_supabase):
        """Should return correct counts on partial failure"""
        # Batch 1 fails, falls back to individual (10 entries, all succeed)
        # Batch 2 succeeds (10 entries)
        # Batch 3 fails, falls back to individual (5 entries, 2 fail)
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = [
            Exception("Batch 1 failed"),
            *[MagicMock() for _ in range(10)],  # 10 individual successes
            MagicMock(),  # Batch 2 succeeds
            Exception("Batch 3 failed"),
            MagicMock(),  # Individual 1 succeeds
            Exception("Individual 2 fails"),
            MagicMock(),  # Individual 3 succeeds
            Exception("Individual 4 fails"),
            MagicMock(),  # Individual 5 succeeds
        ]

        from backfill_historical_prices import batch_insert_price_history

        entries = [{"product_id": i} for i in range(25)]
        inserted, failed = batch_insert_price_history(entries, batch_size=10)

        # 10 (from batch 1 fallback) + 10 (batch 2) + 3 (from batch 3 fallback)
        assert inserted == 23
        assert failed == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
