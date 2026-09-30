# WP00: Local build harness and CI build gate

- **Findings covered**
  - F127 (full): the secret-scan job runs the third-party action `trufflesecurity/trufflehog@main` (a mutable branch ref that also pulls the mutable `:latest` scanner image), the workflow declares no `permissions:`, and checkouts persist the GITHUB_TOKEN into `.git/config`.
  - F076 (partial, cluster members F037, F052, F064, F139): only two parts are in scope here: (a) run `next build` in CI, made possible without a Supabase project or secrets by a local Supabase stub; (b) fix the pnpm version drift between CI (`version: 10`) and `frontend/package.json` (`pnpm@11.20.0`). Making lint blocking and fixing the 16 lint errors is WP17. Rewriting `.github/copilot-instructions.md` (F052) is WP20.
  - Prerequisite, not a finding: the required `pnpm audit (high+ severity)` check is red today, independent of this PR. On 2026-09-30 `pnpm audit --audit-level high --prod` exits 1 with two high advisories on the transitive `brace-expansion@5.0.9` (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p; path `@sentry/nextjs > @sentry/bundler-plugin-core > glob > minimatch > brace-expansion`), published after the 2026-09-25 review found the audit clean. Step 7 raises the existing `brace-expansion@5` override so the WP00 PR can go green. This is the only lockfile change in this WP.
- **Priority rationale**: F076 is medium severity (re-verified 2026-09-30); F127 is the other covered finding. Every later work package needs a trustworthy "does it still build" check. Today the only one is the Vercel deployment (a preview per PR, not a required check, and the production deploy after merge). That is how Dependabot PR #52 (TypeScript 6 to 7, merged as `e395874` on 2026-07-29) left `master` unbuildable until the owner hand-reverted it two hours later in `072cf6d`. Vercel does not promote a failed production build, so the live site kept serving the previous deployment: the damage is blocked deploys (including urgent fixes), not an outage.
- **Effort**: S, about 2 to 3 hours including one CI round trip.
- **Depends on**: none.
- **Unblocks**: WP02, WP03, WP07, WP16 directly, and every later WP through them (all of them reuse `pnpm build:stub` in their Verification section).
- **Suggested branch name**: `remediation/wp00-build-harness-ci-gate`
- **Risk level**: low. CI and dev tooling only; no runtime code, no migrations, no Vercel build change. The one dependency change (step 7) is a patch bump of a transitive, build-time-only package (`brace-expansion` 5.0.9 to 5.0.12, under the Sentry bundler plugin). The worst failure mode is a red CI check, fixed by revert.

## Why

`next build` never runs in CI (`.github/workflows/ci.yml:25-36` only runs install, `tsc`, a non-blocking lint and jest), so a dependency bump or a `next.config.ts` / Sentry / Turbopack change that breaks the production build is only discovered by Vercel (its per-PR preview check, which is not required, or the production deploy after merge). That has already happened once (`.github/dependabot.yml:18-23`). A plain local or CI build cannot even run today, because five pages (`/`, `/prices`, `/market`, `/stats`, `/analytics`) are prerendered and call Supabase RPCs at build time; with a placeholder URL the build dies with `getaddrinfo ENOTFOUND` on `/analytics`. After this PR, `pnpm build:stub` builds the whole app against a tiny local Supabase stub, with no Supabase project, no secrets and no `.env.local` (it still needs the internet access any build needs: `next/font/google` in `app/layout.tsx` downloads the Geist fonts from Google Fonts at build time). CI runs it on every PR inside the already-required "Frontend" check, and CI installs with the pnpm version pinned in `frontend/package.json` (`packageManager: pnpm@11.20.0`) instead of pnpm 10. Separately, the secret-scan job stops executing unpinned third-party code and every job's token becomes explicitly read-only.

## Before you start

Read these files fully:

- `.github/workflows/ci.yml` (97 lines; the only workflow)
- `.github/dependabot.yml` (lines 41-44 track `github-actions` monthly)
- `frontend/package.json` (line 5: `"packageManager": "pnpm@11.20.0"`; line 8: `"build": "next build"`; scripts block lines 6-14)
- `frontend/pnpm-workspace.yaml` (uses the pnpm 11 `allowBuilds` key, which pnpm 10 ignores; pnpm 10 normally switches itself to the `packageManager` version, but CI should not depend on that; line 13 `brace-expansion@5: ^5.0.9` is changed in step 7)
- `frontend/jest.config.js` (line 20: `testPathIgnorePatterns`)
- `frontend/eslint.config.mjs` (lint runs `eslint .`, so new `.mjs` files under `frontend/scripts/` are linted)
- `frontend/app/lib/serverMarketData.ts:27-40` (env fallbacks), `:734-751` (`fetchLatestExchangeRate` uses `.single()`), `:891-925` (the `unstable_cache` wrappers, `revalidate: 3600`)
- `frontend/next.config.ts:79-101` (`withSentryConfig`; uploads source maps only when `SENTRY_AUTH_TOKEN` is set)
- `frontend/README.md`

Confirm the starting state (run from the repo root):

```bash
grep -n "trufflehog@main" .github/workflows/ci.yml            # expect line 89
grep -n "version: 10" .github/workflows/ci.yml                 # expect lines 19 and 48
grep -c "permissions" .github/workflows/ci.yml                 # expect 0
grep -c "persist-credentials" .github/workflows/ci.yml         # expect 0
grep -c "build" .github/workflows/ci.yml                       # expect 0
grep -n '"packageManager"' frontend/package.json               # expect pnpm@11.20.0
ls frontend/scripts 2>&1                                       # expect "No such file or directory"
ls package.json 2>&1                                           # expect "No such file" (no root package.json; this matters for step 5)
grep -n "brace-expansion@5" frontend/pnpm-workspace.yaml       # expect line 13: brace-expansion@5: ^5.0.9
(cd frontend && pnpm audit --audit-level high --prod; echo "exit=$?")
# expect exit=1 listing brace-expansion GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p (step 7 fixes this).
# If it prints exit=0, skip step 7. If it lists any OTHER high advisory, follow the rule in step 7.
```

Confirm the trufflehog pin (network permitting):

```bash
git ls-remote --tags https://github.com/trufflesecurity/trufflehog 'refs/tags/v3.97.9*'
# expect exactly one line: 4dd8831c5f12599465d4d45c3c447b4018a34c85  refs/tags/v3.97.9
```

