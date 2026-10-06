/** @jest-environment node */
/**
 * POST /api/account/export (GDPR Art. 15 / 20).
 *
 * The RPC itself is exercised in the database (migration 0024, finding F020);
 * this pins the route's contract around it: CSRF gate, auth gate, the
 * download headers on success, and a generic 500 on an RPC error.
 * next/server needs the node environment; it throws under jsdom.
 */
import { NextRequest } from "next/server";

// Harmless if the route does not import it; needed if the route is later
// moved onto app/lib/routeSupabase.ts, which imports "server-only".
jest.mock("server-only", () => ({}));

const getUserMock = jest.fn();
const rpcMock = jest.fn();

jest.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: jest.fn() }),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
}));

const logSupabaseErrorMock = jest.fn();
jest.mock("../../../../lib/logger", () => ({
  logSupabaseError: (...args: unknown[]) => logSupabaseErrorMock(...args),
  logCaughtError: jest.fn(),
}));

import { POST } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/account/export", {
    method: "POST",
    headers: {
      "x-pokefin-request": "1",
      origin: "http://localhost:3000",
      ...headers,
    },
  });
}

beforeEach(() => {
  getUserMock.mockReset();
  rpcMock.mockReset();
  logSupabaseErrorMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe("POST /api/account/export", () => {
  it("rejects a request without the x-pokefin-request header", async () => {
    const res = await POST(makeRequest({ "x-pokefin-request": "" }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-site origin", async () => {
    const res = await POST(makeRequest({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 401 and never calls the RPC when there is no session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the RPC document as a no-store JSON attachment", async () => {
    const doc = { user_id: USER_ID, portfolios: [], box_recipes: [] };
    rpcMock.mockResolvedValue({ data: doc, error: null });

    const res = await POST(makeRequest());

    expect(rpcMock).toHaveBeenCalledWith("export_my_data");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="pokefin-data-${USER_ID}.json"`
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await res.text())).toEqual(doc);
  });

  it("returns a generic 500 and logs when the RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "0A000",
        message: "INSERT is not allowed in a non-volatile function",
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to export data" });
    expect(logSupabaseErrorMock).toHaveBeenCalledWith(
      "export_my_data_failed",
      expect.objectContaining({ code: "0A000" })
    );
  });
});
