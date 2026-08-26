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
pg_get_functiondef by hand.

The editor runs *the selected text* when there is a selection, so a stray
click before Run silently applies a fragment. Preferring MCP apply_migration
avoids that particular trap, but no apply path proves the result matches
intent. This does.

WHAT IT COMPARES
----------------
functions    Body, plus the four things a body cannot carry: SECURITY
             DEFINER, the SET search_path pin, volatility, and argument count
             (which also picks the right overload). The first two are the ones
             that vanish quietly — DROP+CREATE discards both, and a trigger
             that became SECURITY INVOKER has an identical body and no
             privileges.
indexes      Definition rather than name: CREATE INDEX IF NOT EXISTS is a
             no-op against an index already holding the name with different
             columns, so a name-only check certifies exactly the drift worth
             catching. Columns, ordering, method, uniqueness, partial
             predicate and validity. An index left INVALID by an interrupted
             CONCURRENTLY build exists, is named correctly, and is ignored by
             the planner.
privileges   GRANT and REVOKE on functions and tables, as *effective* access —
             has_function_privilege / has_table_privilege for named roles, and
             the PUBLIC grant itself for PUBLIC. Revoking from anon while
             PUBLIC still holds the privilege changes nothing, and that reads
             as MISMATCH here, which is the point.
config       Standalone ALTER FUNCTION ... SET, so a search_path hardening
             migration that touches no function body is still verifiable.
RLS          ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY.

WHAT IT DOES NOT COVER
----------------------
CREATE POLICY, constraints, triggers, column definitions and data migrations.
A migration made only of those cannot be verified here, and the script says so
and exits non-zero rather than printing a query that would look reassuring.
Return types and argument names are not compared either (only the count).

Body comparison is deliberately blind to formatting, which costs a little
precision inside string literals: it is case-insensitive and removes
whitespace next to parens and commas, so a change confined to a literal's case
or internal spacing is invisible. Comment stripping, however, does respect
single-quoted literals — a body containing 'prefix--one' is not truncated at
the marker, which would otherwise hash identically to 'prefix--two'.

Two constructs are refused rather than guessed at, because the Python and
Postgres normalisations could not be guaranteed to agree on them: a nested
dollar-quoted literal inside a body, and a block comment. Both are reported by
name instead of being silently skipped.

An expectation comes from the file you pass. If a *later* migration alters an
object, verify against that later file — this reports drift from the file it
was given, which is the question it was asked.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #
# Every pattern below has a twin in the generated SQL, and the two must agree
# character for character or every function reports MISMATCH. They are written
# as a pair deliberately: the alternation's first branch matches a single-
# quoted literal and is put back verbatim through the capture group, so only
# the other branch's matches are rewritten. That is how a conditional
# replacement is expressed in a language that has no conditional replacement.
#
# The branches begin with disjoint characters (a quote, whitespace, a hyphen,
# a paren), so Postgres's leftmost-longest rule and Python's leftmost-first
# rule cannot pick different branches.
STRIP_COMMENTS = (re.compile(r"('[^']*')|--[^\n]*"), r"\1")
COLLAPSE_SPACE = (re.compile(r"('[^']*')|\s+"), r"\1 ")
TIGHTEN_PUNCT = (re.compile(r"('[^']*')|\s*([(),])\s*"), r"\1\2")

NORMALIZE_BODY_SQL = (
    "md5(lower(btrim("
    "regexp_replace("
    "regexp_replace("
    "regexp_replace({col}, '(''[^'']*'')|--[^\\n]*', '\\1', 'g')"
    ", '(''[^'']*'')|\\s+', '\\1 ', 'g')"
    ", '(''[^'']*'')|\\s*([(),])\\s*', '\\1\\2', 'g')"
    ")))"
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

# REVOKE ALL on a function can only mean EXECUTE; on a table it means the lot.
TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                    "REFERENCES", "TRIGGER")


def normalize(sql: str) -> str:
    """The Python half of NORMALIZE_BODY_SQL; the two must agree exactly."""
    for pattern, replacement in (STRIP_COMMENTS, COLLAPSE_SPACE, TIGHTEN_PUNCT):
        sql = pattern.sub(replacement, sql)
    return sql.strip().lower()