`v3.97.9` is a lightweight tag (no `^{}` line), so that SHA is the commit. The matching image tag `ghcr.io/trufflesecurity/trufflehog:3.97.9` exists (checked 2026-09-30: HTTP 200 from the ghcr manifest API; `:v3.97.9` returns 404). Use exactly v3.97.9 even if a newer v3 tag exists: every grep and acceptance criterion below is written for it, and Dependabot's monthly github-actions run will move it forward later. If the command above prints a different SHA for v3.97.9 (a moved tag), stop and report it instead of pinning anything. If you have no network, use the v3.97.9 values above unchanged.

Assumptions to check: none of the four CI jobs pushes, comments, or writes checks (confirmed: no `git push`, no `gh`, no `secrets.*` anywhere under `.github/`). Branch protection on `master` requires the four checks by their job names (`Frontend (lint + typecheck + tests)`, `pnpm audit (high+ severity)`, `Python (pip-audit)`, `Secret scan (trufflehog)`), so those names must not change.

## Implementation steps

Do steps 1 to 4 and step 7 first and verify locally (see Verification) before step 5, so the CI change lands with a harness already known to work and an audit check that can pass. Step 6 (README) can be done at any point.

Copy the three script files byte-for-byte. WP08 later patches `supabase-stub.mjs` and `build-with-stub.mjs` by exact text (the `startSupabaseStub({ port = DEFAULT_STUB_PORT, onRequest } = {})` signature and its JSDoc `@param` line, the `if (accept.includes("application/vnd.pgrst.object+json")) { ... return; }` block followed by the default `res.writeHead(200, ...)`, the CLI block's `startSupabaseStub({ port, onRequest: ... })` call, and in the build script the `const stub = await startSupabaseStub({` / `port,` / `onRequest:` lines and the `Supabase stub listening on` log line). Renaming or restructuring any of these breaks WP08's instructions.

### 1. Add `frontend/scripts/supabase-stub.mjs` (new file)

A minimal PostgREST stand-in. Every request gets an empty result. Two deliberate refinements over the orchestrator's proof-of-concept stub (which answered everything `200 []` with `content-range: 0-0/0`):

- Requests with `Accept: application/vnd.pgrst.object+json` (what supabase-js `.single()` sends, see `@supabase/postgrest-js` `single()`) get `406` with code `PGRST116`, the same status and error code real PostgREST returns for zero rows (the `message` text differs between PostgREST versions; nothing in the app reads it). Without this, `fetchLatestExchangeRate` (`serverMarketData.ts:734-751`) receives `data = []`, reads `[].usd_to_cad` and caches `rate: undefined` into the prerendered pages; with it, the function takes its existing `DEFAULT_EXCHANGE_RATE` fallback. (`.maybeSingle()` in postgrest-js 2.112 sends a normal Accept header and maps `[]` to `null` client-side, so it needs nothing.)
- `content-range` is `*/0`, which is what PostgREST sends for an empty result. supabase-js only reads the part after `/`, so `0-0/0` and `*/0` both parse to count 0.

The module exports `startSupabaseStub()` for `build-with-stub.mjs` and the test, and also runs standalone for manual debugging.

```js
// Minimal stand-in for the Supabase REST API (PostgREST), used only to make
// `next build` work without network access to a real project.
//
// Every request gets an empty result:
//   - `Accept: application/vnd.pgrst.object+json` (supabase-js `.single()`)
//     gets 406 + PGRST116, the status and code real PostgREST returns for
//     zero rows, so callers take their "no row" fallback path.
//   - everything else gets 200, body `[]`, `Content-Range: */0`.
//
// Never point a deployed build at this stub: prerendered pages bake in an
// empty catalog.
//
// Usage:
//   node scripts/supabase-stub.mjs            # listens on 127.0.0.1:54321
//   SUPABASE_STUB_PORT=0 node scripts/supabase-stub.mjs   # ephemeral port
// Or import { startSupabaseStub } from another script.

import http from "node:http";
import { pathToFileURL } from "node:url";

export const DEFAULT_STUB_PORT = 54321;
const STUB_HOST = "127.0.0.1";

const PGRST116 = JSON.stringify({
  code: "PGRST116",
  details: "The result contains 0 rows",
  hint: null,
  message: "JSON object requested, multiple (or no) rows returned",
});

/**
 * Start the stub. Resolves once it is listening.
 * @param {{ port?: number, onRequest?: (method: string, url: string) => void }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startSupabaseStub({ port = DEFAULT_STUB_PORT, onRequest } = {}) {
  const server = http.createServer((req, res) => {
    // Drain the body (RPC calls POST JSON) before answering.
    req.resume();
    req.on("end", () => {
      const method = req.method ?? "GET";
      onRequest?.(method, req.url ?? "/");

      const accept = String(req.headers.accept ?? "");
      if (accept.includes("application/vnd.pgrst.object+json")) {
        res.writeHead(406, { "content-type": "application/json; charset=utf-8" });
        res.end(PGRST116);
        return;
      }

      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-range": "*/0",
      });
      res.end(method === "HEAD" ? undefined : "[]");
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, STUB_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://${STUB_HOST}:${boundPort}`,
        port: boundPort,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

// CLI mode: `node scripts/supabase-stub.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.SUPABASE_STUB_PORT
    ? Number(process.env.SUPABASE_STUB_PORT)
    : DEFAULT_STUB_PORT;
  const stub = await startSupabaseStub({
    port,
    onRequest: (method, url) => console.log(`${method} ${url}`),
  });
  console.log(`[supabase-stub] listening on ${stub.url} (Ctrl+C to stop)`);
  const stop = async () => {
    await stub.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
```

### 2. Add `frontend/scripts/build-with-stub.mjs` (new file)

Starts the stub, runs `next build` with the stub URL and a placeholder key, always stops the stub, and exits with `next build`'s exit code. Decisions baked in, each for a reason found in the code:

- **Ephemeral port by default (`port: 0`), not 54321.** 54321 is the Supabase CLI's local API port; a developer running `supabase start` would otherwise either collide (EADDRINUSE) or, worse, build against their local database. `SUPABASE_STUB_PORT` overrides it. The standalone stub CLI (step 1) still defaults to 54321 as the plan specifies.
- **Wipe `.next/cache/fetch-cache` before and after the build.** `unstable_cache` results are persisted there (`node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js`, `getFilePath` for `FETCH` writes to `.next/cache/fetch-cache`), with `revalidate: 3600`. Without the wipe, a real `pnpm build` or `next start` on the same machine within the hour can reuse the stub's empty results. (In CI this does not matter, because CI output is never deployed; the wipe protects developer machines, where every later WP runs `pnpm build:stub` next to real builds.)
- **Sentry vars set to empty strings, not deleted.** `@next/env` only fills variables that are `undefined` in `process.env` (`processEnv` in `@next/env/dist/index.js` checks `typeof p[t]==="undefined"`), so `""` stops a developer's `.env.local` from enabling Sentry or uploading source maps of a stub build; deleting the key would let `.env.local` win.
- **`next` resolved via `createRequire(...).resolve("next/dist/bin/next")` and run with `process.execPath`**, so it works without `pnpm` on PATH and on any OS.
- Drops a leading `--` that pnpm may forward, and forwards any other args to `next build` (for example `pnpm build:stub --debug`).
- Prints a per-endpoint count of stub requests. Later WPs use this to see exactly which Supabase calls happen at build time.

```js
// Run `next build` against the local Supabase stub (scripts/supabase-stub.mjs)
// so the five prerendered pages (/, /prices, /market, /stats, /analytics) can
// be built without a Supabase project, secrets or .env.local. (The build
// still needs internet access for next/font/google.) Used by CI and by every
// remediation work package as the "does it still build" check.
//
// Usage (from frontend/):  pnpm build:stub [extra next build flags]
//
// Guarantees:
//   - the stub is always stopped, even when the build fails or is interrupted;
//   - the exit code is next build's exit code;
//   - .next/cache/fetch-cache (where unstable_cache persists results) is wiped
//     before and after, so stub data can never leak into a later real
//     `pnpm build` or `next start` on this machine.
//
// The resulting .next/ output contains EMPTY prerendered pages. Never deploy
// it. `next start` on it works (for header or routing checks) but serves no
// market data.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSupabaseStub } from "./supabase-stub.mjs";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fetchCacheDir = path.join(frontendDir, ".next", "cache", "fetch-cache");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

function clearFetchCache() {
  rmSync(fetchCacheDir, { recursive: true, force: true });
}

async function main() {
  // pnpm may forward a literal "--" before user args; drop it.
  const forwardedArgs = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));

  // Port 0 = ephemeral, so a local `supabase start` (which owns 54321) or a
  // second build cannot collide. Override with SUPABASE_STUB_PORT if needed.
  const port = process.env.SUPABASE_STUB_PORT ? Number(process.env.SUPABASE_STUB_PORT) : 0;
  const requestCounts = new Map();
  const stub = await startSupabaseStub({
    port,
    onRequest: (method, url) => {
      const key = `${method} ${url.split("?")[0]}`;
      requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    },
  });
  console.log(`[build:stub] Supabase stub listening on ${stub.url}`);

  let exitCode = 1;
  try {
    clearFetchCache();
    exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [nextBin, "build", ...forwardedArgs], {
        cwd: frontendDir,
        stdio: "inherit",
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: stub.url,
          NEXT_PUBLIC_SUPABASE_KEY: "stub-anon-key",
          NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
          // Empty strings (not deletes): @next/env only fills vars that are
          // undefined, so "" stops a developer's .env.local from enabling
          // Sentry or uploading source maps of a stub build.
          NEXT_PUBLIC_SENTRY_DSN: "",
          SENTRY_DSN: "",
          SENTRY_AUTH_TOKEN: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      });
      const forwardSignal = (signal) => child.kill(signal);
      process.on("SIGINT", forwardSignal);
      process.on("SIGTERM", forwardSignal);
      child.on("error", (err) => {
        console.error("[build:stub] failed to start next build:", err);
        resolve(1);
      });
      child.on("exit", (code, signal) => {
        process.off("SIGINT", forwardSignal);
        process.off("SIGTERM", forwardSignal);
        if (signal) console.error(`[build:stub] next build killed by ${signal}`);
        resolve(code ?? 1);
      });
    });
  } finally {
    await stub.close();
    clearFetchCache();
  }

  const summary = [...requestCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `  ${count}x ${key}`)
    .join("\n");
  console.log(`[build:stub] stub requests during build:\n${summary || "  (none)"}`);
  console.log(
    `[build:stub] next build exited with ${exitCode}. Output in .next/ has EMPTY data; never deploy it.`
  );
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error("[build:stub]", err);
  process.exitCode = 1;
});
```

### 3. Add `frontend/scripts/supabase-stub.test.mjs` (new file) and keep Jest away from it

Jest 30's default `testMatch` includes `**/?(*.)+(spec|test).?([mc])[jt]s?(x)`, which matches `scripts/supabase-stub.test.mjs`; Jest would try to run it under jsdom and fail on `node:test`. So:

3a. In `frontend/jest.config.js` line 20, change

```js
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
```

to

```js
  // scripts/ holds Node build tooling tested with `node --test` (pnpm test:scripts).
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/scripts/'],
```

3b. Create the test file (Node's built-in runner, no new dependency):

```js
// Run with: pnpm run test:scripts   (= node --test scripts/*.test.mjs)
// Jest is told to ignore scripts/ (jest.config.js testPathIgnorePatterns),
// so this suite runs only under the Node test runner.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startSupabaseStub } from "./supabase-stub.mjs";

