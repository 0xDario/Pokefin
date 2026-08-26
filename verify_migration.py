#!/usr/bin/env python3
"""
Check that a migration is actually deployed, rather than reported as deployed.

    python verify_migration.py migrations/0023_price_freshness_guard.sql

Prints one SQL statement. Run it against the database — Supabase SQL editor,
psql, or an agent's execute_sql — and it returns a row per object with status
OK / MISMATCH / MISSING and, when something differs, which facet differs.
Nothing to eyeball and nothing to interpret.

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

WHAT IT COMPARES
----------------
Functions, by five facets, because a body alone is not a function:

  body         Postgres stores it verbatim in pg_proc.prosrc, so the file and
               the database are directly comparable — after normalising, since
               the same logic is routinely reapplied with reworded comments or
               different indentation. Both sides are stripped of -- comments,
               collapsed to single spaces, lowercased, and hashed. That ignores
               cosmetic drift and catches a missing clause. Verified
               byte-identical between Python and Postgres on 0023.
  security     prosecdef. A DROP+CREATE discards SECURITY DEFINER, and an auth
               trigger that quietly became SECURITY INVOKER has an identical
               body and no privileges — the exact shape of drift that reads as
               working until it matters.
  config       proconfig, i.e. the SET search_path pin. Discarded by the same
               DROP+CREATE, and unpinned search_path on a SECURITY DEFINER
               function is a privilege-escalation vector, not a nicety.
  volatility   IMMUTABLE / STABLE / VOLATILE. Wrong here is a planner and
               caching decision, silently.
  arg count    pronargs, which also picks the right overload to compare
               against.

Indexes, by definition rather than by name: CREATE INDEX IF NOT EXISTS is a
no-op against an index that already holds the name with different columns, so
name-only presence certifies precisely the drift worth catching. The columns,
ordering, method, uniqueness, partial predicate and validity are all compared —
an index left INVALID by an interrupted CONCURRENTLY build exists, is named
correctly, and is ignored by the planner.

WHAT IT DOES NOT COVER
----------------------
GRANT and REVOKE — a DROP+CREATE discards the ACL too, so check those
separately when a migration drops a function. Return types and argument names
(only the count), triggers, RLS policies, constraints and data migrations.
Comparison is deliberately blind to formatting, which costs a little
precision inside string literals: it is case-insensitive, and it removes
whitespace next to parens and commas, so a change confined to the case or the
internal spacing of a literal is invisible. Parenthesisation is normalised out
of index definitions, so regrouping a partial index predicate without changing
its text is too.

An expectation comes from the file you pass. If a *later* migration alters an
object, verify against that later file — this reports drift from the file it
was given, which is the question it was asked.
"""

from __future__ import annotations

import hashlib
import re
import sys


# Comments and layout change without changing behaviour; a clause does not.
# The space in "jsonb_build_object( 'id'," is the kind of difference a
# reformat introduces and a review would never call a change, so collapsing
# runs of whitespace is not enough on its own — space adjacent to a paren or
# comma has to go too, or the verifier cries wolf on migrations that are
# deployed exactly as written.
NORMALIZE_BODY_SQL = (
    "md5(lower(btrim(regexp_replace(regexp_replace(regexp_replace("
    "{col}, '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g'), "
    "'\\s*([(),])\\s*', '\\1', 'g'))))"
)

# pg_get_indexdef renders a canonical form that differs from any hand-written
# CREATE INDEX in spacing, schema qualification and implicit ASC/NULLS. Strip
# the preamble and every space and paren from both sides so what remains is the
# part that carries meaning: method, columns, ordering, predicate.
NORMALIZE_INDEX_SQL = (
    "regexp_replace(regexp_replace(lower(pg_get_indexdef(i.indexrelid)), "
    "'^create (unique )?index [^ ]+ on [^ ]+ ', ''), '[\\s()]', '', 'g')"
)

VOLATILITY = {"immutable": "i", "stable": "s", "volatile": "v"}