def body_md5(body: str) -> str:
    return hashlib.md5(normalize(body).encode()).hexdigest()


def strip_layout(text: str) -> str:
    return re.sub(r"[\s()]", "", text.lower())


def sql_str(value) -> str:
    """A SQL literal, or NULL for a facet the file does not assert."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


# --------------------------------------------------------------------------- #
# Lexer
# --------------------------------------------------------------------------- #
# Parsing SQL with regexes alone is how the previous revision came to require
# bodies written exactly as `AS $$...$$;` and to treat `--` inside a literal as
# a comment. One pass that knows what a literal is fixes both, and lets every
# search below run against code only.
TOKEN = re.compile(r"'|--|/\*|\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$", re.S)


def lex(sql: str) -> list[tuple[str, int, int]]:
    """Spans of ('str' | 'line' | 'block' | 'dollar') in source order."""
    spans, i = [], 0
    while True:
        match = TOKEN.search(sql, i)
        if not match:
            return spans
        start, token = match.start(), match.group()
        if token == "'":
            end = start + 1
            while True:
                close = sql.find("'", end)
                if close == -1:
                    return spans + [("str", start, len(sql))]
                if sql[close + 1:close + 2] == "'":  # '' is an escaped quote
                    end = close + 2
                    continue
                end = close + 1
                break
            kind = "str"
        elif token == "--":
            newline = sql.find("\n", start)
            end = len(sql) if newline == -1 else newline
            kind = "line"
        elif token == "/*":
            close = sql.find("*/", start + 2)
            end = len(sql) if close == -1 else close + 2
            kind = "block"
        else:
            close = sql.find(token, start + len(token))
            end = len(sql) if close == -1 else close + len(token)
            kind = "dollar"
        spans.append((kind, start, end))
        i = end


def mask(sql: str, spans: list[tuple[str, int, int]]) -> str:
    """sql with every literal and comment blanked, so indexes still line up."""
    out = list(sql)
    for _, start, end in spans:
        for i in range(start, end):
            if out[i] != "\n":       # keep line structure for readability
                out[i] = " "
    return "".join(out)


def match_paren(masked: str, open_index: int) -> int:
    """Index just past the ')' matching the '(' at open_index."""
    depth, i = 0, open_index
    while i < len(masked):
        if masked[i] == "(":
            depth += 1
        elif masked[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


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


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
class Migration:
    """Everything one migration file asserts about the deployed schema."""

    def __init__(self) -> None:
        self.functions: list[dict] = []
        self.indexes: list[dict] = []
        self.privileges: list[dict] = []
        self.configs: list[dict] = []
        self.rls: list[dict] = []
        self.refused: list[str] = []

    def __len__(self) -> int:
        return (len(self.functions) + len(self.indexes) + len(self.privileges)
                + len(self.configs) + len(self.rls))


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


def parse_options(header: str) -> dict:
    """LANGUAGE / volatility / SECURITY / SET, wherever they sit."""
    lang = re.search(r"\bLANGUAGE\s+(\w+)", header, re.I)
    volatile = re.search(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", header, re.I)
    config = re.findall(r"\bSET\s+(\w+)\s*=\s*([^\n;]+)", header, re.I)
    return {
        "lang": lang.group(1).lower() if lang else None,
        "volatile": VOLATILITY[volatile.group(1).lower()] if volatile else "v",
        "secdef": bool(re.search(r"\bSECURITY\s+DEFINER\b", header, re.I)),
        "config": [f"{k.lower()}={v.strip().rstrip(';')}" for k, v in config],
    }


def parse_functions(sql: str, masked: str, spans, out: Migration) -> None:
    for match in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(",
        masked, re.I,
    ):
        name = match.group(1)
        args_end = match_paren(masked, match.end() - 1)
        if args_end < 0:
            out.refused.append(f"{name}: unterminated argument list")
            continue
        arglist = sql[match.end():args_end - 1]

        # The body is the first dollar-quoted or single-quoted span after AS.
        # Options may sit on either side of it: `AS $f$...$f$ LANGUAGE sql` is
        # as valid as putting LANGUAGE first, and the previous revision
        # silently skipped the whole function when it saw either.
        as_kw = re.compile(r"\bAS\b", re.I).search(masked, args_end)
        if not as_kw:
            out.refused.append(f"{name}: no AS clause found")
            continue
        body = next((s for s in spans
                     if s[0] in ("dollar", "str") and s[1] >= as_kw.end()), None)
        if body is None:
            out.refused.append(f"{name}: no function body found after AS")
            continue
        kind, body_start, body_end = body
        delim = len(re.match(r"\$[A-Za-z_0-9]*\$", sql[body_start:]).group()) \
            if kind == "dollar" else 1
        text = sql[body_start + delim:body_end - delim]

        inner = [s for s in lex(text) if s[0] in ("dollar", "block")]
        if inner:
            out.refused.append(
                f"{name}: body contains a {inner[0][0]} construct "
                "(nested dollar quote or block comment) that the Python and "
                "Postgres normalisations cannot be guaranteed to agree on")
            continue

        stmt_end = masked.find(";", body_end)
        header = masked[args_end:body_start] + " " + \
            masked[body_end:stmt_end if stmt_end > 0 else len(masked)]
        options = parse_options(header)
        out.functions.append({
            "name": name,
            "body": body_md5(text),
            "nargs": len(split_top_level(arglist)),
            **options,
        })


def parse_indexes(sql: str, masked: str, out: Migration) -> None:
    for match in re.finditer(
        r"CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"
        r"(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?(\w+)\s*"
        r"(?:USING\s+(\w+)\s*)?\(",
        masked, re.I,
    ):
        cols_end = match_paren(masked, match.end() - 1)
        if cols_end < 0:
            out.refused.append(f"{match.group(2)}: unterminated column list")
            continue
        stmt_end = masked.find(";", cols_end)
        tail = sql[cols_end:stmt_end if stmt_end > 0 else len(sql)]
        where = re.search(r"\bWHERE\b(.*)$", tail, re.S | re.I)

        method = (match.group(4) or "btree").lower()
        definition = f"using {method} ({canon_index_columns(sql[match.end():cols_end - 1])})"
        if where:
            definition += " where " + re.sub(r"\s+", " ", where.group(1)).strip()
        out.indexes.append({
            "name": match.group(2),
            "table": match.group(3).lower(),
            "unique": bool(match.group(1)),
            "definition": strip_layout(definition),
        })


def parse_privileges(sql: str, masked: str, out: Migration) -> None:
    """
    GRANT/REVOKE on functions and tables.

    Recorded as effective access per role, which is the question worth asking:
    a REVOKE from anon that leaves the privilege with PUBLIC has changed
    nothing, and shows up here as a MISMATCH rather than as a clean row.
    """
    seen = set()
    for match in re.finditer(
        r"\b(GRANT|REVOKE)\s+([^;]+?)\s+ON\s+(FUNCTION\s+|TABLE\s+)?(?:public\.)?(\w+)\s*"
        r"(\([^;]*?\))?\s*(?:TO|FROM)\s+([^;]+);",
        masked, re.S | re.I,
    ):
        seen.add(match.start())
        action, privs, on_kind, name, args, roles = match.groups()
        is_function = bool(on_kind and on_kind.strip().upper() == "FUNCTION")
        granted = action.upper() == "GRANT"
        if is_function:
            obj = f"public.{name}{re.sub(r'\s+', ' ', args or '()').strip()}"
            wanted = ["EXECUTE"]
        else:
            obj = f"public.{name}"
            wanted = TABLE_PRIVILEGES
        if not re.search(r"\bALL\b", privs, re.I):
            wanted = [p.strip().upper() for p in privs.split(",") if p.strip()]
            wanted = [p for p in wanted if re.fullmatch(r"[A-Z ]+", p)]
        for role in (r.strip().lower() for r in roles.split(",")):
            if not re.fullmatch(r"\w+", role):
                continue
            for priv in wanted:
                out.privileges.append({
                    "kind": "function" if is_function else "table",
                    "obj": obj, "role": role, "priv": priv, "want": granted,
                })

    # A GRANT the pattern did not consume - ON ALL TABLES IN SCHEMA, a role
    # grant, WITH GRANT OPTION - would otherwise vanish, and a query that
    # checked nothing still prints as if it checked everything.
    for kw in re.finditer(r"\b(GRANT|REVOKE)\b", masked, re.I):
        if kw.start() not in seen:
            line = masked[kw.start():masked.find(";", kw.start())]
            out.refused.append("unparsed privilege statement: "
                               + re.sub(r"\s+", " ", line).strip()[:90])


def parse_alter_function(sql: str, masked: str, out: Migration) -> None:
    """ALTER FUNCTION ... SET x = y, merged into the CREATE when there is one."""
    for match in re.finditer(
        r"ALTER\s+FUNCTION\s+(?:public\.)?(\w+)\s*(\([^)]*\))\s*"
        r"((?:\s*SET\s+\w+\s*=\s*[^\n;]+)+);",
        masked, re.I,
    ):
        name, args = match.group(1), re.sub(r"\s+", " ", match.group(2)).strip()
        entries = [f"{k.lower()}={v.strip().rstrip(';')}" for k, v in
                   re.findall(r"SET\s+(\w+)\s*=\s*([^\n;]+)",
                              sql[match.start(3):match.end(3)], re.I)]
        defined = [f for f in out.functions if f["name"].lower() == name.lower()]
        if defined:
            for fn in defined:
                for entry in entries:
                    if entry not in fn["config"]:
                        fn["config"].append(entry)
        else:
            out.configs.append({"obj": f"public.{name}{args}",
                                "config": strip_layout(",".join(entries))})


def parse_rls(masked: str, out: Migration) -> None:
    for match in re.finditer(
        r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+(ENABLE|DISABLE)\s+"
        r"ROW\s+LEVEL\s+SECURITY", masked, re.I,
    ):
        out.rls.append({"table": f"public.{match.group(1)}",
                        "want": match.group(2).upper() == "ENABLE"})


def parse(sql: str, out: Migration, src: str = "") -> None:
    before = {k: len(getattr(out, k)) for k in
              ("functions", "indexes", "privileges", "configs", "rls")}
    spans = lex(sql)
    masked = mask(sql, spans)
    parse_functions(sql, masked, spans, out)
    parse_indexes(sql, masked, out)
    parse_privileges(sql, masked, out)
    parse_alter_function(sql, masked, out)
    parse_rls(masked, out)
    for fn in out.functions[before["functions"]:]:
        fn["config"] = strip_layout(",".join(fn["config"])) or None
    for key, start in before.items():
        for item in getattr(out, key)[start:]:
            item["src"] = src


# --------------------------------------------------------------------------- #
# Query
# --------------------------------------------------------------------------- #
def build_query(m: Migration) -> str:
    parts, selects = [], []

    if m.functions:
        values = ",\n    ".join(
            "({}, {}, {}, {}, {}, {}, {}, {})".format(
                sql_str(f["src"]), sql_str(f["name"]), sql_str(f["body"]),
                sql_str(f["secdef"]), sql_str(f["lang"]), sql_str(f["volatile"]),
                sql_str(f["config"]), sql_str(f["nargs"]))
            for f in m.functions)
        parts.append(f"""fn_expected(src, name, body, secdef, lang, volatile, config, nargs) AS (
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
  SELECT e.src::text AS src, 'function' AS kind, e.name::text AS name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.body = e.body AND a.secdef = e.secdef
               AND a.volatile = e.volatile AND a.nargs = e.nargs
               AND a.config IS NOT DISTINCT FROM e.config
               AND (e.lang IS NULL OR a.lang = e.lang)
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN a.name IS NULL THEN '' ELSE
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.body IS DISTINCT FROM e.body THEN 'body' END,
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
         ), ''), '') END AS detail
  FROM fn_expected e
  LEFT JOIN LATERAL (
    SELECT * FROM fn_actual a WHERE a.name = e.name
    ORDER BY (a.nargs = e.nargs) DESC, (a.body = e.body) DESC LIMIT 1
  ) a ON true
)""")
        selects.append("SELECT * FROM fn_check")

    if m.indexes:
        values = ",\n    ".join(
            "({}, {}, {}, {}, {})".format(
                sql_str(x["src"]), sql_str(x["name"]), sql_str(x["table"]),
                sql_str(x["unique"]), sql_str(x["definition"]))
            for x in m.indexes)
        parts.append(f"""ix_expected(src, name, tbl, is_unique, definition) AS (
  VALUES
    {values}
),
ix_actual AS (
  SELECT c.relname::text AS name, t.relname::text AS tbl,
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
  SELECT e.src::text AS src, 'index' AS kind, e.name::text AS name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.definition = e.definition AND a.is_unique = e.is_unique
               AND a.tbl = e.tbl AND a.usable
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN a.name IS NULL THEN '' ELSE
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.definition IS DISTINCT FROM e.definition
                THEN 'definition (want ' || e.definition
                     || ', got ' || a.definition || ')' END,
           CASE WHEN a.is_unique IS DISTINCT FROM e.is_unique
                THEN 'uniqueness (want ' || CASE WHEN e.is_unique THEN 'unique'
                                                 ELSE 'non-unique' END || ')' END,
           CASE WHEN a.tbl IS DISTINCT FROM e.tbl
                THEN 'table (want ' || e.tbl || ', got ' || a.tbl || ')' END,
           CASE WHEN NOT a.usable THEN 'INVALID - the planner ignores it' END
         ), ''), '') END AS detail
  FROM ix_expected e
  LEFT JOIN ix_actual a ON a.name = e.name
)""")
        selects.append("SELECT * FROM ix_check")

    if m.privileges:
        values = ",\n    ".join(
            "({}, {}, {}, {}, {}, {})".format(
                sql_str(p["src"]), sql_str(p["kind"]), sql_str(p["obj"]),
                sql_str(p["role"]), sql_str(p["priv"]), sql_str(p["want"]))
            for p in m.privileges)
        parts.append(f"""pv_expected(src, objkind, obj, role, priv, want) AS (
  VALUES
    {values}
),
pv_check AS (
  SELECT e.src::text AS src, 'privilege' AS kind,
         (e.priv || ' on ' || e.obj || ' for ' || e.role)::text AS name,
         CASE WHEN oid_of IS NULL THEN 'MISSING'
              WHEN e.role <> 'public'
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = e.role)
              THEN 'MISSING'
              WHEN got = e.want THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN oid_of IS NULL THEN 'object not found'
              WHEN e.role <> 'public'
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = e.role)
              THEN 'role not found'
              WHEN got IS DISTINCT FROM e.want
              THEN 'want ' || CASE WHEN e.want THEN 'granted' ELSE 'revoked' END
                   || ', got ' || CASE WHEN got THEN 'granted' ELSE 'revoked' END
              ELSE '' END AS detail
  FROM pv_expected e
  CROSS JOIN LATERAL (
    SELECT CASE WHEN e.objkind = 'function' THEN to_regprocedure(e.obj)::oid
                ELSE to_regclass(e.obj)::oid END AS oid_of
  ) o
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN o.oid_of IS NULL THEN NULL
      WHEN e.role = 'public' THEN EXISTS (
        SELECT 1 FROM aclexplode(CASE WHEN e.objkind = 'function'
          THEN (SELECT coalesce(p.proacl, acldefault('f', p.proowner))
                  FROM pg_proc p WHERE p.oid = o.oid_of)
          ELSE (SELECT coalesce(c.relacl, acldefault('r', c.relowner))
                  FROM pg_class c WHERE c.oid = o.oid_of) END) a
        WHERE a.grantee = 0 AND a.privilege_type = e.priv)
      WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = e.role) THEN NULL
      WHEN e.objkind = 'function'
        THEN has_function_privilege(e.role, o.oid_of, e.priv)
      ELSE has_table_privilege(e.role, o.oid_of, e.priv) END AS got
  ) g
)""")
        selects.append("SELECT * FROM pv_check")

    if m.configs:
        values = ",\n    ".join(
            "({}, {}, {})".format(sql_str(c["src"]), sql_str(c["obj"]),
                                  sql_str(c["config"]))
            for c in m.configs)
        parts.append(f"""cfg_expected(src, obj, config) AS (
  VALUES
    {values}
),
cfg_check AS (
  SELECT e.src::text AS src, 'config' AS kind, e.obj::text AS name,
         CASE WHEN to_regprocedure(e.obj) IS NULL THEN 'MISSING'
              WHEN a.config = e.config THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN to_regprocedure(e.obj) IS NULL THEN 'function not found'
              WHEN a.config IS DISTINCT FROM e.config
              THEN 'want ' || e.config || ', got ' || coalesce(a.config, 'none')
              ELSE '' END AS detail
  FROM cfg_expected e
  LEFT JOIN LATERAL (
    SELECT nullif(regexp_replace(lower(array_to_string(p.proconfig, ',')),
                                 '[[:space:]()]', '', 'g'), '') AS config
    FROM pg_proc p WHERE p.oid = to_regprocedure(e.obj)::oid
  ) a ON true
)""")
        selects.append("SELECT * FROM cfg_check")

    if m.rls:
        values = ",\n    ".join(
            "({}, {}, {})".format(sql_str(r["src"]), sql_str(r["table"]),
                                  sql_str(r["want"]))
            for r in m.rls)
        parts.append(f"""rls_expected(src, tbl, want) AS (
  VALUES
    {values}
),
rls_check AS (
  SELECT e.src::text AS src, 'rls' AS kind, e.tbl::text AS name,
         CASE WHEN c.relname IS NULL THEN 'MISSING'
              WHEN c.relrowsecurity = e.want THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN c.relname IS NULL THEN 'table not found'
              WHEN c.relrowsecurity IS DISTINCT FROM e.want
              THEN 'want ' || CASE WHEN e.want THEN 'enabled' ELSE 'disabled' END
              ELSE '' END AS detail
  FROM rls_expected e
  LEFT JOIN pg_class c ON c.oid = to_regclass(e.tbl)::oid
)""")
        selects.append("SELECT * FROM rls_check")

    return ("WITH " + ",\n".join(parts) + "\n" +
            "\nUNION ALL\n".join(selects) +
            "\nORDER BY status DESC, src, kind, name;")


# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    m = Migration()
    for path in argv[1:]:
        try:
            with open(path) as f:
                parse(f.read(), m, os.path.basename(path))
        except OSError as exc:
            print(f"! cannot read {path}: {exc}", file=sys.stderr)
            return 2

    for refusal in m.refused:
        print(f"! REFUSED {refusal}", file=sys.stderr)

    if not len(m):
        print("! Nothing here can be verified. This script covers functions, "
              "indexes, GRANT/REVOKE, ALTER FUNCTION ... SET and RLS enablement; "
              "it does not cover CREATE POLICY, constraints, triggers, column "
              "definitions or data migrations. A migration made only of those "
              "has to be checked by hand — no query is printed rather than one "
              "that would look reassuring.", file=sys.stderr)
        return 2

    for f in m.functions:
        print(f"-- function {f['name']}({f['nargs']} args): body {f['body']}, "
              f"{'security definer' if f['secdef'] else 'security invoker'}, "
              f"{f['lang'] or 'any language'}, volatility {f['volatile']}, "
              f"config {f['config'] or 'none'}", file=sys.stderr)
    for x in m.indexes:
        print(f"-- index {x['name']} on {x['table']}: "
              f"{'unique ' if x['unique'] else ''}{x['definition']}",
              file=sys.stderr)
    for p in m.privileges:
        print(f"-- privilege {p['priv']} on {p['obj']} for {p['role']}: "
              f"{'granted' if p['want'] else 'revoked'}", file=sys.stderr)
    for c in m.configs:
        print(f"-- config {c['obj']}: {c['config']}", file=sys.stderr)
    for r in m.rls:
        print(f"-- rls {r['table']}: "
              f"{'enabled' if r['want'] else 'disabled'}", file=sys.stderr)
    print("-- run the statement below; every row must say OK\n", file=sys.stderr)

    print(build_query(m))
    return 1 if m.refused else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
