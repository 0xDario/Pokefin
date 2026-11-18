#!/usr/bin/env python3
"""
Unit tests for backfill_sales_volume.py range handling.

Run with: python -m pytest tests/test_backfill_sales_volume.py -v
"""
import sys
from unittest.mock import MagicMock, patch

# Mock external dependencies before importing the script
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'

with patch('supabase.create_client', return_value=MagicMock()):
    import backfill_sales_volume as bsv


def _bucket(date, qty="1"):
    return {"bucketStartDate": date, "quantitySold": qty, "transactionCount": qty,
            "lowSalePrice": "10", "highSalePrice": "12", "marketPrice": "11"}


def _payload(buckets):
    return {"result": [{"variant": "Normal", "language": "English", "buckets": buckets}]}


def _run(responses):
    """responses: dict range_key -> return value of fetch_price_history_json."""
    with patch.object(bsv, 'fetch_price_history_json',
                      side_effect=lambda session, product_id, range_key, **kw: responses[range_key]):
        return bsv.extract_sales_history_api("123", 7, session=MagicMock())


class TestExtractSalesHistoryApi:
    def test_both_ranges_with_buckets(self):
        rows, ok = _run({"annual": _payload([_bucket("2026-11-16")]),
                         "month": _payload([_bucket("2026-11-17")])})
        assert ok is True
        assert {r["granularity"] for r in rows} == {"week", "day"}

    def test_empty_month_result_is_complete_not_failure(self):
        """No sales in the last 30 days: TCGPlayer answers 200 with result []."""
        rows, ok = _run({"annual": _payload([_bucket("2026-10-12")]),
                         "month": {"result": []}})
        assert ok is True
        assert [r["granularity"] for r in rows] == ["week"]

    def test_empty_results_on_both_ranges_is_complete_with_no_rows(self):
        rows, ok = _run({"annual": {"result": []}, "month": {}})
        assert ok is True
        assert rows == []

    def test_failed_request_still_marks_incomplete(self):
        rows, ok = _run({"annual": _payload([_bucket("2026-11-16")]), "month": None})
        assert ok is False
        assert len(rows) == 1