def sql_str(value) -> str:
    """A SQL literal, or NULL for a facet the file does not assert."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def normalize(sql: str) -> str:
    """The Python half of NORMALIZE_BODY_SQL; the two must agree exactly."""
    stripped = re.sub(r"--[^\n]*", "", sql)
    collapsed = re.sub(r"\s+", " ", stripped)
    return re.sub(r"\s*([(),])\s*", r"\1", collapsed).strip().lower()


def strip_layout(text: str) -> str:
    return re.sub(r"[\s()]", "", text.lower())


def split_top_level(text: str) -> list[str]:
    """Split on commas that are not inside parentheses — NUMERIC(10,2)."""
    parts, depth, current = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if "".join(current).strip():
        parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def canon_index_columns(cols: str) -> str:
    """
    Drop what Postgres never prints back, so both sides agree.

    ASC is the default and is never rendered; NULLS LAST is the default under
    ASC and NULLS FIRST under DESC, so each is rendered only when it is the
    exception.
    """
    out = []
    for col in split_top_level(cols):
        col = re.sub(r"\s+", " ", col.strip().lower())
        col = re.sub(r"\basc\b", "", col).strip()
        if re.search(r"\bdesc\b", col):
            col = re.sub(r"\bnulls first\b", "", col)
        else:
            col = re.sub(r"\bnulls last\b", "", col)
        out.append(re.sub(r"\s+", " ", col).strip())
    return ", ".join(out)


def count_args(arglist: str) -> int:
    """pronargs: declared IN/INOUT/VARIADIC arguments, defaults included."""
    return len(split_top_level(arglist))


def parse_functions(sql: str) -> list[dict]:
    """Every function the file defines, with the facets it asserts."""
    pattern = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(",
        re.I,
    )
    found = []
    for match in pattern.finditer(sql):
        # Walk the argument list by depth; a default like NUMERIC(10,2) or
        # now() - interval '1 day' nests parentheses inside it.
        depth, i = 1, match.end()
        while i < len(sql) and depth:
            depth += (sql[i] == "(") - (sql[i] == ")")
            i += 1
        arglist = sql[match.end():i - 1]

        body_match = re.compile(r"AS\s+\$\$(.*?)\$\$\s*;", re.S | re.I).search(sql, i)
        if not body_match:
            continue
        header = sql[i:body_match.start()]

        lang = re.search(r"\bLANGUAGE\s+(\w+)", header, re.I)
        volatile = re.search(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", header, re.I)
        config = re.findall(r"\bSET\s+(\w+)\s*=\s*([^\n;]+)", header, re.I)

        found.append({
            "name": match.group(1),
            "body": hashlib.md5(normalize(body_match.group(1)).encode()).hexdigest(),
            "secdef": bool(re.search(r"\bSECURITY\s+DEFINER\b", header, re.I)),
            "lang": lang.group(1).lower() if lang else None,
            "volatile": VOLATILITY[volatile.group(1).lower()] if volatile else "v",
            "config": [f"{k.lower()}={v.strip().rstrip(';')}" for k, v in config],
            "nargs": count_args(arglist),
            "end": body_match.end(),
        })

    # A trailing ALTER FUNCTION ... SET is how most of these migrations pin
    # search_path; the pin belongs to the function whether it was applied in
    # the CREATE or after it.
    for alter in re.finditer(
        r"ALTER\s+FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*"
        r"((?:\s*SET\s+\w+\s*=\s*[^\n;]+)+);",
        sql, re.I,
    ):
        for key, value in re.findall(r"SET\s+(\w+)\s*=\s*([^\n;]+)", alter.group(2), re.I):
            for fn in found:
                if fn["name"].lower() == alter.group(1).lower():
                    entry = f"{key.lower()}={value.strip().rstrip(';')}"
                    if entry not in fn["config"]:
                        fn["config"].append(entry)
    for fn in found:
        fn.pop("end", None)
        fn["config"] = strip_layout(",".join(fn["config"])) or None
    return found


def parse_indexes(sql: str) -> list[dict]:
    pattern = re.compile(
        r"CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"
        r"(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?(\w+)\s*"
        r"(?:USING\s+(\w+)\s*)?\(",
        re.I,
    )
    found = []
    for match in pattern.finditer(sql):
        depth, i = 1, match.end()
        while i < len(sql) and depth:
            depth += (sql[i] == "(") - (sql[i] == ")")
            i += 1
        cols = sql[match.end():i - 1]
        tail = sql[i:sql.find(";", i)]
        where = re.search(r"\bWHERE\b(.*)$", tail, re.S | re.I)

        definition = f"using {(match.group(4) or 'btree').lower()} ({canon_index_columns(cols)})"
        if where:
            definition += f" where {re.sub(r'\s+', ' ', where.group(1)).strip()}"
        found.append({
            "name": match.group(2),
            "table": match.group(3).lower(),
            "unique": bool(match.group(1)),
            "definition": strip_layout(definition),
        })
    return found


def build_query(functions: list[dict], indexes: list[dict]) -> str:
    parts, selects = [], []

    if functions:
        values = ",\n    ".join(
            "({}, {}, {}, {}, {}, {}, {})".format(
                sql_str(f["name"]), sql_str(f["body"]), sql_str(f["secdef"]),
                sql_str(f["lang"]), sql_str(f["volatile"]), sql_str(f["config"]),
                sql_str(f["nargs"]),
            )
            for f in functions
        )
        parts.append(f"""fn_expected(name, body, secdef, lang, volatile, config, nargs) AS (
  VALUES
    {values}
),
fn_actual AS (
  SELECT p.proname AS name,
         {NORMALIZE_BODY_SQL.format(col='p.prosrc')} AS body,
         p.prosecdef AS secdef,
         l.lanname::text AS lang,
         p.provolatile::text AS volatile,
         nullif(regexp_replace(lower(array_to_string(p.proconfig, ',')),
                               '[[:space:]()]', '', 'g'), '') AS config,
         p.pronargs::int AS nargs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
),
fn_check AS (
  SELECT 'function' AS kind, e.name::text AS name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.body = e.body
               AND a.secdef = e.secdef
               AND a.volatile = e.volatile
               AND a.nargs = e.nargs
               AND a.config IS NOT DISTINCT FROM e.config
               AND (e.lang IS NULL OR a.lang = e.lang)
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.name IS NOT NULL AND a.body IS DISTINCT FROM e.body
                THEN 'body' END,
           CASE WHEN a.secdef IS DISTINCT FROM e.secdef
                THEN 'security (want ' || CASE WHEN e.secdef THEN 'definer'
                                               ELSE 'invoker' END || ')' END,
           CASE WHEN a.config IS DISTINCT FROM e.config
                THEN 'config (want ' || coalesce(e.config, 'none')
                     || ', got ' || coalesce(a.config, 'none') || ')' END,
           CASE WHEN a.volatile IS DISTINCT FROM e.volatile
                THEN 'volatility (want ' || e.volatile || ')' END,
           CASE WHEN a.nargs IS DISTINCT FROM e.nargs
                THEN 'arg count (want ' || e.nargs || ', got ' || a.nargs || ')' END,
           CASE WHEN e.lang IS NOT NULL AND a.lang IS DISTINCT FROM e.lang
                THEN 'language (want ' || e.lang || ')' END
         ), ''), '') AS detail
  FROM fn_expected e
  LEFT JOIN LATERAL (
    SELECT * FROM fn_actual a WHERE a.name = e.name
    ORDER BY (a.nargs = e.nargs) DESC, (a.body = e.body) DESC LIMIT 1
  ) a ON true
)""")
        selects.append("SELECT * FROM fn_check")

    if indexes:
        values = ",\n    ".join(
            "({}, {}, {}, {})".format(
                sql_str(x["name"]), sql_str(x["table"]), sql_str(x["unique"]),
                sql_str(x["definition"]),
            )
            for x in indexes
        )
        parts.append(f"""ix_expected(name, tbl, is_unique, definition) AS (
  VALUES
    {values}
),
ix_actual AS (
  SELECT c.relname::text AS name,
         t.relname::text AS tbl,
         i.indisunique AS is_unique,
         (i.indisvalid AND i.indisready) AS usable,
         {NORMALIZE_INDEX_SQL} AS definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
ix_check AS (
  SELECT 'index' AS kind, e.name::text AS name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.definition = e.definition
               AND a.is_unique = e.is_unique
               AND a.tbl = e.tbl
               AND a.usable
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.name IS NOT NULL AND a.definition IS DISTINCT FROM e.definition
                THEN 'definition (want ' || e.definition
                     || ', got ' || a.definition || ')' END,
           CASE WHEN a.is_unique IS DISTINCT FROM e.is_unique
                THEN 'uniqueness (want ' || CASE WHEN e.is_unique THEN 'unique'
                                                 ELSE 'non-unique' END || ')' END,
           CASE WHEN a.tbl IS DISTINCT FROM e.tbl
                THEN 'table (want ' || e.tbl || ', got ' || a.tbl || ')' END,
           CASE WHEN a.name IS NOT NULL AND NOT a.usable
                THEN 'INVALID - the planner ignores it' END
         ), ''), '') AS detail
  FROM ix_expected e
  LEFT JOIN ix_actual a ON a.name = e.name
)""")
        selects.append("SELECT * FROM ix_check")

    return ("WITH " + ",\n".join(parts) + "\n" +
            "\nUNION ALL\n".join(selects) +
            "\nORDER BY status DESC, kind, name;")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    functions: list[dict] = []
    indexes: list[dict] = []
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

    for f in functions:
        print(f"-- function {f['name']}({f['nargs']} args): body {f['body']}, "
              f"{'security definer' if f['secdef'] else 'security invoker'}, "
              f"{f['lang'] or 'any language'}, volatility {f['volatile']}, "
              f"config {f['config'] or 'none'}", file=sys.stderr)
    for x in indexes:
        print(f"-- index {x['name']} on {x['table']}: "
              f"{'unique ' if x['unique'] else ''}{x['definition']}",
              file=sys.stderr)
    print("-- run the statement below; every row must say OK\n", file=sys.stderr)

    print(build_query(functions, indexes))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
