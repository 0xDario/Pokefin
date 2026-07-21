#!/usr/bin/env python3
"""
Unit tests for the sales-volume tracking additions in main.py

These tests cover:
- parse_daily_sales_buckets(buckets, product_id)
- fetch_latest_market_data_from_api(session, product_id, ...)
- fetch_listings_snapshot(session, tcgplayer_product_id, ...)
- _flush_sales_history_batch(batch)

Run with: python -m pytest tests/test_sales_volume.py -v
"""
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
import pytest

# Mock external dependencies before importing main
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'


def _make_response(status_code=200, json_data=None, json_raises=False):
    """Build a fake requests response."""
    response = MagicMock()
    response.status_code = status_code
    if json_raises:
        response.json.side_effect = ValueError("invalid json")
    else:
        response.json.return_value = json_data if json_data is not None else {}
    return response


class TestParseDailySalesBuckets:
    """Tests for parse_daily_sales_buckets function"""

    def test_parses_string_values_with_commas(self):
        """Should parse numeric strings containing commas"""
        from main import parse_daily_sales_buckets

        buckets = [{
            "bucketStartDate": "2026-07-05",
            "marketPrice": "1,147.24",
            "quantitySold": "1,234",
            "transactionCount": "3",
            "lowSalePrice": "1,099.87",
            "highSalePrice": "1,158.87",
        }]

        rows = parse_daily_sales_buckets(buckets, product_id=42)

        assert len(rows) == 1
        row = rows[0]
        assert row["product_id"] == 42
        assert row["bucket_date"] == "2026-07-05"
        assert row["granularity"] == "day"
        assert row["quantity_sold"] == 1234
        assert row["transaction_count"] == 3
        assert row["low_sale_price"] == 1099.87
        assert row["high_sale_price"] == 1158.87
        assert row["market_price"] == 1147.24

    def test_skips_bucket_with_missing_start_date(self):
        """Should skip buckets with a missing bucketStartDate"""
        from main import parse_daily_sales_buckets

        buckets = [
            {"marketPrice": "10.00", "quantitySold": "1"},  # no date
            {"bucketStartDate": "", "marketPrice": "10.00"},  # empty date
            {"bucketStartDate": "2026-07-04", "marketPrice": "10.00", "quantitySold": "2"},
        ]

        rows = parse_daily_sales_buckets(buckets, product_id=1)

        assert len(rows) == 1
        assert rows[0]["bucket_date"] == "2026-07-04"

    def test_skips_bucket_with_invalid_start_date(self):
        """Should skip buckets with an unparseable bucketStartDate"""
        from main import parse_daily_sales_buckets

        buckets = [
            {"bucketStartDate": "not-a-date", "marketPrice": "10.00"},
            {"bucketStartDate": "07/04/2026", "marketPrice": "10.00"},
        ]

        rows = parse_daily_sales_buckets(buckets, product_id=1)

        assert rows == []

    def test_negative_counts_become_none_zero_kept(self):
        """Negative counts should become None; zero counts are valid"""
        from main import parse_daily_sales_buckets

        buckets = [{
            "bucketStartDate": "2026-07-01",
            "quantitySold": "-3",
            "transactionCount": "0",
            "marketPrice": "10.00",
        }]

        rows = parse_daily_sales_buckets(buckets, product_id=1)

        assert len(rows) == 1
        assert rows[0]["quantity_sold"] is None
        assert rows[0]["transaction_count"] == 0

    def test_non_positive_prices_become_none(self):
        """Zero or negative prices should become None"""
        from main import parse_daily_sales_buckets

        buckets = [{
            "bucketStartDate": "2026-07-01",
            "quantitySold": "5",
            "marketPrice": "0",
            "lowSalePrice": "-1.50",
            "highSalePrice": "0.00",
        }]

        rows = parse_daily_sales_buckets(buckets, product_id=1)

        assert len(rows) == 1
        assert rows[0]["market_price"] is None
        assert rows[0]["low_sale_price"] is None
        assert rows[0]["high_sale_price"] is None
        assert rows[0]["quantity_sold"] == 5

    def test_malformed_numeric_values_become_none(self):
        """Unparseable numeric strings should become None, not skip the row"""
        from main import parse_daily_sales_buckets

        buckets = [{
            "bucketStartDate": "2026-07-01",
            "quantitySold": "abc",
            "transactionCount": None,
            "marketPrice": "n/a",
        }]

        rows = parse_daily_sales_buckets(buckets, product_id=1)

        assert len(rows) == 1
        assert rows[0]["quantity_sold"] is None
        assert rows[0]["transaction_count"] is None
        assert rows[0]["market_price"] is None

    def test_todays_partial_bucket_included(self):
        """Today's (partial) bucket should be included"""
        from main import parse_daily_sales_buckets

        today = datetime.now(timezone.utc).date().strftime("%Y-%m-%d")
        buckets = [{
            "bucketStartDate": today,
            "quantitySold": "3",
            "transactionCount": "3",
            "marketPrice": "147.24",
        }]

        rows = parse_daily_sales_buckets(buckets, product_id=7)

        assert len(rows) == 1
        assert rows[0]["bucket_date"] == today

    def test_empty_and_none_input(self):
        """Should return empty list for empty/None buckets"""
        from main import parse_daily_sales_buckets

        assert parse_daily_sales_buckets([], product_id=1) == []
        assert parse_daily_sales_buckets(None, product_id=1) == []


