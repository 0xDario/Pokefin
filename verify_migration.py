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
functions    Body, plus what a body cannot carry: SECURITY DEFINER, the SET
             search_path pin, volatility, and the argument signature. The
             first two are the ones that vanish quietly - DROP+CREATE
             discards both, and a trigger that became SECURITY INVOKER has an
             identical body and no privileges. The signature is compared
             against pg_get_function_identity_arguments rather than by
             argument count alone, which could not tell f(text) from
             f(integer) and would certify one as the other. Quoted
             identifiers in the body are compared separately and verbatim,
             since the hash lowercases everything and "UserID" and "userid"
             are different columns.
indexes      Definition rather than name: CREATE INDEX IF NOT EXISTS is a
             no-op against an index already holding the name with different
             columns, so a name-only check certifies exactly the drift worth
             catching. Columns, ordering, method, uniqueness, partial
             predicate and validity. An index left INVALID by an interrupted
             CONCURRENTLY build exists, is named correctly, and is ignored by
             the planner.
privileges   GRANT and REVOKE on functions and tables, as *effective* access -
             has_function_privilege / has_table_privilege for named roles, and
             the PUBLIC grant itself for PUBLIC. Revoking from anon while
             PUBLIC still holds the privilege changes nothing, and that reads
             as MISMATCH here, which is the point.
config       Standalone ALTER FUNCTION ... SET, so a search_path hardening
             migration that touches no function body is still verifiable.
roles        ALTER ROLE ... SET, against pg_roles.rolconfig.
RLS          ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY.

An ALTER and a CREATE assert different things, so they are compared
differently. ALTER FUNCTION ... SET and ALTER ROLE ... SET name one setting
and leave the rest of the catalogue entry alone, so each is checked for
presence: pinning search_path on a function that already carries a
statement_timeout is not drift. A CREATE OR REPLACE assigns every property
specified or implied, dropping any it omits, so its config is compared whole -
a leftover pin the file no longer asks for is exactly the kind of thing worth
knowing about, on a SECURITY DEFINER function especially.

Unquoted identifiers are folded to lower case, because the server folds them
too and CREATE FUNCTION RebuildCache would otherwise report MISSING. A quoted
object name is not parsed at all and lands in the refused pile.

EVERY STATEMENT IS ACCOUNTED FOR
--------------------------------
The failure this guards against is a partial check that reads as a full one.
0009 is the example: three statement_timeout guards and three search_path
pins, of which an earlier revision checked only the pins - every printed row
said OK while the half the migration is named after had never been looked at.

So each top-level statement now ends up in exactly one of three places. It is
verified; or it is a kind deliberately out of scope - CREATE POLICY,
constraints, triggers, column definitions, data - which is counted and printed
under NOT VERIFIED; or the parser could not read it, which is refused by name.
The exit code says which: 0 everything verified, 1 something refused, 2
nothing verifiable at all, 3 verified what it could with the rest listed. A
refusal outranks an empty result - a file whose every statement was refused
reports 1, not 2, so a caller can tell a parser failure from an ordinary
out-of-scope migration.

Within one file the last word wins, because that is all the catalogue keeps: a
function replaced twice, or a privilege granted and then revoked, leaves one
expectation, not two that cannot both hold. Across files it does not - an
earlier migration superseded by a later one is expected to report MISMATCH.

Argument modes are honoured: an OUT parameter is excluded from both the count
and the signature, because pronargs counts inputs only and identity arguments
list only inputs. Two overloads sharing a name and arity are distinct
expectations - f(text) is not f(integer), and collapsing them would leave one
unchecked while every printed row said OK.

Return types are not compared. Argument names and types are, in the dialect
pg_get_function_identity_arguments speaks - which is why the file's spellings
are mapped (INT to integer, VARCHAR to character varying, and so on). A
signature this could not translate is reported as a difference and names both
sides, rather than being fed to to_regprocedure, which raises on a type it
cannot parse and would take every other check in the query down with it.

Index parentheses are dropped so that Postgres's own re-parenthesising does
not read as drift, which means grouping is not compared. With one binary
operator that costs nothing; with two, ((a+b)*c) and (a+(b*c)) would flatten
together, so an expression or predicate carrying more than one is refused
rather than certified.

Quoted identifiers keep their case wherever they appear - in a body, an index
definition, or a setting value - because "UserID" and "userid" are different
columns and every comparison here lowercases. In a body and an index they are
extracted and compared verbatim; in a setting value the whole setting is
refused instead, since a quoted schema in a search_path pin is exactly the case
that must not be certified by a blind comparison.

Index definitions keep their literals: layout is stripped only outside them,
and because lower() cannot be applied selectively in SQL the literals are also
compared separately and verbatim. Otherwise WHERE status = 'ACTIVE' and
'active' normalise together, as do 'in progress' and 'inprogress', and a wrong
index reports OK.

Body comparison is deliberately blind to formatting, which costs a little
precision inside string literals: it is case-insensitive and removes
whitespace next to parens and commas, so a change confined to a literal's case
or internal spacing is invisible. Comment stripping, however, does respect
single-quoted literals - a body containing 'prefix--one' is not truncated at
the marker, which would otherwise hash identically to 'prefix--two'. A
single-quoted body has its doubled quotes unescaped first, because Postgres
stores the unescaped form in prosrc.

Refused rather than guessed at: a nested dollar-quoted literal or a block
comment inside a body (the Python and Postgres normalisations could not be
guaranteed to agree on either), an escape-string body, a column-level grant, a
grantee that resolves at apply time such as CURRENT_USER, SET ... FROM CURRENT
(the value is whatever was current when it was applied), a setting value or an
argument list naming a quoted identifier, a function with no AS clause in its
own statement (the SQL-standard RETURN body is not read here), an ALTER TABLE
carrying actions beyond the RLS one, an index expression or predicate with more
than one operator, an index containing a function call (its parentheses are
dropped by this comparison, so lower(a) could not be told from a column named
lowera), an index with INCLUDE columns (they are part of the index and are not
read here, so the expectation would describe a different one), an index using a
dollar-quoted constant (Postgres renders it back with ordinary quoting, so no
expectation could match), and any statement the parser does not recognise.

