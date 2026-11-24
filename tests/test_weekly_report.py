#!/usr/bin/env python3
"""
Unit tests for the weekly report's table markup in generate_weekly_report.py

These tests cover:
- build_html(...): every body row matches its header, cell for cell

Run with: python -m pytest tests/test_weekly_report.py -v
"""
import sys
from datetime import date
from html.parser import HTMLParser
from unittest.mock import MagicMock

# Mock external dependencies before importing the generator
sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'

import generate_weekly_report as report  # noqa: E402


class _Tables(HTMLParser):
    """Collect each table as rows of (tag, is_text_column) cells."""

    def __init__(self):
        super().__init__()
        self.tables = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr":
            self.tables[-1].append([])
        elif tag in ("th", "td"):
            classes = (dict(attrs).get("class") or "").split()
            self.tables[-1][-1].append((tag, "txt" in classes))


def _category(name, n_1y=4):
    return {"category": name, "n": 120,
            "1m": 1.2, "n_1m": 120, "3m": -0.2, "n_3m": 61,
            "6m": 11.0, "n_6m": 8, "1y": None, "n_1y": n_1y}


def _product(window):
    return {"set_name": "Roaring Skies", "category": "Elite Trainer Box",
            "variant": None, "end_price": 7900.0, window: 187.0}


def _render():
    cats = [_category("ex Box"), _category("Booster Pack")]
    sets_rows = [
        {"set_name": "Evolutions", "release_date": "2016-11-02",
         "avg_3m": 14.0, "avg_6m": 35.0, "avg_1y": 62.0},
        {"set_name": "Pokemon GO", "release_date": None,
         "avg_3m": None, "avg_6m": 21.0, "avg_1y": None},
    ]
    tops = {"1y": [_product("1y")], "6m": [_product("6m")]}
    meta = {"n_products": 305, "n_sets": 65, "n_obs": 167632,
            "earliest": "Feb 3, 2025", "excluded": 5}
    return report.build_html(date(2026, 11, 20), [], cats, sets_rows, tops, meta)


def test_body_rows_match_their_header():
    """A cell that is missing, extra or aligned unlike its header shifts the
    figures out from under their labels."""
    parser = _Tables()
    parser.feed(_render())

    assert len(parser.tables) == 4
    for table in parser.tables:
        header, *body = table
        assert body
        for row in body:
            assert len(row) == len(header)
            assert [txt for _, txt in row] == [txt for _, txt in header]


def test_count_slot_fits_widest_sample_size():
    assert 'style="--n-digits:3;"' in _render()