class TestFetchLatestMarketDataFromApi:
    """Tests for fetch_latest_market_data_from_api function"""

    def _api_payload(self, buckets):
        return {"result": [{"variant": "Normal", "language": "English", "buckets": buckets}]}

    def test_month_range_returns_price_and_daily_buckets(self):
        """When range=month succeeds, daily_buckets should be the raw buckets"""
        from main import fetch_latest_market_data_from_api

        buckets = [
            {"bucketStartDate": "2026-07-06", "marketPrice": "147.24", "quantitySold": "3"},
            {"bucketStartDate": "2026-07-05", "marketPrice": "145.00", "quantitySold": "1"},
        ]
        session = MagicMock()
        session.get.return_value = _make_response(200, self._api_payload(buckets))

        result = fetch_latest_market_data_from_api(session, "12345")

        assert result["price"] == 147.24
        assert result["daily_buckets"] == buckets
        # Only the first (month) range should have been requested
        assert session.get.call_count == 1
        assert "range=month" in session.get.call_args[0][0]

    def test_fallback_range_returns_price_but_no_daily_buckets(self):
        """When month fails and quarter succeeds, daily_buckets must be empty"""
        from main import fetch_latest_market_data_from_api

        quarter_buckets = [
            {"bucketStartDate": "2026-07-04", "marketPrice": "150.00"},
        ]
        session = MagicMock()
        session.get.side_effect = [
            _make_response(500),  # month fails
            _make_response(200, self._api_payload(quarter_buckets)),  # quarter succeeds
        ]

        result = fetch_latest_market_data_from_api(session, "12345")

        assert result["price"] == 150.00
        assert result["daily_buckets"] == []
        assert session.get.call_count == 2
        assert "range=quarter" in session.get.call_args_list[1][0][0]

    def test_month_result_without_valid_price_falls_through(self):
        """When month has no usable price, later ranges are tried and daily_buckets stay empty"""
        from main import fetch_latest_market_data_from_api

        session = MagicMock()
        session.get.side_effect = [
            _make_response(200, self._api_payload([
                {"bucketStartDate": "2026-07-06", "marketPrice": "0"},  # non-positive
            ])),
            _make_response(200, self._api_payload([
                {"bucketStartDate": "2026-07-04", "marketPrice": "99.99"},
            ])),
        ]

        result = fetch_latest_market_data_from_api(session, "12345")

        assert result["price"] == 99.99
        assert result["daily_buckets"] == []

    def test_all_ranges_fail_returns_empty(self):
        """When every range fails, price is None and daily_buckets empty"""
        from main import fetch_latest_market_data_from_api

        session = MagicMock()
        session.get.return_value = _make_response(403)

        result = fetch_latest_market_data_from_api(session, "12345")

        assert result == {"price": None, "daily_buckets": []}
        assert session.get.call_count == 4  # month, quarter, semi-annual, annual

    def test_missing_product_id_returns_empty(self):
        """Should return empty result for a falsy product id"""
        from main import fetch_latest_market_data_from_api

        session = MagicMock()

        result = fetch_latest_market_data_from_api(session, None)

        assert result == {"price": None, "daily_buckets": []}
        session.get.assert_not_called()


