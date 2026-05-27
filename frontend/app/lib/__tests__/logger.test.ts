import { logCaughtError, logSupabaseError } from "../logger";

describe("logSupabaseError", () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("logs only label, code, name, message - never details/hint", () => {
    logSupabaseError("test_failed", {
      message: "bad",
      code: "23505",
      name: "PostgrestError",
      // details / hint must NOT appear in the call
      details: "schema fragment exposing column types",
      hint: "use ON CONFLICT",
    } as unknown as Parameters<typeof logSupabaseError>[1]);
    expect(spy).toHaveBeenCalledWith("test_failed", {
      code: "23505",
      name: "PostgrestError",
      message: "bad",
    });
  });

  it("handles a null error", () => {
    logSupabaseError("test_null", null);
    expect(spy).toHaveBeenCalledWith("test_null", {
      code: "unknown",
      message: "no error object",
    });
  });

  it("truncates very long messages", () => {
    const msg = "x".repeat(500);
    logSupabaseError("test_long", { message: msg, code: "X" });
    const arg = spy.mock.calls[0][1];
    expect(arg.message).toHaveLength(300);
  });

  it("drops non-string fields", () => {
    logSupabaseError("test_dirty", {
      code: 123 as unknown,
      message: { nested: true } as unknown,
    });
    expect(spy).toHaveBeenCalledWith("test_dirty", {
      code: null,
      name: null,
      message: null,
    });
  });
});

describe("logCaughtError", () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("logs Error name + message but not stack", () => {
    const e = new TypeError("nope");
    logCaughtError("t", e);
    const arg = spy.mock.calls[0][1];
    expect(arg).toEqual({ name: "TypeError", message: "nope" });
    expect(arg.stack).toBeUndefined();
  });

  it("handles a thrown string", () => {
    logCaughtError("t", "raw");
    expect(spy).toHaveBeenCalledWith("t", { message: "raw" });
  });

  it("handles a thrown object", () => {
    logCaughtError("t", { weird: true });
    expect(spy).toHaveBeenCalledWith("t", { message: "non-error thrown" });
  });
});
