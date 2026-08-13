import {
  derivedFromPrice,
  hasCurrentPrice,
  resolvePrice,
} from "../priceGuard";

function recordedDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)
  );
  return `${d.toISOString().split("T")[0]}T09:00:00`;
}

describe("resolvePrice — evidence: none", () => {
  it("passes the price through, because there is nothing to judge by", () => {
    // A pre-0023 RPC sends no price_recorded_at. Blanking the catalog because
    // the database is behind on migrations is the worse failure.
    const v = resolvePrice(449.95, { kind: "none" });
    expect(v.usdPrice).toBe(449.95);
    expect(v.hasCurrentPrice).toBe(true);
    expect(v.priceRecordedAt).toBeNull();
  });
});

describe("resolvePrice — evidence: unavailable", () => {
  it("withholds, because no verdict was reached", () => {
    // Distinct from `none`: a lookup was attempted and failed.
    const v = resolvePrice(449.95, { kind: "unavailable" });
    expect(v.usdPrice).toBeNull();
    expect(v.hasCurrentPrice).toBe(false);
  });
});

describe("resolvePrice — evidence: timestamp", () => {
  it("keeps a price recorded inside the tolerance", () => {
    const v = resolvePrice(449.95, {
      kind: "timestamp",
      recordedAt: recordedDaysAgo(13),
    });
    expect(v.usdPrice).toBe(449.95);
  });

  it("keeps a price recorded exactly at the boundary", () => {
    const v = resolvePrice(449.95, {
      kind: "timestamp",
      recordedAt: recordedDaysAgo(14),
    });
    expect(v.usdPrice).toBe(449.95);
  });

  it("withholds a price past the tolerance but keeps the date", () => {
    const recordedAt = recordedDaysAgo(95);
    const v = resolvePrice(449.95, { kind: "timestamp", recordedAt });
    expect(v.usdPrice).toBeNull();
    // The date survives so the page can say when it was last priced.
    expect(v.priceRecordedAt).toBe(recordedAt);
  });

  it("does NOT compare values, because the two sides are different reads", () => {
    // This is the round-eleven regression in one assertion: a cached summary
    // beside a live history query disagrees after every ordinary scraper
    // update, and comparing them there withheld healthy prices hourly.
    const v = resolvePrice(100, {
      kind: "timestamp",
      recordedAt: recordedDaysAgo(1),
    });
    expect(v.usdPrice).toBe(100);
  });

  it("withholds when there is no timestamp at all", () => {
    expect(resolvePrice(449.95, { kind: "timestamp", recordedAt: null }).usdPrice)
      .toBeNull();
  });
});

describe("resolvePrice — evidence: snapshot", () => {
  it("keeps a fresh price the recorded row agrees with", () => {
    const v = resolvePrice(449.95, {
      kind: "snapshot",
      recordedAt: recordedDaysAgo(1),
      recordedPrice: 449.95,
    });
    expect(v.usdPrice).toBe(449.95);
  });

  it("withholds when the stored value disagrees with its own row", () => {
    // The scraper writes history and products as two statements; a failed
    // update leaves the old value under the new row's date.
    const v = resolvePrice(449.95, {
      kind: "snapshot",
      recordedAt: recordedDaysAgo(1),
      recordedPrice: 501.5,
    });
    expect(v.usdPrice).toBeNull();
    expect(v.priceRecordedAt).toBe(recordedDaysAgo(1));
  });

  it("does not treat a null on one side as a match", () => {
    expect(
      resolvePrice(449.95, {
        kind: "snapshot",
        recordedAt: recordedDaysAgo(1),
        recordedPrice: null,
      }).usdPrice
    ).toBeNull();
    expect(
      resolvePrice(null, {
        kind: "snapshot",
        recordedAt: recordedDaysAgo(1),
        recordedPrice: 449.95,
      }).usdPrice
    ).toBeNull();
  });

  it("still applies the staleness test when the values agree", () => {
    const v = resolvePrice(449.95, {
      kind: "snapshot",
      recordedAt: recordedDaysAgo(95),
      recordedPrice: 449.95,
    });
    expect(v.usdPrice).toBeNull();
  });
});

describe("resolvePrice — stored value handling", () => {
  it("treats a missing or NaN stored price as no price", () => {
    const fresh = { kind: "timestamp", recordedAt: recordedDaysAgo(1) } as const;
    expect(resolvePrice(null, fresh).usdPrice).toBeNull();
    expect(resolvePrice(undefined, fresh).usdPrice).toBeNull();
    expect(resolvePrice(Number.NaN, fresh).usdPrice).toBeNull();
  });

  it("passes a literal zero through rather than reading it as missing", () => {
    // Guards the null checks against sliding back to falsy ones.
    const v = resolvePrice(0, {
      kind: "snapshot",
      recordedAt: recordedDaysAgo(1),
      recordedPrice: 0,
    });
    expect(v.usdPrice).toBe(0);
    // ...but zero is still "has a price", so derived values may publish.
    expect(v.hasCurrentPrice).toBe(true);
  });
});

describe("derivedFromPrice", () => {
  it("publishes a derived value when there is a current price", () => {
    const v = resolvePrice(100, {
      kind: "timestamp",
      recordedAt: recordedDaysAgo(1),
    });
    expect(derivedFromPrice(v, () => 12.5)).toBe(12.5);
  });

  it("withholds it when there is not, without evaluating the thunk", () => {
    const v = resolvePrice(100, {
      kind: "timestamp",
      recordedAt: recordedDaysAgo(95),
    });
    const compute = jest.fn(() => 12.5);
    expect(derivedFromPrice(v, compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("accepts an already-guarded product, not just a verdict", () => {
    expect(derivedFromPrice({ usd_price: 10 }, () => "x")).toBe("x");
    expect(derivedFromPrice({ usd_price: null }, () => "x")).toBeNull();
  });
});

describe("hasCurrentPrice", () => {
  it("reads a verdict or a product interchangeably", () => {
    expect(hasCurrentPrice({ usd_price: 10 })).toBe(true);
    expect(hasCurrentPrice({ usd_price: 0 })).toBe(true);
    expect(hasCurrentPrice({ usd_price: null })).toBe(false);
    expect(hasCurrentPrice({ usd_price: undefined })).toBe(false);
    expect(
      hasCurrentPrice(
        resolvePrice(10, { kind: "timestamp", recordedAt: recordedDaysAgo(1) })
      )
    ).toBe(true);
  });
});
