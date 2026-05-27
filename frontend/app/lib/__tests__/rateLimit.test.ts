import {
  RATE_LIMITS,
  _resetRateLimitStoreForTests,
  classifyRoute,
  clientIp,
  rateLimit,
} from "../rateLimit";

describe("rateLimit", () => {
  beforeEach(() => _resetRateLimitStoreForTests());

  it("allows requests up to the limit, then rejects", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = rateLimit("k", 5, 60_000, now);
      expect(r.success).toBe(true);
    }
    const denied = rateLimit("k", 5, 60_000, now);
    expect(denied.success).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.resetSeconds).toBe(60);
  });

  it("opens a new window after windowMs elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("k", 5, 60_000, t0);
    expect(rateLimit("k", 5, 60_000, t0).success).toBe(false);

    const t1 = t0 + 60_001;
    expect(rateLimit("k", 5, 60_000, t1).success).toBe(true);
  });

  it("scopes by key", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 60_000, now);
    expect(rateLimit("a", 5, 60_000, now).success).toBe(false);
    expect(rateLimit("b", 5, 60_000, now).success).toBe(true);
  });

  it("returns shrinking remaining count", () => {
    const now = 1_000_000;
    expect(rateLimit("k", 3, 60_000, now).remaining).toBe(2);
    expect(rateLimit("k", 3, 60_000, now).remaining).toBe(1);
    expect(rateLimit("k", 3, 60_000, now).remaining).toBe(0);
  });
});

describe("classifyRoute", () => {
  it("classifies /api/account/* as sensitive", () => {
    expect(classifyRoute("/api/account/delete")).toBe("sensitive");
    expect(classifyRoute("/api/account/export")).toBe("sensitive");
  });

  it("classifies /auth/* as sensitive", () => {
    expect(classifyRoute("/auth/login")).toBe("sensitive");
    expect(classifyRoute("/auth/callback")).toBe("sensitive");
  });

  it("classifies other /api/* as general", () => {
    expect(classifyRoute("/api/products")).toBe("general");
  });

  it("does not classify non-api/auth paths", () => {
    expect(classifyRoute("/")).toBeNull();
    expect(classifyRoute("/portfolio")).toBeNull();
  });
});

describe("clientIp", () => {
  it("picks the first hop from x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientIp({ headers })).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "5.6.7.8" });
    expect(clientIp({ headers })).toBe("5.6.7.8");
  });

  it("returns 'anon' if no header is present", () => {
    expect(clientIp({ headers: new Headers() })).toBe("anon");
  });
});

describe("RATE_LIMITS sanity", () => {
  it("sensitive is tighter than general", () => {
    expect(RATE_LIMITS.sensitive.limit).toBeLessThan(RATE_LIMITS.general.limit);
  });
});