let stub;
const seen = [];

before(async () => {
  stub = await startSupabaseStub({ port: 0, onRequest: (m, u) => seen.push(`${m} ${u}`) });
});

after(async () => {
  await stub.close();
});

test("RPC POST returns 200 [] with an empty content-range", async () => {
  const res = await fetch(`${stub.url}/rest/v1/rpc/get_market_product_summaries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_limit: 10 }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-range"), "*/0");
  assert.deepEqual(await res.json(), []);
  assert.ok(seen.includes("POST /rest/v1/rpc/get_market_product_summaries"));
});

test("table GET returns 200 []", async () => {
  const res = await fetch(`${stub.url}/rest/v1/exchange_rates?select=usd_to_cad&limit=1`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test(".single() requests get PostgREST's zero-row 406 PGRST116", async () => {
  const res = await fetch(`${stub.url}/rest/v1/exchange_rates?limit=1`, {
    headers: { accept: "application/vnd.pgrst.object+json" },
  });
  assert.equal(res.status, 406);
  const body = await res.json();
  assert.equal(body.code, "PGRST116");
});

test("supabase-js sees empty data, and single() takes its error path", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(stub.url, "stub-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = await client.rpc("get_set_analytics");
  assert.equal(rpc.error, null);
  assert.deepEqual(rpc.data, []);
  const single = await client.from("exchange_rates").select("usd_to_cad").limit(1).single();
  assert.equal(single.data, null);
  assert.equal(single.error?.code, "PGRST116");
});
```

### 4. `frontend/package.json`: add two scripts

In the `"scripts"` block (lines 6-14), add after `"build": "next build",`:

```json
    "build:stub": "node scripts/build-with-stub.mjs",
```

and after `"test:coverage": "jest --coverage"` (add a comma to that line):

```json
    "test:scripts": "node --test scripts/*.test.mjs"
```

Do not change `"build": "next build"`: Vercel runs it. Use exactly `scripts/*.test.mjs`; `node --test scripts/` treats the directory as a file and fails with MODULE_NOT_FOUND (verified on Node 22.22).

Resulting block:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "build:stub": "node scripts/build-with-stub.mjs",
    "start": "next start",
    "lint": "eslint .",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:scripts": "node --test scripts/*.test.mjs"
  },
```

This step adds no dependency and does not change `pnpm-lock.yaml`; the only lockfile change in this WP comes from step 7.

### 5. `.github/workflows/ci.yml`: build gate, pnpm pin, F127 hardening

Changes, by current line:

- After line 6 (end of `on:`), add top-level `permissions: contents: read`.
- Every `actions/checkout@v7` (lines 16, 45, 58, 86) gets `persist-credentials: false`. No job uses git credentials after checkout.
- Both `pnpm/action-setup@v6` steps (lines 17-19 and 46-48): remove `version: 10` and add `package_json_file: frontend/package.json`. The action's `package_json_file` input defaults to `package.json` **relative to the repository root** (pnpm/action-setup `action.yml`; the floating `v6` tag resolved to v6.0.10 on 2026-09-28 and v6.1.0 behaves the same: "This path must be relative to the repository root (GITHUB_WORKSPACE)"); `defaults.run.working-directory` does not apply to `uses:` steps, and there is no root `package.json`. Simply deleting `version:` would therefore fail with "No pnpm version is specified". Pointing it at `frontend/package.json` makes it install `pnpm@11.20.0` from `packageManager`, and leaves only one source of truth, which also avoids the action's "Multiple versions of pnpm specified" error that a `version:` input disagreeing with `packageManager` triggers.
- Frontend job: add `timeout-minutes: 20` (a hung build must not burn the 6-hour default), then after the `pnpm test --ci` step (line 36) add two steps: `pnpm run test:scripts` and `pnpm build:stub`. Adding them to the existing job (not a new job) means the build is covered by the already-required `Frontend (lint + typecheck + tests)` check with no branch-protection change. Keep the job `name:` byte-for-byte unchanged.
- Line 89: pin trufflehog to `4dd8831c5f12599465d4d45c3c447b4018a34c85 # v3.97.9` and add `version: "3.97.9"` under its `with:`. The action is a composite that runs `docker run "${IMAGE}:${VERSION}"` with `version` defaulting to `latest`, so the SHA pin alone would still execute an unpinned scanner.
- Leave the lint step's `continue-on-error: true` and its comment exactly as they are (WP17 owns that).

Replace the whole file with this (it preserves every existing comment and job; verified to parse with PyYAML and to keep the four job names):

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master]

# Least privilege for every job's GITHUB_TOKEN. No job pushes, comments or
# writes checks; they only read the repository. Declared here so the scope
# no longer depends on the repository's Actions settings.
permissions:
  contents: read

jobs:
  frontend:
    # Keep this name unchanged: branch protection on master requires the
    # check by its exact name.
    name: Frontend (lint + typecheck + tests)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      # No `version:` input: the action reads "packageManager" from
      # frontend/package.json (pnpm@11.20.0), so CI and local installs
      # resolve the lockfile with the same pnpm. Setting `version:` as well
      # makes the action fail with "Multiple versions of pnpm specified".
      - uses: pnpm/action-setup@v6
        with:
          package_json_file: frontend/package.json
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
          cache: "pnpm"
          cache-dependency-path: frontend/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsc --noEmit
      # Lint is reported but not blocking yet - the codebase has
      # pre-existing React 19 / Next 16 strict-mode violations (inline
      # components, setState-in-effect) that were never caught because
      # `next lint` was broken on master. Fixing them is a separate PR.
      - name: Lint (non-blocking)
        run: pnpm run lint
        continue-on-error: true
      # pnpm forwards a literal `--` to the script, which jest treats as a
      # path pattern; pass --ci directly instead of via `pnpm test -- --ci`.
      - run: pnpm test --ci
      - name: Build-harness tests (node --test)
        run: pnpm run test:scripts
      # Full `next build` against a local Supabase stub (no secrets, no
      # Supabase project). Catches Turbopack, Sentry plugin, next.config and
      # prerender failures that tsc and jest cannot see.
      - name: Production build (Supabase stub)
        run: pnpm build:stub

  audit:
    name: pnpm audit (high+ severity)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v6
        with:
          package_json_file: frontend/package.json
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      - run: pnpm audit --audit-level high --prod

  python:
    name: Python (pip-audit)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - run: pip install pip-audit
      # pip-audit hits PyPI's JSON API once per dependency and has no
      # built-in retry. A single TLS hiccup between the runner and PyPI
      # (e.g. Connection reset by peer mid-handshake) fails --strict.
      # Retry up to 3 times with backoff so transient flakes don't redden
      # CI; real CVE findings still exit non-zero on the first attempt
      # and again on retries, so the job still fails.
      - name: pip-audit (with retry on network flakes)
        run: |
          for attempt in 1 2 3; do
            if pip-audit --requirement requirements.txt --strict; then
              exit 0
            fi
            if [ "$attempt" -lt 3 ]; then
              echo "::warning::pip-audit attempt $attempt failed, retrying in 15s..."
              sleep 15
            fi
          done
          exit 1

  secret-scan:
    name: Secret scan (trufflehog)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          # trufflehog bind-mounts the workspace (including .git/config) into
          # its container and only reads local history; it needs no token.
          persist-credentials: false
      # Pinned to a commit SHA; Dependabot (github-actions ecosystem) bumps
      # SHA pins that carry a version comment.
      - uses: trufflesecurity/trufflehog@4dd8831c5f12599465d4d45c3c447b4018a34c85 # v3.97.9
        with:
          # The action runs `docker run ghcr.io/trufflesecurity/trufflehog:<version>`
          # and defaults to `latest`. Pin the scanner image too. Dependabot does
          # NOT bump this input: keep it equal to the version comment above
          # (no leading "v") whenever the SHA pin changes.
          version: "3.97.9"
          path: ./
          # On pull_request, diff the PR branch against the base. On push,
          # leave base/head unset so the action auto-detects from the push
          # event (otherwise master == HEAD and the action errors out).
          base: ${{ github.event_name == 'pull_request' && github.event.repository.default_branch || '' }}
          head: ${{ github.event_name == 'pull_request' && 'HEAD' || '' }}
          extra_args: --only-verified
```

### 6. `frontend/README.md`: document the harness

Insert this section after the "Getting Started" section (after line 21, before `## Learn More`):

````markdown
## Building without a Supabase project

Five pages (`/`, `/prices`, `/market`, `/stats`, `/analytics`) are prerendered and query Supabase at build time, so a plain `pnpm build` needs real `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` values. To check that the app builds without them (this is what CI runs):

```bash
pnpm build:stub
```

It starts `scripts/supabase-stub.mjs` (answers every Supabase REST call with an empty result) on a free local port, runs `next build` against it, stops it, and prints which Supabase endpoints the build called. No Supabase project, secrets or `.env.local` are needed, but the build still downloads the Geist fonts from Google Fonts (`next/font/google`), so it needs internet access. The resulting `.next/` has empty pages: never deploy it, and do not expect market data from `next start` after it. The script wipes `.next/cache/fetch-cache` before and after so stub results cannot leak into a later real build.

`pnpm test:scripts` runs the stub's own tests (`node --test`; Jest ignores `scripts/`).
````

### 7. `frontend/pnpm-workspace.yaml`: clear the high-severity audit advisories (skip if the starting-state audit printed `exit=0`)

The `pnpm audit (high+ severity)` job is a required check and currently fails on the transitive `brace-expansion@5.0.9` (see "Findings covered"). It is reached only through `@sentry/nextjs`'s build plugins (`glob > minimatch@10.2.6 > brace-expansion`), and `minimatch@10.2.6` accepts any `brace-expansion@^5.0.8`, so a patch-level override is enough. Verified on 2026-09-30 with pnpm 11.20.0: after this change the lockfile diff is exactly 5 changed lines (the `overrides:` entry, three `brace-expansion@5.0.9` references and that package's `resolution: {integrity: ...}` line), and `pnpm audit --audit-level high --prod` prints "No known vulnerabilities found".

7a. In `frontend/pnpm-workspace.yaml`, replace line 13

```yaml
  brace-expansion@5: ^5.0.9
```

with

```yaml
  # GHSA-6j4f-fj2g-mc7p (<5.0.10) and GHSA-qhr7-859c-m2p7 (<5.0.11), both high.
  # Reached only via @sentry/nextjs build plugins -> glob -> minimatch@10.
  brace-expansion@5: ^5.0.12
```

Leave the `brace-expansion@1` and `brace-expansion@2` lines unchanged.

7b. From `frontend/`:

```bash
pnpm install                                            # updates pnpm-lock.yaml (not --frozen-lockfile here)
git diff --stat pnpm-lock.yaml                          # expect 1 file changed, 5 insertions(+), 5 deletions(-)
git diff pnpm-lock.yaml | grep '^[-+] ' | grep -v -e brace-expansion -e 'resolution: {integrity:'   # expect no output
pnpm audit --audit-level high --prod; echo "exit=$?"    # expect "No known vulnerabilities found" and exit=0
pnpm install --frozen-lockfile                          # expect success, no further lockfile change
```

Rule if the starting-state audit listed a high advisory other than the two above: if the vulnerable package is transitive and a patched version exists in the same major, add or raise an override in `pnpm-workspace.yaml` the same way (with a comment naming the advisory), then re-run 7b. If the package is a direct dependency in `package.json`, or the fix needs a new major version, do not change it: stop and report the advisory to the owner in the PR, because that is a dependency upgrade outside this WP.

### Standard verification commands (for this and every later WP)

Later specs refer to this block as "the WP00 standard checks". Run from `frontend/` unless stated:

```bash
pnpm install --frozen-lockfile          # must not modify pnpm-lock.yaml
pnpm exec tsc --noEmit                  # expect exit 0, no output
pnpm exec eslint <every .js/.jsx/.mjs/.ts/.tsx file you changed under frontend/>   # expect 0 errors (list paths relative to frontend/; skip .md, .sql, .yaml, .json)
pnpm run lint                           # baseline before WP17: 33 problems (16 errors, 17 warnings); must not increase
pnpm test --ci                          # all suites pass (baseline 23 suites / 265 tests; later WPs add more)
pnpm exec jest <path> --ci              # targeted run of the suites a WP touched
pnpm run test:scripts                   # "# fail 0" (4 tests after WP00; WP08 adds more)
pnpm build:stub; echo "exit=$?"         # exit=0 and "[build:stub] next build exited with 0"
```

The route-table expectations (which routes show `Revalidate 1h`) in this spec's own Verification section describe the state after WP00 only; WP11 changes caching, so later WPs state their own route-table expectations. If `pnpm build:stub` fails with `Failed to fetch font` or `Failed to download` for Geist, the machine has no route to fonts.googleapis.com; that is a network problem, not a stub or code problem.

Python pipeline (repo root, inside a virtualenv with `requirements.txt` installed):

```bash
python -m pytest tests/ -q
```

Route-handler tests need `/** @jest-environment node */` as the first line, because `next/server` throws under the default jsdom environment.

## Pitfalls: do not do this

- **Do not skip step 7 when the starting-state audit fails, and do not "fix" the audit job instead** (no `continue-on-error`, no `--audit-level critical`, no `|| true`). The audit check is required; weakening it is out of scope and against the plan's rules. Do not bump `@sentry/nextjs` or any other direct dependency to clear an advisory in this WP.
- **Do not run `pnpm install --frozen-lockfile` to apply the override change.** It refuses to update the lockfile; use plain `pnpm install` once (step 7b), then `--frozen-lockfile` to confirm.
- **Do not rename any CI job or change a job `name:`.** Branch protection on `master` requires the four checks by exact name; a renamed job leaves the old required check pending forever and blocks every PR. That is also why the build is a step in the existing Frontend job rather than a new `build` job.
- **Do not just delete `version: 10`** from `pnpm/action-setup`. With no root `package.json` the action finds no `packageManager` and fails. Use `package_json_file: frontend/package.json` (F076 verifier correction: with no root `package.json`, deleting `version:` alone fails; `package_json_file` keeps `packageManager` as the single source of truth). Context: pnpm 10 already switches itself to the `packageManager` version when run in `frontend/` (`manage-package-manager-versions` defaults to true), which is why master CI is green today; this change makes the pin explicit instead of relying on that self-switch, so it is hygiene, not a bug fix.
- **Do not set `version: 11` alongside `package_json_file`.** Two sources can disagree on the next bump and the action errors with "Multiple versions of pnpm specified".
- **Do not SHA-pin trufflehog without also pinning `version:`** (F127 verifier correction). The SHA pins only the bash wrapper; the scanner that reads the checkout is `ghcr.io/trufflesecurity/trufflehog:${version}`, default `latest`.
- **Do not write `version: "v3.97.9"`.** The ghcr image tags have no `v` (`:3.97.9` exists, `:v3.97.9` returns 404) and the scan would fail to pull.
- **Do not use an annotated tag object's SHA.** If `git ls-remote` shows a `^{}` line for the tag, that line holds the commit; the other one is the tag object and Dependabot will not recognise it.
- **Do not point the CI build at the real Supabase project or add Supabase secrets to CI.** ci.yml deliberately references no `secrets.*`; Dependabot-triggered `pull_request` runs cannot read repository Actions secrets (only Dependabot secrets), and Dependabot PRs are exactly the risk this gate exists for. The anon URL and key are public (they ship in the client bundle), so hardcoding them in the workflow `env:` would also work, but a real-database build would make CI depend on production availability and put load on RPCs that already sit near the anonymous 3 s timeout. The 2026-09-30 F076 re-verification accepts the stub as equivalent and notes that an empty `unstable_cache` in CI is harmless because CI build output is never deployed; the stub is kept because it keeps CI hermetic. Making prerender resilient to a failing RPC is a runtime behaviour change and is not part of this WP (list it as a follow-up in the PR body).
- **Do not hardcode port 54321 in `build-with-stub.mjs`.** It is the Supabase CLI's local API port.
- **Do not delete the Sentry variables from the child env; set them to `""`.** Otherwise `.env.local` refills them and a stub build could upload source maps to Sentry.
- **Do not skip the `.next/cache/fetch-cache` wipe.** The stub's empty `unstable_cache` entries persist there for an hour and a later real build or `next start` on the same machine can serve them.
- **Do not deploy or `vercel deploy --prebuilt` the stub build output**, and never commit `.next/`. Running `next start` on it locally is fine for checks that do not need market data (WP02 does this for a rate-limit check), but its pages are empty.
- **Do not change the `"build"` script** or `next.config.ts`. Vercel's build must stay exactly as it is.
- **Do not make lint blocking or fix lint errors here.** That is WP17. The lint step and its comment stay unchanged.
- **Do not add fixture data to the stub in this PR.** The default response must stay empty. WP08 later adds one opt-in fixture behind `SUPABASE_STUB_FIXTURE`; it relies on the exact structure of the code in steps 1 and 2 (see the note at the top of "Implementation steps").
- **Do not name the stub test `*.test.js` or put it under `__tests__/`**, and do not skip the `jest.config.js` ignore: Jest 30 matches `.test.mjs` by default.
- **Do not SHA-pin the first-party actions** (`actions/checkout`, `setup-node`, `setup-python`, `pnpm/action-setup`) in this PR. Out of scope; Dependabot maintains their tags. Mention it as an optional follow-up.
- **Do not run `pnpm build:stub` in a checkout another agent is building in.** Both write `.next/`.
- **Do not commit `frontend/AGENTS.md` or `frontend/CLAUDE.md`.** Next 16.3's `next dev` writes them when it detects a coding agent (`ensureAgentRulesForDev` in `next/dist/server/lib/app-info-log.js`). They are not part of this WP; before committing, `git status --porcelain` must list only the files named in this spec.
- **Do not describe the harness as "offline" in comments, the README or the PR.** `next/font/google` (`app/layout.tsx:2`) downloads fonts at build time, so the build needs internet access; what it no longer needs is a Supabase project or secrets.

## Tests

- **Add** `frontend/scripts/supabase-stub.test.mjs` (full code in step 3b). Cases:
  1. `POST /rest/v1/rpc/get_market_product_summaries` returns 200, body `[]`, `content-range: */0`, and the request is reported to `onRequest`.
  2. `GET /rest/v1/exchange_rates?...` returns 200 `[]`.
  3. `Accept: application/vnd.pgrst.object+json` returns 406 with `code: "PGRST116"`.
  4. Through real `@supabase/supabase-js`: `rpc()` yields `data: []`, `error: null`; `.single()` yields `data: null`, `error.code === "PGRST116"`. This is the case that proves `fetchLatestExchangeRate` will take its fallback.
- **Update** `frontend/jest.config.js` (step 3a) so Jest ignores `scripts/`. `pnpm test --ci` must still report the same suite count as before (23 at the time of writing).
- No jest tests change. `build-with-stub.mjs` is exercised end to end by `pnpm build:stub` in CI; its failure paths are covered by the manual checks below.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
git diff --stat master -- pnpm-lock.yaml          # expect only step 7's change: 5 insertions(+), 5 deletions(-) (or nothing if step 7 was skipped)
pnpm audit --audit-level high --prod; echo "exit=$?"   # expect exit=0 (the audit CI job now runs this with pnpm 11.20.0)
pnpm exec tsc --noEmit                            # expect exit 0 (scripts/*.mjs are outside tsconfig "include")
pnpm exec eslint scripts/                         # expect exit 0, no output
pnpm run lint                                     # expect "33 problems (16 errors, 17 warnings)", unchanged; none in scripts/
pnpm test --ci                                    # expect 23 suites / 265 tests passed, no suite from scripts/
pnpm exec jest --listTests | grep -c scripts/     # expect 0
pnpm run test:scripts                             # expect "# pass 4" and "# fail 0"
```

Then run the build with its output captured, so the port and the inlined URL can be checked. All commands are non-interactive and run from `frontend/`. First define two small helpers (`lsof` and `ss` are not assumed to exist):

```bash
probe() { node -e "require('net').connect(+process.argv[1].split(':').pop(),'127.0.0.1').on('connect',()=>{console.log('STILL LISTENING');process.exit(1)}).on('error',()=>console.log('stub stopped'))" "$1"; }
stub_url() { grep -o 'http://127.0.0.1:[0-9]*' "$1" | head -1; }
```

```bash
pnpm build:stub > /tmp/wp00-build.log 2>&1; echo "exit=$?"     # expect exit=0
STUB_URL=$(stub_url /tmp/wp00-build.log); echo "$STUB_URL"      # expect http://127.0.0.1:<port>
test ! -e .next/cache/fetch-cache && echo "fetch-cache wiped"  # expect the message
grep -rlF "$STUB_URL" .next/static/chunks | head -1            # expect one file: the stub URL was inlined, proving the env override won over any .env.local
probe "$STUB_URL"                                              # expect "stub stopped"
cat /tmp/wp00-build.log                                        # read it against the expected output below
```

Expected content of `/tmp/wp00-build.log`: `[build:stub] Supabase stub listening on http://127.0.0.1:<port>`, then the normal Next 16.3 build, a route table where `/`, `/analytics`, `/market`, `/prices`, `/stats` show `Revalidate 1h` (confirmed against a stub build on 2026-09-27: `.next/prerender-manifest.json` lists `initialRevalidateSeconds: 3600` for exactly these five), then a request summary that includes at least `POST /rest/v1/rpc/get_market_product_summaries`, `POST /rest/v1/rpc/get_market_product_volume_metrics`, `POST /rest/v1/rpc/get_set_analytics` and `GET /rest/v1/exchange_rates`, and finally `[build:stub] next build exited with 0`.

Manual failure-path checks (revert each change afterwards). None needs a keyboard; `lsof` and `ss` are not assumed to exist.

1. Build failure propagates: add `throw new Error("wp00 probe");` as the first statement inside `export default async function StatsPage()` in `frontend/app/stats/page.tsx` (line 106; `/analytics` re-exports it, so both routes fail). Run `pnpm build:stub > /tmp/wp00-fail.log 2>&1; echo "exit=$?"`. Expect a non-zero exit, a prerender error mentioning `wp00 probe` in the log, and the `[build:stub] stub requests during build:` summary still printed at the end of the log. Then run `git checkout -- app/stats/page.tsx` and `probe "$(stub_url /tmp/wp00-fail.log)"`; expect `stub stopped`.
2. Port collision is reported, not hung:
   ```bash
   node -e "require('http').createServer().listen(54399,'127.0.0.1')" & HOLDER=$!
   node -e "setTimeout(()=>{},1000)"   # give the holder a second to bind
   SUPABASE_STUB_PORT=54399 pnpm build:stub; echo "exit=$?"
   kill $HOLDER
   ```
   Expect `EADDRINUSE` in the output and a non-zero exit (the script exits 1), within a few seconds.
3. Interrupt stops everything (the script forwards SIGINT/SIGTERM to `next build`, then closes the stub):
   ```bash
   node scripts/build-with-stub.mjs > /tmp/wp00-int.log 2>&1 & BPID=$!
   for i in $(seq 180); do grep -q "Creating an optimized production build" /tmp/wp00-int.log && break; node -e "setTimeout(()=>{},1000)"; done
   kill -INT $BPID; wait $BPID; echo "exit=$?"
   probe "$(stub_url /tmp/wp00-int.log)"
   ```
   Expect a non-zero exit within about 10 seconds of the kill, either `[build:stub] next build killed by SIGINT` or a non-zero `[build:stub] next build exited with` line at the end of the log, and `stub stopped`. No `next build` process may remain: `pgrep -fl "next/dist/bin/next build"` prints nothing. If the loop finished without seeing the line (3 minutes), read the log: the build failed or finished before the kill, so repeat the check.
4. Standalone stub on its default port:
   ```bash
   node scripts/supabase-stub.mjs > /tmp/wp00-cli.log 2>&1 & SPID=$!
   node -e "setTimeout(()=>{},1000)"
   curl -s -i -X POST http://127.0.0.1:54321/rest/v1/rpc/x
   kill $SPID; wait $SPID
   cat /tmp/wp00-cli.log
   ```
   Expect `HTTP/1.1 200 OK`, `content-range: */0` and body `[]` from curl, and the log to contain `[supabase-stub] listening on http://127.0.0.1:54321` and `POST /rest/v1/rpc/x`. If port 54321 is taken (a local `supabase start`), prefix the first line with `SUPABASE_STUB_PORT=54322` and use that port in the curl URL.

Workflow file (repo root):

```bash
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print(d['permissions']); print([j['name'] for j in d['jobs'].values()])"
# expect: {'contents': 'read'}
# expect: ['Frontend (lint + typecheck + tests)', 'pnpm audit (high+ severity)', 'Python (pip-audit)', 'Secret scan (trufflehog)']
grep -c "persist-credentials: false" .github/workflows/ci.yml     # expect 4
grep -c "version: 10" .github/workflows/ci.yml                     # expect 0
grep -n "trufflehog@" .github/workflows/ci.yml                     # expect a 40-hex SHA followed by "# v3.97.9"
grep -n 'version: "3.97.9"' .github/workflows/ci.yml               # expect 1 line
```

If `actionlint` is installed, run `actionlint .github/workflows/ci.yml` and expect no output.

In CI, after pushing the branch and opening the PR:

- All four checks are green. The Frontend job log shows `Build-harness tests (node --test)` and `Production build (Supabase stub)` steps, the latter ending with `next build exited with 0`.
- The `pnpm/action-setup` step log shows pnpm `11.20.0` being installed in both the Frontend and audit jobs.
- The secret-scan step log shows the image `ghcr.io/trufflesecurity/trufflehog:3.97.9` being pulled (not `:latest`).

## Owner actions

1. **Confirm branch protection still matches.** GitHub, repo `0xDario/Pokefin`, Settings, Branches (or Rules, Rulesets), the rule for `master`, "Require status checks to pass". Confirm the required list is still exactly the four job names above and that `Frontend (lint + typecheck + tests)` is among them. Confirmation: the WP00 PR shows all four as "Required" and mergeable once green. No change is needed if the names are listed.
2. **Optional, recommended: confirm the default token scope.** Settings, Actions, General, "Workflow permissions": select "Read repository contents and packages permissions" if it is not already. The workflow's new `permissions:` block makes this redundant for `ci.yml`, but it protects any future workflow that forgets the block. Confirmation: the radio button shows the read-only option.
3. **When Dependabot bumps the trufflehog SHA** in a future PR, edit that PR to set `version:` to the same release (no `v`). Dependabot updates the `uses:` SHA and comment only. Confirmation: `version:` equals the `# vX.Y.Z` comment minus the `v`.
4. **Check which pnpm Vercel uses (read-only check; the executor cannot do it).** Open the latest production deployment in Vercel, Build Logs, and find the install line (for example `Detected pnpm-lock.yaml ... using pnpm@X` or `Running "install" command: pnpm install`). Vercel honours `packageManager` only when Corepack is enabled, otherwise it picks a pnpm major from the lockfile version; a pnpm 10 install then usually switches itself to 11.20.0 (`manage-package-manager-versions`, default true), so the log may show pnpm 10 starting and 11.20.0 doing the install. If the log shows 11.x doing the install, nothing to do. If it shows 10.x, the remaining drift is Vercel's: to remove it, add the Vercel environment variable `ENABLE_EXPERIMENTAL_COREPACK` = `1` to the Preview environment first, redeploy one preview and confirm its log shows pnpm 11.20.0 and the build succeeds, then add it to Production. Confirmation: the production build log shows pnpm 11.20.0. This does not block merging WP00.

## Acceptance criteria

- [ ] `frontend/scripts/supabase-stub.mjs`, `frontend/scripts/build-with-stub.mjs` and `frontend/scripts/supabase-stub.test.mjs` exist and lint clean.
- [ ] `frontend/package.json` has `build:stub` and `test:scripts`; `build` is still `next build`; dependencies in `package.json` are unchanged.
- [ ] `frontend/pnpm-workspace.yaml` has `brace-expansion@5: ^5.0.12` with its advisory comment, `pnpm-lock.yaml` differs from master only in the 5 brace-expansion lines (plus lines for any override added under step 7's rule, each named in the PR body), and `pnpm audit --audit-level high --prod` exits 0 (unless step 7 was skipped because the audit was already clean).
- [ ] `pnpm build:stub` exits 0 with no network access to Supabase and no `.env.local`, and exits non-zero when a prerendered page throws.
- [ ] After `pnpm build:stub` (success, failure or SIGINT), nothing listens on the stub port and `.next/cache/fetch-cache` does not exist.
- [ ] `pnpm run test:scripts` passes 4 tests; `pnpm test --ci` suite count is unchanged and includes nothing from `scripts/`.
- [ ] `pnpm run lint` problem count is unchanged (33: 16 errors, 17 warnings).
- [ ] `ci.yml` has top-level `permissions: contents: read`, four `persist-credentials: false`, no `version: 10`, `package_json_file: frontend/package.json` in both pnpm setup steps, and trufflehog pinned to `4dd8831c5f12599465d4d45c3c447b4018a34c85 # v3.97.9` plus `version: "3.97.9"`.
- [ ] The Frontend CI job runs `pnpm run test:scripts` and `pnpm build:stub` after the tests, and its `name:` is unchanged.
- [ ] Lint in CI is still `continue-on-error: true`.
- [ ] All four CI checks pass on the PR, the pnpm setup log shows 11.20.0, and the secret-scan log shows the `:3.97.9` image.
- [ ] `frontend/README.md` documents `pnpm build:stub` and `pnpm test:scripts`.

## Rollback

`git revert <merge commit>` on `master` restores the previous workflow and removes the scripts. No migrations, no Vercel or Supabase settings, and no runtime code are involved, so a revert has no production effect. If only the build step misbehaves in CI (for example a flaky runner), a smaller rollback is to delete the `Production build (Supabase stub)` step from `ci.yml` in a follow-up PR, keeping the pnpm and F127 fixes. The `brace-expansion` override is independent of the rest; reverting it alone brings back the two audit advisories. If the pnpm 11 switch breaks `pnpm install` or `pnpm audit` in CI, revert only the two `package_json_file` edits back to `version: 10` and open an issue; do not add both inputs at once.

## Commit and PR

Commit message:

```
ci: build the app in CI against a local Supabase stub; pin trufflehog

- scripts/supabase-stub.mjs: empty-result PostgREST stand-in (406 PGRST116
  for .single(), 200 [] otherwise)
- scripts/build-with-stub.mjs + `pnpm build:stub`: next build against the
  stub on an ephemeral port; always stops it; wipes .next/cache/fetch-cache
  before and after so stub data never reaches a real build
- `pnpm test:scripts` (node --test) for the stub; Jest ignores scripts/
- ci.yml: run test:scripts and build:stub in the Frontend job; pnpm from
  frontend/package.json packageManager (11.20.0) instead of version 10;
  top-level permissions: contents: read; persist-credentials: false on all
  checkouts; trufflehog pinned to v3.97.9 by SHA and image version
- pnpm-workspace.yaml: raise the brace-expansion@5 override to ^5.0.12
  (GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7) so the required audit check
  passes again

Findings: F127, F076 (build gate and pnpm pin only; lint gate is WP17)
```

PR title: `ci: add a Supabase-free build gate (pnpm build:stub) and harden the workflow (WP00)`

PR body summary:

- What: local Supabase stub plus `pnpm build:stub`; CI now runs a full `next build` on every PR inside the existing required Frontend check; CI uses pnpm 11.20.0 from `packageManager`; token is read-only; checkouts do not persist credentials; trufflehog action and scanner image are pinned; the `brace-expansion@5` override is raised to `^5.0.12` because two new high advisories had turned the required audit check red on every PR.
- Why: F076 (build breakage only surfaced on Vercel after merge; pnpm major drift) and F127 (unpinned third-party action and image, implicit token scope).
- Not in scope: blocking lint (WP17), prerender resilience to a failing or empty Supabase RPC at build and revalidate time (F064 recommendation part 2, owned by no work package; list it under "Follow-ups" in the PR body as: "serverMarketData fetchers should throw instead of caching an empty or failed result, so ISR keeps the last good page"), SHA-pinning first-party actions (optional follow-up), copilot-instructions rewrite (WP20).
- Verification: paste the output of every command in the spec's Verification section, the `pnpm build:stub` request summary, and links to the green CI run.
- Note for other open PRs: until this PR merges, every PR's `pnpm audit (high+ severity)` check is red for the brace-expansion advisories; rebase them on master after WP00 merges.
- Owner actions: confirm the four required checks in branch protection; optionally set the repo default workflow permissions to read-only; remember to bump trufflehog `version:` alongside Dependabot SHA bumps; check the pnpm version in the Vercel build log (Owner action 4).