Operators are detected as runs of operator characters rather than from a list.
The list was the wrong shape: the first attempt omitted the bitwise ones, so
((a & b) | c) sailed through, and Postgres lets anyone define new operators, so
no list could ever be complete.

An expectation comes from the file you pass. If a *later* migration alters an
object, verify against that later file - this reports drift from the file it
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
#
# Layout inside a literal is not noise, so the same capture-group trick used on
# function bodies keeps literals intact here: 'in progress' and 'inprogress'
# must not collapse together. Case inside a literal matters too, and lower()
# cannot be applied selectively, so the literals are compared separately and
# verbatim - see INDEX_LITERALS_SQL.
INDEX_TAIL_SQL = (
    "regexp_replace(pg_get_indexdef(i.indexrelid), "
    "'^CREATE (UNIQUE )?INDEX [^ ]+ ON [^ ]+ ', '')"
)

NORMALIZE_INDEX_SQL = (
    "regexp_replace(lower(" + INDEX_TAIL_SQL + "), "
    "'(''[^'']*'')|[\\s()]', '\\1', 'g')"
)

# Built here rather than inline in the query's f-string, where \n and \1 would
# be read as Python escapes and silently produce a newline and a chr(1) - the
# regex would then strip every comment marker's replacement and match nothing.
BODY_IDENTS_SQL = (
    "(SELECT coalesce(string_agg(m[1], '|' ORDER BY n), '') "
    "FROM regexp_matches(regexp_replace(p.prosrc, "
    "'(''[^'']*'')|--[^\\n]*', '\\1', 'g'), '\"[^\"]*\"', 'g') "
    "WITH ORDINALITY AS t(m, n))"
)

INDEX_IDENTS_SQL = (
    "(SELECT coalesce(string_agg(m[1], '|' ORDER BY n), '') "
    "FROM regexp_matches(" + INDEX_TAIL_SQL + ", '\"[^\"]*\"', 'g') "
    "WITH ORDINALITY AS t(m, n))"
)

INDEX_LITERALS_SQL = (
    "(SELECT coalesce(string_agg(m[1], '|' ORDER BY n), '') "
    "FROM regexp_matches(" + INDEX_TAIL_SQL + ", '''[^'']*''', 'g') "
    "WITH ORDINALITY AS t(m, n))"
)

VOLATILITY = {"immutable": "i", "stable": "s", "volatile": "v"}

# REVOKE ALL on a function can only mean EXECUTE; on a table it means the lot.
TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                    "REFERENCES", "TRIGGER")

# Keywords that end a SET clause by starting the next one, so a value is not
# read past the end of its own clause.
NEXT_CLAUSE = re.compile(
    r"\b(AS|LANGUAGE|SECURITY|SET|RETURNS|IMMUTABLE|STABLE|VOLATILE|STRICT"
    r"|CALLED|COST|ROWS|PARALLEL|LEAKPROOF|WINDOW|TRANSFORM|SUPPORT)\b", re.I)

# Grantees that look like identifiers but are resolved at apply time. PUBLIC is
# absent deliberately: it is a real grantee here, with its own catalogue check.
RESERVED_ROLES = frozenset({"CURRENT_USER", "SESSION_USER", "CURRENT_ROLE",
                            "GROUP"})


def normalize(sql: str) -> str:
    """The Python half of NORMALIZE_BODY_SQL; the two must agree exactly."""
    for pattern, replacement in (STRIP_COMMENTS, COLLAPSE_SPACE, TIGHTEN_PUNCT):
        sql = pattern.sub(replacement, sql)
    return sql.strip().lower()


def body_md5(body: str) -> str:
    return hashlib.md5(normalize(body).encode()).hexdigest()


def strip_layout(text: str) -> str:
    return re.sub(r"[\s()]", "", text.lower())


# Layout is noise; the inside of a string literal is not. Squeezing the space
# out of both 'in progress' and 'inprogress' would let a wrong index report OK,
# so the same capture-group trick used on function bodies applies here: the
# literal branch is put back verbatim and only the layout branch is dropped.
def strip_index_layout(text: str) -> str:
    return re.sub(r"('[^']*')|[\s()]", r"\1", text.lower())


def literals_of(text: str) -> str:
    """The string literals, verbatim and in order.

    Compared separately and case-sensitively, because the layout comparison
    lowercases everything: WHERE status = 'ACTIVE' and WHERE status = 'active'
    are different indexes and must not normalise together.
    """
    return "|".join(re.findall(r"'[^']*'", text))


# A quoted identifier is as literal as a string: "my  column" and "my column"
# name different columns, and "UserID" is not "userid".
QUOTED = r"('[^']*'|\"[^\"]*\")"


def collapse_space_outside_literals(text: str) -> str:
    """Runs of whitespace become one space - except inside a literal or a
    quoted identifier, where 'in  progress' and 'in progress' differ."""
    return re.sub(QUOTED + r"|\s+", lambda m: m.group(1) or " ", text)


def quoted_idents(text: str) -> str:
    """Double-quoted identifiers, verbatim and in order.

    Compared separately because the body hash lowercases everything and SQL
    has no selective lower(): "UserID" and "userid" are different columns and
    must not hash the same.
    """
    return "|".join(re.findall(r'"[^"]*"', text))


# Spellings Postgres accepts but never renders back. Compared against
# pg_get_function_identity_arguments, so the file side has to speak its dialect.
TYPE_ALIASES = {
    "int": "integer", "int4": "integer", "int2": "smallint",
    "int8": "bigint", "float4": "real", "float8": "double precision",
    "bool": "boolean", "varchar": "character varying", "char": "character",
    "decimal": "numeric", "timestamptz": "timestamp with time zone",
    "timestamp": "timestamp without time zone", "timetz": "time with time zone",
    "time": "time without time zone",
}

# Two or more binary operators mean the parentheses carry meaning, and this
# comparison drops them: ((a+b)*c) and (a+(b*c)) would both flatten to a+b*c.
#
# Listing the operators to look for was the wrong shape - the first attempt
# omitted the bitwise ones, so ((a & b) | c) sailed through. Postgres also lets
# anyone define new operators, so no list can be complete. This matches any run
# of operator characters instead, minus the ones that are punctuation here:
# a cast's :: and a qualified name's dot.
OPERATOR_RUN = re.compile(r"[-+*/%^&|#~<>=!@?]+|\b(AND|OR)\b", re.I)


