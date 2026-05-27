# Pokefin Hardening — Manual Follow-ups Status

The code commits on `claude/security-vulnerability-analysis-LT3JQ`
land the file-level fixes (RLS migrations, security headers,
middleware, SSR cookies, account-delete RPC, CSRF gate, defense-in-
depth filters, CSPRNG share codes). A few items can't be fixed from
the repo alone and require dashboard/infra configuration.

Status snapshot (2026-05-27):
- Completed: sections 1 (pending 0008-0011 apply), 2 (except leaked-
  password toggle), 3, 4 (in-memory rate limiter shipped), 5 (privacy
  page + data export shipped).
- Deferred by plan: leaked-password protection (Supabase Pro+ feature),
  Upstash upgrade path noted but not required for current scale.
- Remaining optional work: section 6 (manual curl/SQL verification).

## 1. Apply the new migrations to production (done)

Applied in production via Supabase MCP in numeric order. They are
idempotent and safe to re-run.

```bash
supabase db push                  # or paste each file in the SQL editor
# Files (in order):
#   migrations/0001_enable_rls_and_policies.sql                 (applied)
#   migrations/0002_account_deletion.sql                        (applied)
#   migrations/0003_integrity_constraints.sql                   (applied)
#   migrations/0004_handle_new_user_trigger.sql                 (applied)
#   migrations/0005_box_recipes_share_code_hardening.sql        (applied)
#   migrations/0006_function_execute_grants_hardening.sql       (applied)
#   migrations/0007_search_path_hardening.sql                   (applied)
#   migrations/0008_box_recipes_rls_hardening.sql               (apply)
#   migrations/0009_db_resource_guards.sql                      (apply)
#   migrations/0010_audit_log.sql                               (apply)
#   migrations/0011_export_my_data.sql                          (apply)
```

Verification queries were run and passed for RLS/policies, constraints,
and function presence/grants.

```sql
-- Every public table should have rls_on = t and policy_count >= 1.
SELECT tablename,
       rowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename) AS policy_count
  FROM pg_tables t
 WHERE schemaname = 'public'
 ORDER BY tablename;
```

```sql
-- delete_my_account exists and is granted to authenticated only
SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner
  FROM pg_proc WHERE proname IN ('delete_my_account','get_shared_recipe','handle_new_user');
```

If `0003_integrity_constraints.sql` fails on `purchase_date <= current_date`
because pre-existing rows already violate it, fix the offending rows
first (`SELECT id, purchase_date FROM portfolio_holdings WHERE purchase_date > current_date`)
and rerun.

## 2. Supabase dashboard settings (mostly done)

These are configured in the project dashboard (not in code):

| Setting | Where | Required value | Status | Audit ref |
|---|---|---|---|---|
| Site URL | Auth → URL Configuration | `https://pokefin.ca` | Done | M-3 |
| Redirect URLs allowlist | Auth → URL Configuration | `https://pokefin.ca/auth/callback`, `https://pokefin.ca/auth/reset-password` (+ localhost for dev) | Done | M-3, L-1 |
| Captcha protection | Auth → Configuration → Attack Protection → Bot and Abuse Protection | Enable Turnstile, paste secret | Done | H-5, L-3 |
| Leaked password protection | Auth → Configuration → Attack Protection | Enable HIBP check | Deferred (Supabase Pro+ only) | L-2 |
| Minimum password length | Auth → Configuration → Password Security | 12 (current code allows 8) | Done | L-2 |
| Rate limits | Auth → Rate Limits | Defaults are conservative — verify | Done | H-5 |
| Email templates / confirmation | Auth → Email Templates / Providers | PKCE-compatible links and email confirmation enabled | Done | M-2 |

## 3. Vercel environment variables (done)

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Already set |
| `NEXT_PUBLIC_SUPABASE_KEY` | Supabase anon key | Already set |
| `NEXT_PUBLIC_SITE_URL` | `https://pokefin.ca` | Added in production |
| `SUPABASE_SERVICE_ROLE_KEY` | (remove) | Not present in production env list |

After redeploying, security headers were verified on `https://www.pokefin.ca`.

```bash
curl -sI https://pokefin.ca | grep -iE 'content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy'
```

All six headers should appear.

## 4. Rate limiting (shipped: in-memory limiter)

Implemented in `frontend/app/lib/rateLimit.ts` and wired into
`frontend/middleware.ts`. 60 req/min general, 5 req/min for
`/api/account/*` and `/auth/*`. Limit state is per-instance (not
durable across serverless cold starts) — that's the known tradeoff
for shipping without an external account.

Upgrade path: when scale or attacker volume justifies it, swap to
Upstash Redis:

```bash
cd frontend
npm install @upstash/ratelimit @upstash/redis
```

Then replace the call in `middleware.ts` with the Upstash limiter
keyed identically (`${routeClass}:${ip}`). Set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel.
Cloudflare WAF rate-limiting rules are an equivalent alternative
that needs no code change.

## 5. Privacy + GDPR (shipped)

- `/privacy` page lists data we collect, sub-processors, retention,
  and user rights (Art. 13/14).
- "Export my data" button on `/account` calls the new
  `POST /api/account/export`, which invokes the `export_my_data()`
  RPC (migration `0011`) and downloads a JSON of profile +
  portfolios + holdings + lots + box recipes (Art. 15/20).
- `auth_events` table populated by a trigger on `auth.users` (created
  / deleted / password_changed / email_confirmed) plus explicit
  `account_deletion_requested` and `data_exported` rows from the
  RPCs (Art. 33 prerequisite). Migration `0010`.

## 6. Manual verification curl/SQL suite

After deploying, run the testing guide from
`audits/comprehensive-security-report.md` §Testing Guide (T1–T11).
All probes should return the expected 401/403/429/redirect results.

## 7. Round-2 follow-ups (do after deploy)

- **Apply migrations 0008–0011** via Supabase MCP / CLI.
- **Optional**: create a Sentry project, add `NEXT_PUBLIC_SENTRY_DSN`
  to Vercel (and `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
  if you want source-map upload). Sentry wiring is no-op until DSN is
  set.
- **Rotate the scraper key**: now that the four Python scripts read
  `SUPABASE_SERVICE_ROLE_KEY` from env via `secrets_loader.py`, rotate
  the existing key, set the new one on the scraper host, then delete
  `secretsFile.py` from the host. Local dev can keep using
  `secretsFile.py` per `.gitignore`.
- **Review `/privacy` page copy** for legal accuracy and add a contact
  email/handle (currently points at the GitHub repo).
- **CI**: confirm the new GitHub Actions workflow runs on the next PR
  (tsc + lint + jest + npm audit + pip-audit + trufflehog).
