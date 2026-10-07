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
