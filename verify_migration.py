#!/usr/bin/env python3
"""
Check that a migration is actually deployed, rather than reported as deployed.

    python verify_migration.py migrations/0023_price_freshness_guard.sql

Prints one SQL statement. Run it against the database — Supabase SQL editor,
psql, or an agent's execute_sql — and it returns a row per object with
status OK / MISMATCH / MISSING. Nothing to eyeball and nothing to interpret.

WHY THIS EXISTS
---------------
On 2026-08-13 a migration was applied twice through the Supabase SQL editor
and reported success both times, while the database kept running an earlier
revision of the same file. Nothing surfaced it: the editor said OK, the
migration ledger gained rows, and the functions were present and working —
just not the versions in the repo. It was caught only by reading
pg_get_functiondef by hand and noticing a clause was missing.

The editor runs *the selected text* when there is a selection, so a stray
click before Run silently applies a fragment. Preferring MCP apply_migration
avoids that particular trap, but no apply path proves the result matches
intent. This does.

HOW IT COMPARES
---------------
Postgres stores a function body verbatim in pg_proc.prosrc, so the body in the
file and the body in the database are directly comparable — but only after
normalising, because the same logic is routinely applied with reworded
comments or different indentation. Both sides are stripped of -- comments,
collapsed to single spaces, lowercased, and hashed. That ignores cosmetic
drift and catches a missing clause. Verified byte-identical between Python and
Postgres on 0023.

WHAT IT DOES NOT COVER
----------------------
Function bodies and index existence. GRANT, ALTER FUNCTION ... SET, and data
migrations are not checked — a DROP+CREATE silently discards the ACL and the
search_path pin, so verify those separately when a migration drops a function.
"""

from __future__ import annotations

import hashlib
import re
import sys


# Comments and layout change without changing behaviour; a clause does not.
NORMALIZE_SQL = (
    "md5(lower(btrim(regexp_replace(regexp_replace("
    "{col}, '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g'))))"
)


def normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", sql)).strip().lower()


def body_md5(body: str) -> str:
    return hashlib.md5(normalize(body).encode()).hexdigest()


def parse_functions(sql: str) -> list[tuple[str, str]]:
    """(function_name, expected_body_md5) for every function the file defines."""
    pattern = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\("
        r".*?AS\s+\$\$(.*?)\$\$\s*;",
        re.S | re.I,
    )
    return [(m.group(1), body_md5(m.group(2))) for m in pattern.finditer(sql)]


def parse_indexes(sql: str) -> list[str]:
    pattern = re.compile(
        r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"
        r"(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\b",
        re.I,
    )
    return [m.group(1) for m in pattern.finditer(sql)]


def build_query(functions, indexes) -> str:
    parts = []
    if functions:
        values = ",\n    ".join(
            f"('{name}', '{digest}')" for name, digest in functions
        )
        parts.append(f"""fn_expected(name, want) AS (
  VALUES
    {values}
),
fn_actual AS (
  SELECT p.proname AS name,
         {NORMALIZE_SQL.format(col='p.prosrc')} AS got
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
fn_check AS (
  SELECT 'function' AS kind, e.name,
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn_actual a WHERE a.name = e.name)
                THEN 'MISSING'
              WHEN EXISTS (SELECT 1 FROM fn_actual a
                            WHERE a.name = e.name AND a.got = e.want)
                THEN 'OK'
              ELSE 'MISMATCH' END AS status
  FROM fn_expected e
)""")
    if indexes:
        values = ", ".join(f"('{n}')" for n in indexes)
        parts.append(f"""ix_check AS (
  SELECT 'index' AS kind, v.name,
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes i
                            WHERE i.schemaname = 'public'
                              AND i.indexname = v.name)
              THEN 'OK' ELSE 'MISSING' END AS status
  FROM (VALUES {values}) AS v(name)
)""")

    selects = []
    if functions:
        selects.append("SELECT * FROM fn_check")
    if indexes:
        selects.append("SELECT * FROM ix_check")

    return ("WITH " + ",\n".join(parts) + "\n" +
            "\nUNION ALL\n".join(selects) +
            "\nORDER BY status DESC, kind, name;")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    functions: list[tuple[str, str]] = []
    indexes: list[str] = []
    for path in argv[1:]:
        try:
            with open(path) as f:
                sql = f.read()
        except OSError as exc:
            print(f"! cannot read {path}: {exc}", file=sys.stderr)
            return 2
        functions += parse_functions(sql)
        indexes += parse_indexes(sql)

    if not functions and not indexes:
        print("! no CREATE FUNCTION or CREATE INDEX found; nothing to verify.",
              file=sys.stderr)
        return 2

    for name, digest in functions:
        print(f"-- function {name}: expecting normalized body md5 {digest}",
              file=sys.stderr)
    for name in indexes:
        print(f"-- index {name}: expecting it to exist", file=sys.stderr)
    print("-- run the statement below; every row must say OK\n",
          file=sys.stderr)

    print(build_query(functions, indexes))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
