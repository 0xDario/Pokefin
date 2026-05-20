# Pokefin Hardening — Manual Follow-ups Status

The code commits on `claude/security-vulnerability-analysis-LT3JQ`
land the file-level fixes (RLS migrations, security headers,
middleware, SSR cookies, account-delete RPC, CSRF gate, defense-in-
depth filters, CSPRNG share codes). A few items can't be fixed from
the repo alone and require dashboard/infra configuration.

Status snapshot (2026-05-19):
- Completed: sections 1, 2 (except leaked-password toggle), and 3.
- Deferred by plan: leaked-password protection (Supabase Pro+ feature).
- Remaining optional/deferred work: sections 4-6.

## 1. Apply the new migrations to production (done)

Applied in production via Supabase MCP in numeric order. They are
idempotent and safe to re-run.

```bash
supabase db push                  # or paste each file in the SQL editor
# Files (in order):
#   migrations/0001_enable_rls_and_policies.sql
#   migrations/0002_account_deletion.sql
#   migrations/0003_integrity_constraints.sql
#   migrations/0004_handle_new_user_trigger.sql
#   migrations/0005_box_recipes_share_code_hardening.sql
#   migrations/0006_function_execute_grants_hardening.sql
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

## 4. Rate limiting (deferred — needs Upstash)

The audit's H-5 fix uses `@upstash/ratelimit` + `@upstash/redis`. Not
yet committed because it requires an Upstash account. To enable:

```bash
cd frontend
npm install @upstash/ratelimit @upstash/redis
```

Then add to `frontend/middleware.ts` inside the existing `middleware`
function (before the auth gate):

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.fixedWindow(60, "1 m"),
  prefix: "pokefin:rl",
});

const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/auth/")) {
  const { success } = await limiter.limit(`ip:${ip}`);
  if (!success) return new NextResponse("Too Many Requests", { status: 429 });
}
```

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel.
Cloudflare WAF rate-limiting rules are an equivalent alternative.

## 5. Privacy + GDPR follow-ups (not security but compliance)

- Publish a privacy notice at `/privacy` (Art. 13 / 14).
- Add an "Export my data" route that returns the user's portfolios +
  holdings + box recipes as JSON or CSV (Art. 15 / 20).
- Add an `auth_events` audit table written from a Supabase trigger on
  `auth.users` (Art. 33).

## 6. Manual verification curl/SQL suite

After deploying, run the testing guide from
`audits/comprehensive-security-report.md` §Testing Guide (T1–T11).
All probes should return the expected 401/403/429/redirect results.