class TestFetchListingsSnapshot:
    """Tests for fetch_listings_snapshot function"""

    def _listings_payload(self, total_results=48, quantity_agg=None, listings=None):
        top = {
            "totalResults": total_results,
            "results": listings if listings is not None else [
                {"price": 157.0, "shippingPrice": 2.0, "quantity": 1.0},
            ],
            "aggregations": {},
        }
        if quantity_agg is not None:
            top["aggregations"]["quantity"] = quantity_agg
        return {"results": [top]}

    def test_parses_snapshot_with_quantity_aggregation(self):
        """Should sum round(value) * round(count) over the quantity aggregation"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(200, self._listings_payload(
            total_results=48,
            quantity_agg=[
                {"value": 1, "count": 30.0},
                {"value": 2, "count": 9.0},
            ],
        ))

        snapshot = fetch_listings_snapshot(session, "12345")

        assert snapshot is not None
        assert snapshot["active_listings"] == 48
        assert snapshot["total_quantity_available"] == 48  # 1*30 + 2*9
        assert snapshot["lowest_listing_price"] == 157.0

    def test_request_payload_asks_for_quantity_and_scopes_language(self):
        """The quantity aggregation must be requested explicitly (it feeds
        total_quantity_available), and a preferred language must scope the
        term filters so multi-language product ids don't mix markets."""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(200, self._listings_payload())

        fetch_listings_snapshot(session, "12345", preferred_language="English")

        payload = session.post.call_args.kwargs["json"]
        assert "quantity" in payload["aggregations"]
        assert payload["filters"]["term"]["language"] == ["English"]

        # Without a preferred language, no language filter is applied.
        session.post.reset_mock()
        session.post.return_value = _make_response(200, self._listings_payload())
        fetch_listings_snapshot(session, "12345")
        payload = session.post.call_args.kwargs["json"]
        assert "language" not in payload["filters"]["term"]

    def test_missing_quantity_aggregation_gives_none(self):
        """Missing quantity aggregation should give total_quantity_available=None"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(200, self._listings_payload(
            total_results=10,
            quantity_agg=None,
        ))

        snapshot = fetch_listings_snapshot(session, "12345")

        assert snapshot is not None
        assert snapshot["active_listings"] == 10
        assert snapshot["total_quantity_available"] is None
        assert snapshot["lowest_listing_price"] == 157.0

    def test_no_listing_results_gives_none_price(self):
        """Empty inner results should give lowest_listing_price=None"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(200, self._listings_payload(
            total_results=0,
            quantity_agg=[],
            listings=[],
        ))

        snapshot = fetch_listings_snapshot(session, "12345")

        assert snapshot is not None
        assert snapshot["active_listings"] == 0
        assert snapshot["total_quantity_available"] is None
        assert snapshot["lowest_listing_price"] is None

    def test_non_200_returns_none(self):
        """Non-200 response should return None"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(403)

        assert fetch_listings_snapshot(session, "12345") is None

    def test_json_parse_failure_returns_none(self):
        """JSON decode failure should return None, not raise"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.return_value = _make_response(200, json_raises=True)

        assert fetch_listings_snapshot(session, "12345") is None

    def test_request_exception_returns_none(self):
        """A request exception should return None, not raise"""
        from main import fetch_listings_snapshot

        session = MagicMock()
        session.post.side_effect = Exception("connection reset")

        assert fetch_listings_snapshot(session, "12345") is None

    def test_missing_tcgplayer_product_id_returns_none(self):
        """Falsy product id should return None without a request"""
        from main import fetch_listings_snapshot

        session = MagicMock()

        assert fetch_listings_snapshot(session, None) is None
        session.post.assert_not_called()


