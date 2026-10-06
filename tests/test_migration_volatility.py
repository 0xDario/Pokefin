"""
Static guard: no function may be left non-volatile while its body writes.

Postgres rejects INSERT / UPDATE / DELETE inside a STABLE or IMMUTABLE
function at call time ("INSERT is not allowed in a non-volatile function"),
never at CREATE time, so a migration can apply cleanly and still ship a
function that fails on every call. That is how export_my_data() broke in
0011 (fixed by 0024, finding F020).

Only the EFFECTIVE definition of each function is checked: the last one in
apply order. A superseded definition (0011's STABLE export_my_data) is
history, not live code.

Run with: python -m pytest tests/test_migration_volatility.py -v
"""
import os
import re
from pathlib import Path

import pytest

MIGRATIONS = Path(os.environ.get("POKEFIN_MIGRATIONS_DIR",
                                 Path(__file__).resolve().parent.parent / "migrations"))

# Out-of-band files that must be applied BEFORE the numbered ones
# (README.md, "The ordering constraints that matter").
EARLY_FILES = ("create_box_recipes.sql", "20260506_market_performance_functions.sql")

FUNC_HEAD = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.\"]+)\s*\(", re.I)
DOLLAR_AS = re.compile(r"\bAS\s+(\$[A-Za-z_]*\$)", re.I)
VOLATILITY = re.compile(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", re.I)
WRITES = re.compile(
    r"\b(INSERT\s+INTO|UPDATE\s+[\w.\"]+\s+SET|DELETE\s+FROM)\b", re.I)
LINE_COMMENT = re.compile(r"--[^\n]*")


def apply_order():
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    early = [f for f in EARLY_FILES if f in files]
    return early + [f for f in files if f not in early]


def effective_functions():
    """Map function name -> (file, volatility, body) for the last definition."""
    found = {}
    for name in apply_order():
        sql = (MIGRATIONS / name).read_text()
        for head in FUNC_HEAD.finditer(sql):
            fn = head.group(1).lower().replace('"', "")
            if "." not in fn:
                fn = "public." + fn
            as_match = DOLLAR_AS.search(sql, head.end())
            if not as_match:
                continue  # SQL-standard RETURN body; not used in this repo
            tag = as_match.group(1)
            body_start = as_match.end()
            body_end = sql.find(tag, body_start)
            assert body_end != -1, f"{name}: unterminated body for {fn}"
            # Volatility may sit before AS (header) or after the closing tag.
            header = sql[head.end():as_match.start()]
            trailer_end = sql.find(";", body_end + len(tag))
            trailer = sql[body_end + len(tag):trailer_end]
            vol = VOLATILITY.search(LINE_COMMENT.sub("", header + " " + trailer))
            volatility = vol.group(1).upper() if vol else "VOLATILE"
            body = LINE_COMMENT.sub("", sql[body_start:body_end])
            found[fn] = (name, volatility, body)
    return found


def test_migrations_directory_found():
    assert MIGRATIONS.is_dir(), MIGRATIONS
    assert any(MIGRATIONS.glob("*.sql"))


def test_export_my_data_is_volatile():
    fns = effective_functions()
    assert "public.export_my_data" in fns
    name, volatility, _ = fns["public.export_my_data"]
    assert volatility == "VOLATILE", (
        f"export_my_data is {volatility} in {name}; it INSERTs an audit row "
        "and must be VOLATILE")


@pytest.mark.parametrize("fn", sorted(effective_functions()))
def test_writing_functions_are_volatile(fn):
    name, volatility, body = effective_functions()[fn]
    if volatility == "VOLATILE":
        return
    write = WRITES.search(body)
    assert write is None, (
        f"{fn} (last defined in {name}) is {volatility} but its body runs "
        f"'{write.group(0)}'. Postgres rejects that at call time.")