def has_ambiguous_grouping(text: str) -> bool:
    bare = re.sub(r"'[^']*'", "", text)
    bare = bare.replace("::", " ")
    return len(OPERATOR_RUN.findall(bare)) >= 2


def parse_arguments(masked_arglist: str) -> tuple[int, str | None]:
    """
    (input count, signature) for a function's argument list.

    Takes the *masked* arglist, where a literal is blanked, so the comma in
    `DEFAULT 'a,b'` is not read as an argument separator. The type text itself
    never contains a literal once the default is stripped, so the masked copy
    serves for both.

    pronargs counts input arguments only, and identity arguments list only
    inputs, so an OUT parameter is dropped from both - counting it would make
    an exactly deployed function report an argument-count mismatch forever.

    Argument count alone cannot tell f(text) from f(integer), so a migration
    expecting one could be certified by the other. Identity arguments are used
    rather than to_regprocedure because a signature this could not parse would
    make to_regprocedure raise and take every other check in the query with it;
    a mismatch here is merely reported, and names the difference.
    """
    args = []
    for arg in split_top_level(masked_arglist):
        arg = re.split(r"\bDEFAULT\b|=", arg, maxsplit=1, flags=re.I)[0].strip()
        mode = re.match(r"(IN|OUT|INOUT|VARIADIC)\s+", arg, re.I)
        if mode:
            arg = arg[mode.end():].strip()
            if mode.group(1).upper() == "OUT":
                continue          # identity arguments list only inputs
            if mode.group(1).upper() != "IN":
                arg = mode.group(1).lower() + " " + arg
        arg = re.sub(r"\s+", " ", arg.strip().lower())
        for alias, canonical in TYPE_ALIASES.items():
            arg = re.sub(rf"\b{alias}\b(?!\s*\w)", canonical, arg)
        args.append(arg)
    return len(args), (", ".join(args) if args else None)


def lower_outside_literals(text: str) -> str:
    """Case folding stops at a literal or a quoted identifier.

    Without the second, an index on "UserID" had its identifier folded before
    quoted_idents() could record the spelling, and the verbatim comparison then
    reported drift against a correctly deployed index.
    """
    return re.sub(QUOTED + r"|([^'\"]+)",
                  lambda m: m.group(1) or m.group(2).lower(), text)


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
TOKEN = re.compile(r"\"|'|--|/\*|\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$", re.S)


def lex(sql: str) -> list[tuple[str, int, int]]:
    """
    Spans of ('str' | 'ident' | 'line' | 'block' | 'dollar') in source order.

    Double-quoted identifiers are tracked but not blanked. A policy named
    "Users can't edit" would otherwise open a string span at the apostrophe
    and derail every offset after it, yet the identifier itself is code and
    the callers need to read it.
    """
    spans, i = [], 0
    while True:
        match = TOKEN.search(sql, i)
        if not match:
            return spans
        start, token = match.start(), match.group()
        if token in ("'", '"'):
            end = start + 1
            while True:
                close = sql.find(token, end)
                if close == -1:
                    return spans + [("str", start, len(sql))]
                if sql[close + 1:close + 2] == token:  # doubled is an escape
                    end = close + 2
                    continue
                end = close + 1
                break
            kind = "str" if token == "'" else "ident"
        elif token == "--":
            newline = sql.find("\n", start)
            end = len(sql) if newline == -1 else newline
            kind = "line"
        elif token == "/*":
            # Block comments nest in Postgres. Stopping at the first */ left
            # the tail of the outer comment exposed as code, and a
            # CREATE INDEX inside one produced an expectation for an index
            # that does not exist and never will.
            depth, cursor = 1, start + 2
            while depth:
                nxt = re.compile(r"/\*|\*/").search(sql, cursor)
                if not nxt:
                    cursor = len(sql)
                    break
                depth += 1 if nxt.group() == "/*" else -1
                cursor = nxt.end()
            end = cursor
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
    for kind, start, end in spans:
        if kind == "ident":   # an identifier is code, not content
            continue
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
        self.roles: list[dict] = []
        self.refused: list[str] = []
        # Every statement a parser consumed, so the leftovers can be accounted
        # for instead of vanishing. Reset per file; offsets are file-local.
        self.hits: set[int] = set()
        self.unverified: list[str] = []

    KINDS = ("functions", "indexes", "privileges", "configs", "rls", "roles")

    def __len__(self) -> int:
        return sum(len(getattr(self, k)) for k in self.KINDS)


def canon_index_columns(cols: str) -> str:
    """
    Drop what Postgres never prints back, so both sides agree.

    ASC is the default and is never rendered; NULLS LAST is the default under
    ASC and NULLS FIRST under DESC, so each is rendered only when it is the
    exception.
    """
    out = []
    for col in split_top_level(cols):
        col = collapse_space_outside_literals(
            lower_outside_literals(col.strip()))
        col = re.sub(r"\basc\b", "", col).strip()
        if re.search(r"\bdesc\b", col):
            col = re.sub(r"\bnulls first\b", "", col)
        else:
            col = re.sub(r"\bnulls last\b", "", col)
        out.append(collapse_space_outside_literals(col).strip())
    return ", ".join(out)


def blank_returns(header: str) -> str:
    """
    The RETURNS clause, blanked, so its contents are not read as options.

    RETURNS TABLE (stable text) declares a column named stable; matching the
    first occurrence of the word anywhere in the header recorded the function
    as STABLE when Postgres would default it to VOLATILE, and an exactly
    deployed function then reported drift.
    """
    out = list(header)
    for match in re.finditer(r"\bRETURNS\s+(SETOF\s+)?(TABLE\s*)?", header, re.I):
        end = match.end()
        if match.group(2):
            close = match_paren(header, header.find("(", end - 1))
            end = close if close > 0 else len(header)
        else:
            word = re.compile(r"\S+\s*(\([^)]*\))?").match(header, end)
            end = word.end() if word else end
        for i in range(match.start(), min(end, len(out))):
            out[i] = " "
    return "".join(out)