class TestFlushSalesHistoryBatch:
    """Tests for _flush_sales_history_batch function"""

    @patch('main.supabase')
    def test_flush_sales_history_batch_success(self, mock_supabase):
        """Should batch upsert sales history entries with the right on_conflict"""
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()

        from main import _flush_sales_history_batch

        batch = [
            {"product_id": 1, "bucket_date": "2026-07-05", "granularity": "day", "quantity_sold": 3},
            {"product_id": 1, "bucket_date": "2026-07-06", "granularity": "day", "quantity_sold": 1},
        ]

        success, failed = _flush_sales_history_batch(batch)

        assert success == 2
        assert failed == 0
        mock_supabase.table.assert_called_with("product_sales_history")
        mock_supabase.table.return_value.upsert.assert_called_once_with(
            batch, on_conflict="product_id,bucket_date,granularity"
        )

    @patch('main.supabase')
    def test_flush_sales_history_batch_empty(self, mock_supabase):
        """Should handle empty batch"""
        from main import _flush_sales_history_batch

        success, failed = _flush_sales_history_batch([])

        assert success == 0
        assert failed == 0
        mock_supabase.table.return_value.upsert.assert_not_called()

    @patch('main.supabase')
    def test_flush_sales_history_batch_fallback_on_failure(self, mock_supabase):
        """Should fall back to individual upserts on batch failure"""
        mock_supabase.table.return_value.upsert.return_value.execute.side_effect = [
            Exception("Batch failed"),  # Batch fails
            MagicMock(),  # Individual 1
            MagicMock(),  # Individual 2
        ]

        from main import _flush_sales_history_batch

        batch = [
            {"product_id": 1, "bucket_date": "2026-07-05", "granularity": "day"},
            {"product_id": 1, "bucket_date": "2026-07-06", "granularity": "day"},
        ]

        success, failed = _flush_sales_history_batch(batch)

        # 1 batch attempt + 2 individual upserts
        assert mock_supabase.table.return_value.upsert.call_count == 3
        assert success == 2
        assert failed == 0

    @patch('main.supabase')
    def test_flush_sales_history_batch_counts_individual_failures(self, mock_supabase):
        """Should count individual failures after batch failure and never raise"""
        mock_supabase.table.return_value.upsert.return_value.execute.side_effect = [
            Exception("Batch failed"),
            Exception("Individual 1 failed"),
            MagicMock(),  # Individual 2 succeeds
        ]

        from main import _flush_sales_history_batch

        batch = [
            {"product_id": 1, "bucket_date": "2026-07-05", "granularity": "day"},
            {"product_id": 1, "bucket_date": "2026-07-06", "granularity": "day"},
        ]

        success, failed = _flush_sales_history_batch(batch)

        assert success == 1
        assert failed == 1


class TestFlushListingsHistoryBatch:
    """Tests for _flush_listings_history_batch function"""

    @patch('main.supabase')
    def test_flush_listings_history_batch_success(self, mock_supabase):
        """Should batch upsert listings snapshots with the right on_conflict"""
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()

        from main import _flush_listings_history_batch

        batch = [
            {"product_id": 1, "snapshot_date": "2026-07-06", "active_listings": 48},
        ]

        success, failed = _flush_listings_history_batch(batch)

        assert success == 1
        assert failed == 0
        mock_supabase.table.assert_called_with("product_listings_history")
        mock_supabase.table.return_value.upsert.assert_called_once_with(
            batch, on_conflict="product_id,snapshot_date"
        )

    @patch('main.supabase')
    def test_flush_listings_history_batch_fallback_never_raises(self, mock_supabase):
        """Should fall back per row and never raise"""
        mock_supabase.table.return_value.upsert.return_value.execute.side_effect = [
            Exception("Batch failed"),
            Exception("Individual failed"),
        ]

        from main import _flush_listings_history_batch

        batch = [{"product_id": 1, "snapshot_date": "2026-07-06"}]

        success, failed = _flush_listings_history_batch(batch)

        assert success == 0
        assert failed == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
