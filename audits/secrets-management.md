# Pokefin Security Audit — Secrets Management

- Branch audited: `claude/security-vulnerability-analysis-LT3JQ` (working tree
  matches HEAD on this branch).
- Date: 2026-05-27.
- Scope: hardcoded secrets in source/history, environment-variable handling,
  rotation capability, and any custom key management (encryption keys, signing
  keys, etc.).

## Executive summary

Current state of the repository is **good**. The env-first credential plumbing
(`secrets_loader.py`, `run_scraper.sh` sourcing `$HOME/.config/pokefin/env`,
Vercel/GitHub-Actions managed env) is correctly implemented and there is **no
live secret material committed to the repository or its git history** as of
HEAD. The committed template (`secretsFileTemplate.py`) holds empty strings;
the local-dev `secretsFile.py` is gitignored; `.env` / `.env.*` are gitignored
at both repo root and `frontend/`.

Findings are limited to **low/medium** items that are mostly docs/operational
hardening — there is no Critical or High finding under this topic.

Risk score: **2 / 10** (Low). Score is held up only by: (a) the absence of a
written rotation runbook, (b) the silent-placeholder behaviour in
`supabase.ts` / `serverSupabase.ts` / `serverMarketData.ts` which could mask a
mis-set Vercel env var during a real deploy, and (c) `secrets_loader.py`
preferring `secretsFile.SUPABASE_KEY` as a fallback even if a real
`SUPABASE_KEY` env var is set (only matters in mixed-config local dev). None
of these are a credential leak.

---

## Findings

### S-1 — No rotation runbook for any of the live secrets

