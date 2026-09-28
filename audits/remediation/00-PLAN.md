# Pokéfin Remediation Plan

This plan fixes every finding in `audits/2026-09-25-security-performance-ux-review.md`. All 89 root causes are assigned to 22 work packages (WP00 to WP21). Each work package is one pull request with its own spec file in this folder. A spec is written so that a model with no prior context can execute it alone.

<!-- ORDER_TABLE -->

## How the order was chosen

1. **Protect every later change first.** WP00 adds a local build harness and a CI build step, so any later PR that breaks `next build` fails in CI instead of on Vercel.
2. **Restore what is broken for users.** The data export (WP01) and every signed-in feature (WP04 to WP06) have been failing in production for months. Nothing else matters as much to an account holder.
3. **Close cheap security gaps next.** WP02 is a batch of small, contained fixes: login lockout, captcha, password reset wiring and error hygiene.
4. **Make the primary page fast.** `/prices` is the catalog most visitors land on. WP07 to WP09 fix its dates, its search, its first paint and its scrolling, in that order, because each builds on the previous one.
5. **Cut database cost and add caching** (WP10 and WP11) once the code that calls those queries has settled.
6. **Then polish and harden.** This covers bundle size, SEO, accessibility, visual consistency, the Python pipeline, lint and tests, and finally the larger refactors and database least-privilege work. These have lower user impact per hour, and several depend on the earlier restructuring.

<!-- PARALLEL_TRACKS -->

## How to execute a work package

Give the executing model this prompt, with the work package id filled in:

```text
You are implementing one work package of the Pokéfin remediation plan.

Read audits/remediation/00-PLAN.md, then audits/remediation/<WPxx-file>.md in full.
Follow the spec exactly. If the current code differs from what the spec
describes (line numbers moved, a function was renamed), adapt to the current
code but keep the spec's intent. If the code makes a spec step impossible
or wrong, stop and explain why instead of improvising a different design.

Rules:
- Create the branch named in the spec from the latest master.
- Stay inside this work package's scope. Do not fix other findings you notice;
  list them in the PR description instead.
- Never skip, disable or weaken a test to get green.
- Run every command in the spec's Verification section and paste the results
  into the PR description.
- Do not apply database migrations to production. List them under
  "Owner actions" in the PR description.
- Commit with the message suggested in the spec. Open a PR with the suggested
  title and body.
```

After each PR merges, complete that spec's **Owner actions** before starting the next work package that depends on it. Migrations in particular must be applied in Supabase before the code that relies on them is deployed.

## Standard verification commands

Run from `frontend/` unless a spec says otherwise:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run lint
pnpm test --ci
pnpm build:stub        # available after WP00; builds against a local Supabase stub
```

For the Python pipeline, run this from the repo root inside a virtualenv with `requirements.txt` installed:

```bash
python -m pytest tests/ -q
```

Lint currently reports 16 pre-existing errors and does not block CI until WP17. Until then, a PR must not add new lint errors in the files it touches.

<!-- OWNER_CHECKLIST -->

## Definition of done for the whole plan

- Every finding id in the review maps to a merged PR. The table above is the index.
- CI blocks on typecheck, lint, tests and build (WP00, WP17).
- A signed-in user can load and edit a portfolio, save and share a box recipe, change their username and export their data.
- `/prices` HTML contains product cards before JavaScript runs. Typing in search makes no network requests, and scrolling loads no charting library.
- The market metrics RPC stays well under the 3 s anonymous timeout, and server revalidation happens once per scrape instead of hourly.