def parse_options(header: str, source: str) -> dict:
    """LANGUAGE / volatility / SECURITY / SET, wherever they sit."""
    clauses = blank_returns(header)
    lang = re.search(r'\bLANGUAGE\s+(\w+|"[^"]*")', clauses, re.I)
    volatile = re.search(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", clauses, re.I)
    language = lang.group(1) if lang else None
    if language and language.startswith('"'):
        language = language[1:-1]      # quoted: case-sensitive, kept as written
    elif language:
        language = language.lower()
    return {
        "lang": language,
        "volatile": VOLATILITY[volatile.group(1).lower()] if volatile else "v",
        "secdef": bool(re.search(r"\bSECURITY\s+DEFINER\b", clauses, re.I)),
        "config": parse_settings(clauses, source),
    }


def parse_settings(masked_text: str, source: str) -> list[tuple[str, str]]:
    """(key, value) per SET, a later assignment replacing an earlier one.

    Clauses are located in the masked text so a SET inside a comment does not
    count, but the value is read from the source at the same offsets: masked
    blanks literals, and SET statement_timeout = '3s' would otherwise parse as
    statement_timeout= and mismatch a correctly deployed function forever.

    Postgres replaces a setting rather than accumulating it, so appending would
    build a proconfig no correctly deployed function could ever match.
    """
    settings: list[tuple[str, str]] = []
    for match in re.finditer(r"\bSET\s+(\w+)\s*(?:=|\bTO\b)", masked_text, re.I):
        key = match.group(1).lower()
        # The value runs to the semicolon or to the keyword that begins the
        # next clause - `SET search_path TO public AS $$` on one line would
        # otherwise read as the value "public AS". A newline is deliberately
        # NOT a terminator: `SET search_path =` with the value on the following
        # line is ordinary formatting, and treating the break as semantic
        # recorded an empty value. Both boundaries are looked for in the masked
        # copy, where a literal is blank, so a semicolon inside the value
        # cannot cut it short; and the extent must be found this way rather
        # than by matching the value itself, since against a blanked literal a
        # trailing `\s*(...)` would backtrack onto the blanks and capture a
        # single space.
        end = len(masked_text)
        found = masked_text.find(";", match.end())
        if found != -1:
            end = found
        clause = NEXT_CLAUSE.search(masked_text, match.end(), end)
        if clause:
            end = clause.start()
        value = collapse_space_outside_literals(
            source[match.end():end]).strip().rstrip(";")
        settings = [entry for entry in settings if entry[0] != key]
        settings.append((key, value))
    return settings


def render_setting(key: str, value: str) -> str:
    return re.sub(r"[\s()']", "", f"{key}={value}".lower())


def setting_is_comparable(key: str, value: str) -> bool:
    """
    False when the value carries a quoted identifier.

    SET search_path = "TrustedSchema" and "trustedschema" are different
    schemas, and both sides of this comparison lowercase, so the check could
    not tell them apart. Refusing keeps the rule that nothing is certified by
    a comparison known to be blind to the difference.
    """
    return '"' not in value


def render_settings(settings: list[tuple[str, str]]) -> str | None:
    # ALTER ROLE anon SET statement_timeout = '3s' is stored as
    # statement_timeout=3s: the quotes are syntax the catalogue does not keep,
    # so both sides drop them.
    joined = ",".join(f"{k}={v}" for k, v in settings)
    return re.sub(r"[\s()']", "", joined.lower()) or None


def parse_functions(sql: str, masked: str, spans, out: Migration,
                    first: int) -> None:
    for match in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(",
        masked, re.I,
    ):
        out.hits.add(match.start())
        name = match.group(1).lower()
        args_end = match_paren(masked, match.end() - 1)
        if args_end < 0:
            out.refused.append(f"{name}: unterminated argument list")
            continue
        # Masked, so a comma inside a default literal is not an
        # argument separator: pronargs counts declarations, not commas.
        arglist = masked[match.end():args_end - 1]

        # The body is the first dollar-quoted or single-quoted span after AS.
        # Options may sit on either side of it: `AS $f$...$f$ LANGUAGE sql` is
        # as valid as putting LANGUAGE first, and the previous revision
        # silently skipped the whole function when it saw either.
        # Bounded to this statement. A SQL-standard body (LANGUAGE SQL RETURN
        # expr) has no AS at all, and an unbounded search found the *next*
        # function's AS and recorded its body as this one's - checking the
        # wrong implementation while marking both statements accounted for.
        limit = masked.find(";", args_end)
        limit = len(masked) if limit < 0 else limit
        as_kw = re.compile(r"\bAS\b", re.I).search(masked, args_end, limit)
        if not as_kw:
            out.refused.append(
                f"{name}: no AS clause in this statement - a SQL-standard "
                "RETURN body is not compared here")
            continue
        body = next((s for s in spans
                     if s[0] in ("dollar", "str")
                     and as_kw.end() <= s[1] < limit), None)
        if body is None:
            out.refused.append(f"{name}: no function body found after AS")
            continue
        kind, body_start, body_end = body
        if kind == "str":
            # A single-quoted body stores doubled quotes as syntax, not
            # content: Postgres keeps SELECT 'x' in prosrc for a body written
            # AS 'SELECT ''x'''. Hashing the doubled form would report a
            # correctly deployed function as drifted every time. An E'' or
            # U&'' body carries backslash or unicode escapes that would need a
            # real decoder to compare honestly, so it is refused, not guessed.
            prefix = re.search(r"(?:[Uu]&|[EeBbXx])$", sql[:body_start])
            if prefix:
                out.refused.append(
                    f"{name}: body uses {prefix.group()}'...' escape-string "
                    "syntax, which this cannot decode faithfully")
                continue
            text = sql[body_start + 1:body_end - 1].replace("''", "'")
        else:
            delim = len(re.match(r"\$[A-Za-z_0-9]*\$", sql[body_start:]).group())
            text = sql[body_start + delim:body_end - delim]

        inner = [s for s in lex(text) if s[0] in ("dollar", "block")]
        if inner:
            out.refused.append(
                f"{name}: body contains a {inner[0][0]} construct "
                "(nested dollar quote or block comment) that the Python and "
                "Postgres normalisations cannot be guaranteed to agree on")
            continue

        # Options may sit either side of the body. The masked copy locates the
        # clauses; the source copy, sliced identically so the offsets line up,
        # supplies values that masking would have blanked.
        stmt_end = masked.find(";", body_end)
        stop = stmt_end if stmt_end > 0 else len(masked)
        header = masked[args_end:body_start] + " " + masked[body_end:stop]
        header_src = sql[args_end:body_start] + " " + sql[body_end:stop]
        if re.search(r"\bSET\s+\w+\s+FROM\s+CURRENT\b", header, re.I):
            out.refused.append(
                f"{name}: SET ... FROM CURRENT captures the value at apply "
                "time, which cannot be predicted from the file")
            continue

        nargs, signature = parse_arguments(arglist)
        if signature and '"' in signature:
            # f("UserID" integer) and f("userid" integer) take different
            # named-notation arguments, and both sides of this comparison
            # lowercase, so the difference would be invisible.
            out.refused.append(
                f"{name}: argument list names a quoted identifier, which this "
                "comparison lowercases and so cannot check")
            continue
        options = parse_options(header, header_src)
        unreadable = [k for k, v in options["config"]
                      if not setting_is_comparable(k, v)]
        if unreadable:
            out.refused.append(
                f"{name}: setting {unreadable[0]} names a quoted identifier, "
                "which this comparison lowercases and so cannot check")
            continue
        entry = {
            "name": name,
            "body": body_md5(text),
            # Double-quoted names survive the lowercasing that the body hash
            # applies, so they are compared on their own, verbatim.
            "idents": quoted_idents(STRIP_COMMENTS[0].sub(STRIP_COMMENTS[1], text)),
            "nargs": nargs,
            "signature": signature,
            **options,
        }
        # A file that CREATE OR REPLACEs the same signature twice leaves only
        # the last body deployed, so an expectation for the earlier one could
        # never be satisfied. The later definition supersedes it.
        for previous in out.functions[first:]:
            # Same name and arity is not the same function: f(text) and
            # f(integer) are distinct overloads, and dropping one of them would
            # leave it unchecked while every printed row said OK.
            if (previous["name"] == entry["name"]
                    and previous["signature"] == entry["signature"]):
                out.functions.remove(previous)
                break
        out.functions.append(entry)


def parse_indexes(sql: str, masked: str, out: Migration) -> None:
    for match in re.finditer(
        r"CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"
        r"(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?(\w+)\s*"
        r"(?:USING\s+(\w+)\s*)?\(",
        masked, re.I,
    ):
        out.hits.add(match.start())
        cols_end = match_paren(masked, match.end() - 1)
        if cols_end < 0:
            out.refused.append(f"{match.group(2)}: unterminated column list")
            continue
        stmt_end = masked.find(";", cols_end)
        tail = sql[cols_end:stmt_end if stmt_end > 0 else len(sql)]
        where = re.search(r"\bWHERE\b(.*)$", tail, re.S | re.I)
        index_name = match.group(2).lower()

        # INCLUDE columns are part of the index and are not read here, so the
        # expectation would describe a plain index - a stale one could match it
        # while the real covering index reported drift. Refused rather than
        # compared against a definition known to be incomplete.
        if re.search(r"\bINCLUDE\b", masked[cols_end:stmt_end if stmt_end > 0
                                             else len(masked)], re.I):
            out.refused.append(
                f"{index_name}: INCLUDE columns are not compared, so the "
                "expectation would describe a different index")
            continue

        # A dollar-quoted constant is rendered back by Postgres in ordinary
        # quoting, so the two sides could never agree, and the literal-aware
        # normalisation does not recognise it either.
        if any(kind == "dollar" for kind, _, _ in
               lex(sql[match.end():stmt_end if stmt_end > 0 else len(sql)])):
            out.refused.append(
                f"{index_name}: dollar-quoted constant, which Postgres renders "
                "back with ordinary quoting, so no expectation could match")
            continue

        method = (match.group(4) or "btree").lower()
        columns = sql[match.end():cols_end - 1]
        definition = f"using {method} ({canon_index_columns(columns)})"
        if where:
            # Literal-aware, or 'in  progress' collapses onto 'in progress'
            # before the literal-preserving normalisation ever sees it.
            definition += " where " + collapse_space_outside_literals(
                where.group(1)).strip()

        # Parentheses are dropped so that Postgres's own re-parenthesising does
        # not read as drift, which means grouping is not compared. With one
        # binary operator that costs nothing; with two, ((a+b)*c) and (a+(b*c))
        # flatten together and a wrong index would report OK.
        # (lower(a)) strips to lowera, which is also what an ordinary index on
        # a column named lowera strips to; f(a,b) collides with a two-column
        # index on (fa, b). No binary operator is involved, so the grouping
        # guard does not see it, and the catalogue side strips identically -
        # a different index would report OK.
        predicate = where.group(1) if where else ""
        if re.search(r"\w\s*\(", columns) or re.search(r"\w\s*\(", predicate):
            out.refused.append(
                f"{index_name}: a function call's parentheses are dropped by "
                "this comparison, so lower(a) could not be told apart from a "
                "column named lowera")
            continue

        if has_ambiguous_grouping(columns) or has_ambiguous_grouping(predicate):
            out.refused.append(
                f"{index_name}: expression or predicate has more than one "
                "operator, so parenthesis-blind comparison could not tell two "
                "groupings apart")
            continue
        out.indexes.append({
            # Unquoted identifiers are folded by the server, so the expectation
            # has to be folded too or a CREATE INDEX MixedCase reports MISSING.
            "name": index_name,
            "table": match.group(3).lower(),
            "unique": bool(match.group(1)),
            "definition": strip_index_layout(definition),
            "literals": literals_of(definition),
            # An index on "UserID" and one on "userid" are different indexes,
            # and the definition comparison lowercases both.
            "idents": quoted_idents(definition),
        })


def parse_privileges(sql: str, masked: str, out: Migration,
                     first: int) -> None:
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
        out.hits.add(match.start())
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
            # A column-level grant - GRANT SELECT (email) ON ... - is a
            # privilege this cannot express. Dropping the unreadable token and
            # keeping the rest would emit a query that silently omits the
            # grant, so the whole statement is refused.
            unsupported = [p for p in wanted if not re.fullmatch(r"[A-Z ]+", p)]
            if unsupported or not wanted:
                out.refused.append(
                    "unsupported privilege "
                    + (repr(unsupported[0]) if unsupported else "(none parsed)")
                    + " in: " + re.sub(r"\s+", " ", match.group()).strip()[:90])
                continue
        parsed_roles = []
        for raw in roles.split(","):
            raw = raw.strip()
            quoted = re.fullmatch(r'"((?:[^"]|"")*)"', raw)
            if quoted:                       # "report-reader" is one role name
                parsed_roles.append(quoted.group(1).replace('""', '"'))
            elif re.fullmatch(r"\w+", raw) and raw.upper() not in RESERVED_ROLES:
                parsed_roles.append(raw.lower())
            else:
                # CURRENT_USER resolves at apply time and is not a role name;
                # taking it literally would look up a role called
                # "current_user" and report a confident MISSING. Dropping the
                # token while keeping the statement would check a grant that
                # was never asserted and skip the one that was.
                out.refused.append(
                    f"unreadable role {raw!r} in: "
                    + re.sub(r"\s+", " ", match.group()).strip()[:90])
                parsed_roles = []
                break
        for role in parsed_roles:
            for priv in wanted:
                entry = {"kind": "function" if is_function else "table",
                         "obj": obj, "role": role, "priv": priv, "want": granted}
                # Granting and then revoking in one file leaves only the revoke
                # deployed, so keeping both expectations made the earlier one
                # permanently unsatisfiable.
                for previous in out.privileges[first:]:
                    if (previous["obj"] == obj and previous["role"] == role
                            and previous["priv"] == priv):
                        out.privileges.remove(previous)
                        break
                out.privileges.append(entry)

    # A GRANT the pattern did not consume - ON ALL TABLES IN SCHEMA, a role
    # grant, WITH GRANT OPTION - would otherwise vanish, and a query that
    # checked nothing still prints as if it checked everything.
    for kw in re.finditer(r"\b(GRANT|REVOKE)\b", masked, re.I):
        if kw.start() not in seen:
            out.hits.add(kw.start())
            line = masked[kw.start():masked.find(";", kw.start())]
            out.refused.append("unparsed privilege statement: "
                               + re.sub(r"\s+", " ", line).strip()[:90])


def parse_alter_function(sql: str, masked: str, out: Migration,
                        first: int) -> None:
    """
    ALTER FUNCTION ... SET x = y.

    Folded into the CREATE only when this same file defines a function of that
    name and arity: an ALTER in a later migration is that migration's
    assertion, not a retrospective edit to an earlier file's, and attributing
    it to the earlier file would both misreport the source and, before
    settings replaced by key, build a proconfig nothing could match.
    """
    for match in re.finditer(r"ALTER\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(",
                             masked, re.I):
        out.hits.add(match.start())
        name = match.group(1).lower()
        # numeric(10, 2) nests, so the signature ends at the matching paren
        # rather than at the first one - `[^)]*` stopped inside the modifier
        # and refused a perfectly ordinary parameterised type.
        args_end = match_paren(masked, match.end() - 1)
        stmt_end = masked.find(";", args_end if args_end > 0 else match.end())
        if args_end < 0 or stmt_end < 0:
            out.refused.append(f"{name}: unterminated ALTER FUNCTION signature")
            continue
        args = "(" + re.sub(r"\s+", " ", masked[match.end():args_end - 1]).strip() + ")"
        nargs, signature = parse_arguments(masked[match.end():args_end - 1])
        settings = parse_settings(masked[args_end:stmt_end],
                                  sql[args_end:stmt_end])
        if not settings:
            out.refused.append(f"{name}: ALTER FUNCTION with no SET clause")
            continue
        # Name and arity is not identity: altering f(integer) must not fold
        # its setting into an f(text) the same file happens to create, which
        # would leave the integer overload unaltered and unchecked.
        defined = [f for f in out.functions[first:]
                   if f["name"] == name and f["signature"] == signature]
        if defined:
            for fn in defined:
                fn["config"] = parse_settings_merge(fn["config"], settings)
        else:
            # An ALTER asserts only the settings it names; Postgres keeps the
            # rest of proconfig. One row per setting, checked by containment,
            # so pinning search_path on a function that already carries a
            # statement_timeout is not reported as drift.
            for key, value in settings:
                if not setting_is_comparable(key, value):
                    out.refused.append(
                        f"{name}: setting {key} names a quoted identifier, "
                        "which this comparison lowercases and so cannot check")
                    continue
                out.configs.append({"obj": f"public.{name}{args}".lower(),
                                    "setting": render_setting(key, value)})


def parse_settings_merge(existing, incoming):
    merged = [s for s in existing if s[0] not in {k for k, _ in incoming}]
    return merged + incoming


def parse_alter_role(sql: str, masked: str, out: Migration) -> None:
    """
    ALTER ROLE <role> SET key = value, checked against pg_roles.rolconfig.

    0009 is the migration that made this necessary: three statement_timeout
    guards and three search_path pins, of which only the pins were checked.
    Every printed row said OK while half the file - the half the migration is
    named after - had never been looked at.
    """
    for match in re.finditer(
        r'ALTER\s+ROLE\s+(\w+|"(?:[^"]|"")*")\s*'
        r'((?:\s*SET\s+\w+\s*=\s*[^\n;]+)+);',
        masked, re.I,
    ):
        out.hits.add(match.start())
        role = match.group(1).strip()
        if role.startswith('"'):
            role = role[1:-1].replace('""', '"')
        else:
            role = role.lower()
        for key, value in parse_settings(masked[match.start(2):match.end(2)],
                                         sql[match.start(2):match.end(2)]):
            if not setting_is_comparable(key, value):
                out.refused.append(
                    f"{role}: setting {key} names a quoted identifier, which "
                    "this comparison lowercases and so cannot check")
                continue
            out.roles.append({"role": role,
                              "setting": render_setting(key, value)})


def parse_rls(masked: str, out: Migration) -> None:
    for match in re.finditer(
        r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+(ENABLE|DISABLE)\s+"
        r"ROW\s+LEVEL\s+SECURITY", masked, re.I,
    ):
        out.hits.add(match.start())
        # ALTER TABLE takes a comma-separated list of actions, and marking the
        # statement accounted for on one hit would silently drop the rest -
        # FORCE ROW LEVEL SECURITY next to ENABLE would never be checked while
        # the run still exited 0.
        stmt_end = masked.find(";", match.end())
        rest = masked[match.end():stmt_end if stmt_end > 0 else len(masked)]
        if rest.strip().strip(";"):
            out.refused.append(
                f"public.{match.group(1)}: ALTER TABLE carries further actions "
                "beyond the RLS one, and only the RLS action is read here")
            continue
        out.rls.append({"table": f"public.{match.group(1)}",
                        "want": match.group(2).upper() == "ENABLE"})


# Statement kinds this deliberately does not verify. They are counted and
# reported, never silently dropped: a verifier that checks half a file and
# prints all-OK is worse than one that checks none of it.
UNVERIFIABLE = (
    (r"CREATE\s+(OR\s+REPLACE\s+)?POLICY", "CREATE POLICY"),
    (r"(DROP|ALTER)\s+POLICY", "DROP/ALTER POLICY"),
    (r"CREATE\s+(TABLE|SCHEMA|TYPE|SEQUENCE|EXTENSION|DOMAIN)", "CREATE (table/type/etc)"),
    (r"CREATE\s+(OR\s+REPLACE\s+)?(VIEW|MATERIALIZED\s+VIEW)", "CREATE VIEW"),
    (r"CREATE\s+(OR\s+REPLACE\s+)?TRIGGER", "CREATE TRIGGER"),
    (r"DROP\s+(TRIGGER|INDEX|FUNCTION|TABLE|VIEW|TYPE|SEQUENCE)", "DROP object"),
    (r"ALTER\s+TABLE", "ALTER TABLE (other than RLS enablement)"),
    (r"COMMENT\s+ON", "COMMENT ON"),
    (r"(INSERT|UPDATE|DELETE|TRUNCATE)\b", "data statement"),
    (r"DO\b", "DO block"),
    (r"(BEGIN|COMMIT|ROLLBACK|SET|RESET|ANALYZE|VACUUM|REFRESH)\b",
     "session/transaction statement"),
)


def statements(masked: str) -> list[tuple[int, int]]:
    """Top-level statement spans. Literals and bodies are already blanked,
    so a semicolon inside one cannot split a statement in half."""
    spans, i = [], 0
    while i < len(masked):
        end = masked.find(";", i)
        if end == -1:
            if masked[i:].strip():
                spans.append((i, len(masked)))
            break
        spans.append((i, end + 1))
        i = end + 1
    return spans


def account_for_statements(masked: str, out: Migration, src: str) -> None:
    """Every statement is verified, knowingly out of scope, or refused."""
    for start, end in statements(masked):
        text = masked[start:end].strip()
        if not text or text == ";":
            continue
        if any(start <= hit < end for hit in out.hits):
            continue
        label = next((name for pattern, name in UNVERIFIABLE
                      if re.match(pattern, text, re.I)), None)
        if label:
            out.unverified.append(label)
        else:
            out.refused.append(
                f"unrecognised statement in {src}: "
                + re.sub(r"\s+", " ", text).strip()[:80])


def parse(sql: str, out: Migration, src: str = "") -> None:
    before = {k: len(getattr(out, k)) for k in Migration.KINDS}
    out.hits = set()
    spans = lex(sql)
    masked = mask(sql, spans)
    parse_functions(sql, masked, spans, out, before["functions"])
    parse_indexes(sql, masked, out)
    parse_privileges(sql, masked, out, before["privileges"])
    parse_alter_function(sql, masked, out, before["functions"])
    parse_alter_role(sql, masked, out)
    parse_rls(masked, out)
    account_for_statements(masked, out, src)
    for fn in out.functions[before["functions"]:]:
        fn["config"] = render_settings(fn["config"])
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
            "({}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
                sql_str(f["src"]), sql_str(f["name"]), sql_str(f["body"]),
                sql_str(f["secdef"]), sql_str(f["lang"]), sql_str(f["volatile"]),
                sql_str(f["config"]), sql_str(f["nargs"]), sql_str(f["idents"]),
                sql_str(f["signature"]))
            for f in m.functions)
        parts.append(f"""fn_expected(src, name, body, secdef, lang, volatile, config, nargs,
            idents, signature) AS (
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
                               '[[:space:]()'']', '', 'g'), '') AS config,
         p.pronargs::int AS nargs,
         {BODY_IDENTS_SQL} AS idents,
         nullif(regexp_replace(
                  lower(pg_get_function_identity_arguments(p.oid)),
                  '[[:space:]]+', ' ', 'g'), '') AS signature
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
               AND a.idents = e.idents
               AND a.signature IS NOT DISTINCT FROM e.signature
               AND (e.lang IS NULL OR a.lang = e.lang)
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN a.name IS NULL THEN '' ELSE
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.body IS DISTINCT FROM e.body THEN 'body' END,
           CASE WHEN a.body = e.body AND a.idents IS DISTINCT FROM e.idents
                THEN 'quoted identifiers differ only in case (want '
                     || e.idents || ', got ' || a.idents || ')' END,
           CASE WHEN a.signature IS DISTINCT FROM e.signature
                THEN 'signature (want ' || coalesce(e.signature, 'none')
                     || ', got ' || coalesce(a.signature, 'none') || ')' END,
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
    -- Signature first: with two overloads of equal arity and identical body
    -- the other orderings tie, and Postgres was free to return either, so a
    -- correctly deployed overload could report a signature MISMATCH purely
    -- because its sibling was the one picked.
    SELECT * FROM fn_actual a WHERE a.name = e.name
    ORDER BY (a.signature IS NOT DISTINCT FROM e.signature) DESC,
             (a.nargs = e.nargs) DESC, (a.body = e.body) DESC LIMIT 1
  ) a ON true
)""")
        selects.append("SELECT * FROM fn_check")

    if m.indexes:
        values = ",\n    ".join(
            "({}, {}, {}, {}, {}, {}, {})".format(
                sql_str(x["src"]), sql_str(x["name"]), sql_str(x["table"]),
                sql_str(x["unique"]), sql_str(x["definition"]),
                sql_str(x["literals"]), sql_str(x["idents"]))
            for x in m.indexes)
        parts.append(f"""ix_expected(src, name, tbl, is_unique, definition, literals,
            idents) AS (
  VALUES
    {values}
),
ix_actual AS (
  SELECT c.relname::text AS name, t.relname::text AS tbl,
         i.indisunique AS is_unique,
         (i.indisvalid AND i.indisready) AS usable,
         {NORMALIZE_INDEX_SQL} AS definition,
         {INDEX_LITERALS_SQL} AS literals,
         {INDEX_IDENTS_SQL} AS idents
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
ix_check AS (
  SELECT e.src::text AS src, 'index' AS kind, e.name::text AS name,
         CASE WHEN a.name IS NULL THEN 'MISSING'
              WHEN a.definition = e.definition AND a.literals = e.literals
               AND a.idents = e.idents AND a.is_unique = e.is_unique
               AND a.tbl = e.tbl AND a.usable
              THEN 'OK' ELSE 'MISMATCH' END AS status,
         CASE WHEN a.name IS NULL THEN '' ELSE
         coalesce(nullif(concat_ws(', ',
           CASE WHEN a.definition IS DISTINCT FROM e.definition
                THEN 'definition (want ' || e.definition
                     || ', got ' || a.definition || ')' END,
           CASE WHEN a.definition = e.definition
                 AND a.literals IS DISTINCT FROM e.literals
                THEN 'literals differ only in case (want ' || e.literals
                     || ', got ' || a.literals || ')' END,
           CASE WHEN a.definition = e.definition
                 AND a.idents IS DISTINCT FROM e.idents
                THEN 'quoted columns differ only in case (want ' || e.idents
                     || ', got ' || a.idents || ')' END,
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
                                  sql_str(c["setting"]))
            for c in m.configs)
        parts.append("""cfg_expected(src, obj, setting) AS (
  VALUES
    @VALUES@
),
cfg_check AS (
  SELECT e.src::text AS src, 'config' AS kind,
         (e.obj || ' ' || split_part(e.setting, '=', 1))::text AS name,
         CASE WHEN to_regprocedure(e.obj) IS NULL THEN 'MISSING'
              WHEN e.setting = ANY(a.settings) THEN 'OK'
              ELSE 'MISMATCH' END AS status,
         CASE WHEN to_regprocedure(e.obj) IS NULL THEN 'function not found'
              WHEN NOT (e.setting = ANY(a.settings))
              THEN 'want ' || e.setting || ', got '
                   || coalesce(nullif(array_to_string(a.settings, ', '), ''),
                               'none')
              ELSE '' END AS detail
  FROM cfg_expected e
  LEFT JOIN LATERAL (
    SELECT array(SELECT regexp_replace(lower(x), '[[:space:]()'']', '', 'g')
                   FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS x) AS settings
    FROM pg_proc p WHERE p.oid = to_regprocedure(e.obj)::oid
  ) a ON true
)""".replace("@VALUES@", values))
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

    if m.roles:
        values = ",\n    ".join(
            "({}, {}, {})".format(sql_str(r["src"]), sql_str(r["role"]),
                                  sql_str(r["setting"]))
            for r in m.roles)
        parts.append("""role_expected(src, role, setting) AS (
  VALUES
    @VALUES@
),
role_check AS (
  SELECT e.src::text AS src, 'role' AS kind,
         (e.role || ' ' || split_part(e.setting, '=', 1))::text AS name,
         CASE WHEN r.rolname IS NULL THEN 'MISSING'
              WHEN e.setting = ANY(r.settings) THEN 'OK'
              ELSE 'MISMATCH' END AS status,
         CASE WHEN r.rolname IS NULL THEN 'role not found'
              WHEN NOT (e.setting = ANY(r.settings))
              THEN 'want ' || e.setting || ', got '
                   || coalesce(nullif(array_to_string(r.settings, ', '), ''),
                               'none')
              ELSE '' END AS detail
  FROM role_expected e
  LEFT JOIN LATERAL (
    SELECT rolname,
           array(SELECT regexp_replace(lower(x), '[[:space:]()'']', '', 'g')
                   FROM unnest(coalesce(rolconfig, '{}'::text[])) AS x) AS settings
    FROM pg_roles WHERE rolname = e.role
  ) r ON true
)""".replace("@VALUES@", values))
        selects.append("SELECT * FROM role_check")

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

    if not len(m) and m.refused:
        print("! Everything in this input was refused; nothing could be "
              "checked. The refusals are listed above.", file=sys.stderr)
        return 1

    if not len(m):
        print("! Nothing here can be verified. This script covers functions, "
              "indexes, GRANT/REVOKE, ALTER FUNCTION ... SET and RLS enablement; "
              "it does not cover CREATE POLICY, constraints, triggers, column "
              "definitions or data migrations. A migration made only of those "
              "has to be checked by hand — no query is printed rather than one "
              "that would look reassuring.", file=sys.stderr)
        return 2

    for f in m.functions:
        print(f"-- function {f['name']}({f['signature'] or ''}): "
              f"body {f['body']}, "
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
        print(f"-- config {c['obj']}: {c['setting']}", file=sys.stderr)
    for r in m.rls:
        print(f"-- rls {r['table']}: "
              f"{'enabled' if r['want'] else 'disabled'}", file=sys.stderr)
    for r in m.roles:
        print(f"-- role {r['role']}: {r['setting']}", file=sys.stderr)

    if m.unverified:
        counts: dict[str, int] = {}
        for label in m.unverified:
            counts[label] = counts.get(label, 0) + 1
        print("-- NOT VERIFIED (out of scope, check by hand): "
              + ", ".join(f"{n} x {label}" for label, n
                          in sorted(counts.items())), file=sys.stderr)
    print("-- run the statement below; every row must say OK\n", file=sys.stderr)

    print(build_query(m))
    if m.refused:
        return 1
    return 3 if m.unverified else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
