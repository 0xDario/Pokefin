# UI audit tools

These scripts reproduce the screenshots cited in `../ui-audit.md`. They also give any work package a realistic local catalog for visual checks. Do not deploy them; they are for local development only.

- `fixture-stub.js` is a PostgREST mimic on `127.0.0.1:54399`. It serves 58 products across 13 sets and 4 generations, a year of daily prices, sales and listings. It also includes one deliberately stale product (id 105), which exercises the migration 0023 freshness gate. The data is deterministic, because the random generator is seeded.
- `shoot.js` takes full-page screenshots of every public page at 390x844 and 1440x900.
- `interact.js` captures interactive states: the mobile menu, the filter drawer, charts, the login form and the CSV upload.

## Run

```bash
# 1. Fixture stub (terminal 1)
node audits/remediation/research/tools/fixture-stub.js

# 2. App against the stub (terminal 2)
cd frontend
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_KEY=stub \
  pnpm exec next dev -p 3099

# 3. Screenshots (terminal 3): the scripts need playwright-core
cd audits/remediation/research/tools
npm install --no-save playwright-core@1.56
# Set CHROME_PATH if Playwright cannot find a browser on its own,
# e.g. CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
node shoot.js && node interact.js    # writes PNGs to ./shots/
```

`next dev` may create `frontend/AGENTS.md` and `frontend/CLAUDE.md` when it detects a coding agent. Delete them; they are not project files. Keep `shots/` and `node_modules/` out of commits.
