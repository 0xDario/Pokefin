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
