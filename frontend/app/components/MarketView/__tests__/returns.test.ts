import { getReturnPercent } from "../returns";
import type { PriceHistoryEntry } from "../../ProductPrices/types";

const identityConvert = (usdPrice: number) => usdPrice;

function makeHistory(
  entries: Array<{ recordedAt: string; usdPrice: number }>
): PriceHistoryEntry[] {
  return entries.map((entry) => ({
    recorded_at: entry.recordedAt,
    usd_price: entry.usdPrice,
  }));
}

describe("getReturnPercent", () => {
  it("uses the newest point as current price for ascending history", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T00:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-03T00:00:00Z", usdPrice: 110 },
      { recordedAt: "2026-02-08T00:00:00Z", usdPrice: 130 },
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);

    const result = getReturnPercent(
      history,
      7,
      identityConvert,
      new Date("2026-02-10T12:00:00Z")
    );

    expect(result).toBeCloseTo(27.2727, 3);
  });

  it("returns null when latest data is older than the requested window", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T00:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);

    const result = getReturnPercent(
      history,
      7,
      identityConvert,
      new Date("2026-02-20T00:00:00Z")
    );

    expect(result).toBeNull();
  });

  it("returns null when there is not enough history", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);

    const result = getReturnPercent(
      history,
      7,
      identityConvert,
      new Date("2026-02-10T12:00:00Z")
    );

    expect(result).toBeNull();
  });
});
