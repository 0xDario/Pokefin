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