- Severity: **Medium**
- CWE: CWE-321 (Use of Hard-coded Cryptographic Key — adjacent: missing
  rotation procedure for the keys that *aren't* hard-coded)
- Evidence:
  - `audits/HARDENING_FOLLOWUPS.md:139-164` — describes the **one-time**
    May-2026 migration from legacy JWT API keys → `sb_publishable_…` /
    `sb_secret_…` plus HS256 → ECC P-256 JWT signing keys, and notes a pending
    30-day HS256 retirement. There is no documentation describing the
    **recurring** rotation procedure for any of: the Supabase publishable key,
    the Supabase secret key (used by the scraper), the Cloudflare Turnstile
    secret (held in the Supabase Auth dashboard per
    `audits/HARDENING_FOLLOWUPS.md:75`), the optional `SENTRY_AUTH_TOKEN`, or
    the Supabase DB password.
  - Existing audits (`audits/api-and-infrastructure.md:179`,
    `audits/comprehensive-security-report.md:230`) recommend "quarterly
    rotation" but the repo does not record the procedure or a cadence
    anywhere.
- Why it matters: secrets that cannot be rotated under pressure (incident,
  laptop loss, employee turnover) tend to never be rotated. Without a written
  procedure, future rotations are ad-hoc; the scraper key in particular is the
  highest-blast-radius credential in the system (bypasses RLS).
- Exploitability + PoC: not directly exploitable. The latent risk is:
  ```
  # If the scraper key leaks, recovery currently relies on operator memory:
  #   - Generate a new sb_secret_… in Supabase dashboard
  #   - SSH to scraper host, edit ~/.config/pokefin/env
  #   - Revoke the old sb_secret_… in the dashboard
  # No checklist => steps get skipped, old key stays valid.
  ```
- Remediation (minimal): add a `SECRETS_ROTATION.md` to `audits/` (or to the
  repo root) with one short section per credential. Example shape:
  ```markdown
  ## Supabase secret key (sb_secret_…) — scraper
  Cadence: quarterly + on any suspected exposure.
  1. Dashboard → Project Settings → API Keys → "Create new secret key".
  2. SSH scraper host: edit ~/.config/pokefin/env to use the new value.
  3. systemctl restart pokefin-scraper (or wait for next cron tick + tail
     /home/<user>/Pokefin/scraper.log to confirm a successful run).
  4. Dashboard → revoke the old sb_secret_…
  5. Record date in CHANGELOG.
  ```
  Repeat for: `NEXT_PUBLIC_SUPABASE_KEY` (publishable; rotation rarely needed,
  but document it), Turnstile secret (Cloudflare → Supabase Auth captcha
  setting), `SENTRY_AUTH_TOKEN` (when in use), Supabase project DB password
  (Supabase Dashboard → Database → Connection Pooling).
- Defense-in-depth: also document the HS256-standby retirement deadline (per
  `audits/HARDENING_FOLLOWUPS.md:161-164`) so it actually happens; add a
  calendar reminder out-of-tree.

### S-2 — Silent placeholder fallback in browser/server Supabase factories can mask a missing prod env var

- Severity: **Low**
- CWE: CWE-1188 (Insecure Default Initialization of Resource)
- Evidence:
  - `frontend/app/lib/supabase.ts:8-21` — falls back to
    `"https://placeholder.supabase.invalid"` / `"placeholder-key"` and only
    emits `console.warn` if either env var is missing.
  - `frontend/app/lib/serverSupabase.ts:8-21` — identical pattern for the SSR
    cookie-bound client.
  - `frontend/app/lib/serverMarketData.ts:20-29` — same pattern (verified via
    grep, see "process.env." inventory below).
  - `frontend/app/components/ProductPrices.tsx:11-14` — older client uses the
    non-null-assertion shorthand (`process.env.NEXT_PUBLIC_SUPABASE_URL!`) and
    would throw at request time if the var were missing; this is the *safer*
    pattern, not the placeholder one.
  - The placeholder choice is intentional (build-time page-data collection on
    Vercel imports these modules), and the comment in `supabase.ts:4-7` calls
    out the trade-off explicitly.
- Why it matters: in any environment where the env var is unintentionally
  unset (preview deploy, branch deploy, a misnamed Vercel var), the app boots
  successfully and only fails on the first network call to
  `placeholder.supabase.invalid`. That delays detection from "build/deploy"
  to "production traffic", and the warning is `console.warn` which is easily
  missed in Vercel logs.
- Exploitability + PoC: not directly exploitable. The realistic failure mode
  is: a deploy with a missing key never throws but every Supabase request
  fails with an obscure DNS/auth error; an operator might add a temporary
  fallback that uses a wrong key, etc.
- Remediation (minimal drop-in): keep the placeholder for build-time, but at
  runtime (i.e. on first actual use), fail loudly. One option:
  ```ts
  // supabase.ts
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!isBuild) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY at runtime"
      );
    }
    // build-time only: keep placeholders so static page-data collection works
  }
  export const supabase = createBrowserClient(
    supabaseUrl ?? "https://placeholder.supabase.invalid",
    supabaseAnonKey ?? "placeholder-key",
    { auth: { flowType: "pkce" } }
  );
  ```
  Apply the same shape to `serverSupabase.ts` and `serverMarketData.ts`.
- Defense-in-depth: add a "verify Vercel env vars present" probe to the deploy
  checklist (curl `/` and assert no `placeholder.supabase.invalid` lookups in
  `vercel logs --since 1m`).

### S-3 — `secrets_loader.py` reads `secretsFile.SUPABASE_KEY` even when the env vars are partially set

- Severity: **Low**
- CWE: CWE-1188 (Insecure Default Initialization of Resource)
- Evidence:
  - `secrets_loader.py:28-38`:
    ```python
    def load_supabase_credentials() -> tuple[str, str]:
        url = _from_env_or_file("SUPABASE_URL", "SUPABASE_URL")
        key = _from_env_or_file("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY") or \
              _from_env_or_file("SUPABASE_KEY", "SUPABASE_KEY")
        …
    ```
  - The fallback order is: `os.environ["SUPABASE_SERVICE_ROLE_KEY"]` →
    `secretsFile.SUPABASE_KEY` → `os.environ["SUPABASE_KEY"]` →
    `secretsFile.SUPABASE_KEY`. If `SUPABASE_SERVICE_ROLE_KEY` is unset but
    `secretsFile.SUPABASE_KEY` is populated (e.g. a stale local dev file), the
    loader returns the file value even though `os.environ["SUPABASE_KEY"]`
    might also be set elsewhere.
- Why it matters: this is an "unexpected source wins" hazard. In practice the
  scraper host has `SUPABASE_SERVICE_ROLE_KEY` in `~/.config/pokefin/env` and
  blanked `secretsFile.SUPABASE_KEY` (per
  `audits/HARDENING_FOLLOWUPS.md:155-158`), so the bug is dormant — but if a
  developer pulls a stale `secretsFile.py` locally and also sets
  `SUPABASE_KEY` in their shell, the file silently wins. Worst-case practical
  outcome: confusion + an unexpected key reaching Supabase. Not exploitable
  externally.
- Exploitability + PoC: local-dev only. Sketch:
  ```sh
  # local dev workstation:
  cat secretsFile.py
  # SUPABASE_URL = "https://stale.supabase.co"
  # SUPABASE_KEY = "stale-leftover-key"
  export SUPABASE_KEY="intended-new-key"
  python -c "from secrets_loader import load_supabase_credentials as L; print(L())"
  # → returns ("https://stale.supabase.co", "stale-leftover-key")
  ```
- Remediation (minimal): make env strictly win over file. One line per
  credential:
  ```python
  def _from_env_or_file(env_name: str, file_attr: str) -> Optional[str]:
      v = os.environ.get(env_name)
      if v:
          return v
      try:
          import secretsFile  # type: ignore[import-not-found]
      except ImportError:
          return None
      return getattr(secretsFile, file_attr, None)

  def load_supabase_credentials() -> tuple[str, str]:
      url = os.environ.get("SUPABASE_URL") or _from_env_or_file("SUPABASE_URL", "SUPABASE_URL")
      key = (
          os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
          or os.environ.get("SUPABASE_KEY")
          or _from_env_or_file("SUPABASE_KEY", "SUPABASE_KEY")
      )
      …
  ```
  (The current code already does the env-vs-file ordering correctly per
  variable; the only nit is the `_from_env_or_file("SUPABASE_KEY", …)` fall-
  through which can pick up the file before the *other* env var is tried.
  Either way, no live secret leaks.)
- Defense-in-depth: blank `secretsFile.py` on all known dev machines (the
  hardening note in `HARDENING_FOLLOWUPS.md:157` says this was already done
  on the scraper host — consider doing it on developer laptops too) and rely
  exclusively on env files.

### S-4 — `README.md` references a non-existent `.env.example`

- Severity: **Low** (documentation defect, not a secret leak)
- CWE: CWE-1059 (Insufficient Technical Documentation)
- Evidence:
  - `README.md:51-55` instructs:
    ```bash
    # Create environment file
    cp .env.example .env.local
    # Add your Supabase credentials:
    NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
    NEXT_PUBLIC_SUPABASE_KEY=your-supabase-anon-key
    ```
  - No `.env.example` exists in the repo (`find . -maxdepth 3 -name
    '.env.example'` returns nothing; `.gitignore` even pre-emptively excludes
    `.env.*` with a `!.env.example` exception that's currently irrelevant).
- Why it matters: a new contributor will either create their own `.env.local`
  by hand (fine) or invent values, but the documented onboarding path is
  broken. Worse, in the absence of a checked-in template, contributors often
  paste a coworker's `.env.local` over Slack — that's how anon-vs-secret keys
  get confused.
- Exploitability + PoC: n/a.
- Remediation (minimal): add `frontend/.env.example` with empty-value entries:
  ```env
  # frontend/.env.example
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_KEY=
  NEXT_PUBLIC_SITE_URL=http://localhost:3000
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=
  # Optional:
  NEXT_PUBLIC_SENTRY_DSN=
  ```
  And add a sibling `pokefin.env.example` (or update the comment in
  `run_scraper.sh:25-29`) showing the scraper variables:
  ```env
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  SHOPIFY_STORE_DOMAIN=
  SHOPIFY_ADMIN_API_TOKEN=
  SHOPIFY_API_VERSION=2024-10
  ```
  Update `README.md:54-55` to point at `frontend/.env.example`.
- Defense-in-depth: have the CI step that runs `npm test` also assert the
  template files exist (`test -f frontend/.env.example`).

### S-5 — `copilot-instructions.md` still recommends `secretsFile.py` over `~/.config/pokefin/env`

- Severity: **Low** (process drift; not a code defect)
- CWE: CWE-1059
- Evidence:
  - `.github/copilot-instructions.md:71-76, 92-101` documents the *old*
    workflow:
    ```
    cp secretsFileTemplate.py secretsFile.py  # Configure credentials
    python main.py                    # Run scraper manually
    …
    # Python (secretsFile.py)
    SUPABASE_URL=
    SUPABASE_KEY=
    ```
  - The actual hardened path (env-first via `secrets_loader.py`; deploy via
    `run_scraper.sh` sourcing `~/.config/pokefin/env`; legacy keys revoked)
    is documented only in `audits/HARDENING_FOLLOWUPS.md`.
- Why it matters: Copilot/agent guidance steers new development back to the
  pre-hardening pattern (flat-file secrets), making regression likely.
- Exploitability + PoC: n/a.
- Remediation (minimal): replace the "Python (secretsFile.py)" block with:
  ```
  # Python scraper credentials are resolved env-first by secrets_loader.py.
  # For local development, either:
  #   (a) export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in your shell, or
  #   (b) cp secretsFileTemplate.py secretsFile.py and fill it in (gitignored).
  # For the deploy host, populate ~/.config/pokefin/env (KEY=VALUE,
  # chmod 600); run_scraper.sh sources it before invoking main.py.
  ```
- Defense-in-depth: keep `audits/HARDENING_FOLLOWUPS.md` as the source of
  truth and link to it from `copilot-instructions.md` and `README.md`.

### S-6 — Historic `page_source.html` contains base64-encoded PayPal iframe configs that look like JWTs (informational only)

- Severity: **Informational**
- CWE: n/a
- Evidence:
  - `git show 7bae649 -- page_source.html` (the commit "Add test scripts for
    data extraction and scraping", Dec 2025) introduced a 1374-line TCGplayer
    scrape that contains strings like
    `name="__zoid__paypal_message__eyJzZW5kZXIi…"`.
  - `git show 7373817 -- page_source.html` ("chore(security): repo hygiene")
    deleted the file and added `page_source.html` + `*.scrape.html` to
    `.gitignore` (verified at `.gitignore:18-19`).
  - Manually decoded the first `eyJ…` blob from history; it is a base64'd JSON
    object (`{"sender":{"domain":"https://www.tcgplayer.com"}, …}`) — PayPal's
    `zoid` cross-frame messaging payload, **not** a JWT and **not** a secret
    of any kind.
- Why it matters: a casual grep for `eyJ` in `git log -p` will surface these
  blobs and look alarming. Confirmed harmless after decoding.
- Remediation: none required. Optionally annotate the repo history note in
  `audits/` so future audits don't re-trigger on these blobs. If/when this
  repo is ever made public, consider a `git filter-repo` pass to strip the
  blob purely on cleanliness grounds (it's 424 KB of marketing iframe noise),
  but it leaks nothing.
- Defense-in-depth: the CI secret-scan step (`.github/workflows/ci.yml:57-69`,
  TruffleHog with `--only-verified`) will not flag these because none of them
  verify against a live provider.

---

## Inventory: everywhere a secret is referenced

### Live `process.env.*` usages (frontend)

Verified via `grep -rEn 'process\.env\.' frontend/`:

| Variable | Locations | Type |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `app/lib/supabase.ts:8`, `app/lib/serverSupabase.ts:9`, `app/lib/serverMarketData.ts:20`, `app/components/ProductPrices.tsx:12`, `app/api/account/delete/route.ts:40`, `app/api/account/export/route.ts:40`, `app/auth/callback/route.ts:40`, `middleware.ts:41` | public identifier |
| `NEXT_PUBLIC_SUPABASE_KEY` | same modules as above (sister lines) + `middleware.ts:42` | `sb_publishable_…` — public-safe |
| `NEXT_PUBLIC_SITE_URL` | `app/api/account/delete/route.ts:6`, `app/api/account/export/route.ts:7` | public |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `app/auth/signup/page.tsx:179`, `app/auth/login/page.tsx:104` | public (Cloudflare site key is intentionally public; the *secret* counterpart lives in Supabase Auth dashboard, not the repo) |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | `sentry.client.config.ts:11`, `sentry.server.config.ts:3`, `sentry.edge.config.ts:3` | DSN — per Sentry's threat model, the public DSN is intentionally a publishable identifier |
| `SENTRY_AUTH_TOKEN` | `next.config.ts:67, 70` | **secret** — only read at *build* time on Vercel; never bundled. Currently unset (see "Unable to verify"). |
| `SENTRY_ORG`, `SENTRY_PROJECT` | `next.config.ts:68-69` | non-secret config |
| `NODE_ENV` | several | runtime mode |

There is **no** reference to `SUPABASE_SERVICE_ROLE_KEY` anywhere in
`frontend/` — the account-delete and account-export routes use the SECURITY
DEFINER RPCs (`delete_my_account`, `export_my_data`) bound to the
authenticated user's anon session, so the web tier no longer needs the
secret key at all (`api/account/delete/route.ts:64-67`,
`api/account/export/route.ts:64-67`). This is an improvement over the
previous design called out in `audits/api-and-infrastructure.md:16` and
`audits/comprehensive-security-report.md:87`.

### Live env-var usages (Python scrapers)

All five entrypoints route credential loading through
`secrets_loader.load_supabase_credentials()`:

- `main.py:24-26, 233`
- `backfill_historical_prices.py:41-43, 55`
- `compare_prices.py:25-30, 49` (also loads Shopify via
  `load_shopify_credentials()` with CLI/env/file fallback at lines 52-57)
- `generate_skus.py:22-24, 35`
- `update_shopify_skus.py` — does **not** load Supabase credentials (CSV-only
  utility; verified by reading the file).

`secrets_loader.py:15-25` implements env-first lookup, then falls back to
`secretsFile` for local dev. See **S-3** for a minor priority-order nit.

### `.gitignore` posture (verified)

```
$ git check-ignore -v .env .env.local .env.production secretsFile.py frontend/.env.local
.gitignore:7:.env       .env
.gitignore:8:.env.*     .env.local
.gitignore:8:.env.*     .env.production
.gitignore:1:secretsFile.py     secretsFile.py
frontend/.gitignore:34:.env*    frontend/.env.local
```

All four patterns match — none of these paths could be committed
unintentionally. **Pass.**

### Tracked file inventory for env/secrets/vercel

```
$ git ls-files | grep -E '\.env|secretsFile\.py$|vercel'
frontend/public/vercel.svg
```

Only the Vercel logo asset. No `.env*`, no `secretsFile.py`, no `vercel.json`
(which means deploy config lives entirely in the Vercel dashboard — see
"Unable to verify"). **Pass.**

### Git-history sweep for known secret patterns

| Pattern | Occurrences in history (excluding audit/HARDENING docs) |
|---|---|
| `sb_secret_<value>` | none (only the literal `sb_secret_...` placeholder in `run_scraper.sh:28` and the `sb_secret_…` documentation snippets in `audits/HARDENING_FOLLOWUPS.md`) |
| `sb_publishable_<value>` | none (only `sb_publishable_…` in audit prose) |
| `eyJ[real JWT]` | none in TS/JS/Python/JSON/SQL/YAML/SH. The `eyJ…` strings in the deleted `page_source.html` decode to PayPal iframe config — see S-6 |
| `shpat_<value>` | none (only the docstring example `shpat_xxx` at `compare_prices.py:15`) |
| `service_role` JWT body | none |
| `AKIA…`, `ghp_…`, `gho_…`, `xox[a/b/p/r/s]-…`, `sk_(live|test)_…`, `BEGIN … PRIVATE KEY` | none |
| Committed `secretsFile.py` | never committed (gitignored from day 1; no rows returned by `git log --all -- secretsFile.py`) |
| Committed `.env*` | never committed |

Verified by `git log --all -p -G "<pattern>"` for each. **Pass.**

### Test fixtures

`tests/test_main.py:20-22`, `tests/test_backfill_enhanced.py:27-29`,
`tests/test_new_functions.py:23-25` each set:

```python
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'
```

`frontend/app/lib/__tests__/supabase.test.ts:18-19` sets:

```ts
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_KEY = "test-anon-key-12345";
```

Both are obviously-fake placeholders that match no real Supabase project
domain. **Pass.**

### CI workflow (`.github/workflows/ci.yml`)

- No `${{ secrets.X }}` references at all (verified by reading the file).
- Every job runs as the public checkout; nothing requires repository secrets.
- TruffleHog runs with `--only-verified` over the full PR diff vs default
  branch (lines 57-69) — this is the active control that would catch a
  future accidental secret commit.

This is the safest possible CI posture for this topic. **Pass.**

### Sentry wiring

- `sentry.client.config.ts:11-12`, `sentry.server.config.ts:3-4`,
  `sentry.edge.config.ts:3-4` all gate `Sentry.init({…})` behind the presence
  of the DSN. No DSN → no telemetry, no leaked bundle.
- The DSN itself is not a secret (Sentry's threat model treats it as a
  publishable identifier; misuse only enables low-cost event spamming, which
  the project-level rate-limit handles).
- `next.config.ts:64-77` reads `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
  `SENTRY_PROJECT` exclusively from `process.env` at build time; the
  `silent: !process.env.SENTRY_AUTH_TOKEN` flag makes the no-op case
  observable. **Pass.**

### Migrations / SQL

`grep -rEn '(eyJ|sb_secret|sb_publishable|password|api[_-]?key)' migrations/`
returns only role names (`anon`, `authenticated`, `service_role`) and table
comments. No DDL embeds any secret. **Pass.**

### Custom crypto

```
$ grep -rEn '(cipher|aes|hmac|pbkdf2|bcrypt|argon|crypto\.)' app/ -- TS/Py
app/components/BoxCalculator/hooks/useBoxRecipes.ts:9-13   crypto.getRandomValues  ✓ CSPRNG, 128-bit share code
app/components/BoxCalculator/hooks/useBoxRecipes.ts:45     crypto.randomUUID       ✓
app/components/BoxCalculator/BoxCalculator.tsx:152         crypto.randomUUID       ✓
app/lib/portfolio.ts:200                                    crypto.randomUUID       ✓ idempotency key
```

No custom encryption, no key derivation, no application-managed signing keys.
Sessions and tokens are entirely Supabase Auth's responsibility (ECC P-256
asymmetric per `audits/HARDENING_FOLLOWUPS.md:151-153`, configured in the
dashboard — out of repo). **Pass.**

---

## Unable to verify (requires dashboard access)

| ID | Claim | What would prove it |
|---|---|---|
| U-1 | Vercel `NEXT_PUBLIC_SUPABASE_KEY` is currently `sb_publishable_…` (not the legacy anon JWT) | Vercel → Pokefin project → Settings → Environment Variables → Production scope → reveal value, confirm `sb_publishable_` prefix. |
| U-2 | Vercel has **no** `SUPABASE_SERVICE_ROLE_KEY` in the web-tier env | Same panel; the variable must be absent (or scoped to a non-web project). |
| U-3 | Vercel has **no** `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` (the catastrophic typo scenario from `audits/api-and-infrastructure.md:146`) | Same panel; assert absent. |
| U-4 | `$HOME/.config/pokefin/env` on the scraper host has `chmod 600` and contains `SUPABASE_SERVICE_ROLE_KEY=sb_secret_…` (not a legacy JWT) | `stat -c '%a %U %G' ~/.config/pokefin/env` should return `600 <user> <user>`; `grep ^SUPABASE_SERVICE_ROLE_KEY= ~/.config/pokefin/env \| sed 's/=.*=/=sb_/' ` should start with `sb_secret_`. |
| U-5 | `secretsFile.py` on the scraper host has blanked credentials (per `audits/HARDENING_FOLLOWUPS.md:157`) | `cat ~/Pokefin/secretsFile.py` should match `SUPABASE_URL = ""` / `SUPABASE_KEY = ""`. |
| U-6 | Legacy anon + service_role JWTs are actually revoked in Supabase | Supabase Dashboard → Project Settings → API Keys → no legacy `eyJ…` keys listed (or they appear with "revoked" badge). Test from a terminal with the old key: `curl -H "apikey: <old eyJ…>" https://<ref>.supabase.co/rest/v1/profiles` should return 401. |
| U-7 | HS256 standby signing key is still scheduled for retirement at ~30 days post-2026-05-27 | Supabase Dashboard → Auth → JWT signing keys → standby HS256 entry shows expected retirement date, or a calendar reminder is set. |
| U-8 | Cloudflare Turnstile **secret** is set in Supabase Auth → Attack Protection (not in the repo) | Supabase Dashboard → Auth → Configuration → Attack Protection → secret field populated; cross-check with `audits/HARDENING_FOLLOWUPS.md:75`. |
| U-9 | `SENTRY_AUTH_TOKEN` (if Sentry source-map upload is enabled) is set **only** in Vercel and **only** in build-scope env, not exposed to client | Vercel → Environment Variables → confirm `SENTRY_AUTH_TOKEN` (if present) is scoped to Build, not Runtime, and not `NEXT_PUBLIC_*`. |

None of U-1…U-9 can be confirmed from the repository contents alone.

---

## Top prioritised fixes

1. **S-1**: Add `SECRETS_ROTATION.md` (or expand `HARDENING_FOLLOWUPS.md` §7)
   with concrete rotation steps per credential. **Medium** — biggest practical
   improvement; no code change.
2. **S-5**: Update `.github/copilot-instructions.md:92-101` to describe the
   env-first workflow so future AI-assisted edits don't regress.
3. **S-4**: Commit a `frontend/.env.example` (and a sibling scraper example)
   to make the documented onboarding path actually work.
4. **S-2**: Switch the build-time placeholders in
   `frontend/app/lib/supabase.ts` / `serverSupabase.ts` /
   `serverMarketData.ts` to a build-vs-runtime branch that throws at runtime
   when env vars are missing, so a misconfigured deploy fails fast.
5. **S-3**: Tighten env-priority in `secrets_loader.py` so `SUPABASE_KEY` in
   the shell environment is always checked before
   `secretsFile.SUPABASE_KEY`.

---

## Checklist for the four numbered audit topics

| # | Topic | Result | Notes |
|---|---|---|---|
| 1 | No hardcoded secrets in code or git history | **Pass** | No `sb_secret_…`, no `sb_publishable_…`, no real `eyJ…` JWT, no `shpat_…`, no AWS/GitHub/Slack/Stripe tokens. `secretsFileTemplate.py` is empty strings. Test fixtures use obvious placeholders. Legacy anon/service_role JWTs that were in the dashboard are now revoked, so even prior log captures (none found in this repo) would not be exploitable. The `eyJ…` blobs in the deleted `page_source.html` are PayPal iframe configs, not credentials. |
| 2 | Env-var usage; `.env`/`.env.*` not in git | **Pass** | Root `.gitignore` covers `.env`, `.env.*`, `secretsFile.py`; `frontend/.gitignore` covers `.env*`. `git check-ignore` confirms. No `.env*` is tracked. Vercel/Supabase/CI separation is implemented; production vs. dev separation done via Vercel project scopes (Unable to verify the actual values — see U-1…U-3). |
| 3 | Documented rotation procedure | **Fail (Medium)** | One-time May-2026 rotation is recorded in `audits/HARDENING_FOLLOWUPS.md`, but there is no recurring rotation runbook for the Supabase secret/publishable keys, Turnstile secret, Sentry auth token, or DB password. See S-1. |
| 4 | Encryption key management | **Pass (Not Applicable for custom crypto)** | App-side cryptography is limited to `crypto.getRandomValues` / `crypto.randomUUID` for share codes and idempotency keys. All signing/encryption keys live in Supabase (ECC P-256 active + HS256 standby per `HARDENING_FOLLOWUPS.md:151-153`). No custom key derivation, salting, or key storage exists in this repo. |

---

## Summary risk score

**2 / 10 (Low).** No Critical or High findings. The only Medium item is the
absence of a written rotation runbook (S-1), which is operational hygiene
rather than a vulnerability. All other findings are Low / Informational.
