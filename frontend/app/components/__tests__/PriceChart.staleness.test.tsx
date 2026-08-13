/**
 * Tests for how PriceChart handles a window with no usable price.
 *
 * The forward-fill used to run to the right edge, so the series always ended
 * in data and a trailing gap — which is exactly what staleness looks like on a
 * chart — could not be detected. Now that the fill expires at the staleness
 * tolerance, two shapes need covering: a window that ends in a gap, and a
 * window that contains nothing at all.
 */

// Recharts renders through ResponsiveContainer, which measures a DOM box that
// jsdom reports as 0x0 and then draws nothing. Stub the pieces to plain
// elements so the component's own branching is what the test observes.
jest.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  // ComposedChart swallows its children: the chart's JSX includes raw SVG
  // (<defs>, <linearGradient>) which React warns about when rendered outside
  // an <svg>. Nothing asserted here lives inside the plot area.
  const Empty = () => null;
  return {
    ResponsiveContainer: Passthrough,
    ComposedChart: Empty,
    Area: () => null,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    ReferenceLine: () => null,
  };
});

import React from "react";
import { render, screen } from "@testing-library/react";
import PriceChart from "../PriceChart";
import { isPriceFresh } from "../../lib/marketPulse";

function isoDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)
  );
  return `${d.toISOString().split("T")[0]}T09:00:00`;
}

describe("PriceChart with no usable price in the window", () => {
  it("reports an empty period instead of drawing a $0-$100 axis", () => {
    // 7D window, last reading 95 days ago: nothing falls inside the range, so
    // findIndex returns -1 and both gap checks key off a data point that does
    // not exist. Left unhandled this renders an empty grid whose synthetic
    // fallback axis reads as a real price range.
    render(
      <PriceChart
        data={[{ usd_price: 449.95, recorded_at: isoDaysAgo(95) }]}
        range="7D"
      />
    );

    expect(
      screen.getByText("No prices recorded in this period")
    ).toBeInTheDocument();
  });

  it("warns rather than blanking when the window holds a stale reading", () => {
    // 1Y window, last reading 95 days ago: the reading is inside the range, so
    // the chart draws — but the fill expires 14 days after it, leaving a
    // trailing gap the badge must name.
    render(
      <PriceChart
        data={[
          { usd_price: 400, recorded_at: isoDaysAgo(200) },
          { usd_price: 449.95, recorded_at: isoDaysAgo(95) },
        ]}
        range="1Y"
      />
    );

    expect(screen.getByText("No recent prices")).toBeInTheDocument();
    expect(
      screen.queryByText("No prices recorded in this period")
    ).not.toBeInTheDocument();
  });

  it("withholds ROI and CAGR when the endpoint has expired, but keeps drawdown", () => {
    // The nulls at the tail get filtered out of the price series, which
    // silently promotes the last stale reading into the endpoint role. ROI and
    // CAGR measure TO an endpoint and so have none; max drawdown describes the
    // series that exists and survives.
    render(
      <PriceChart
        data={[
          { usd_price: 400, recorded_at: isoDaysAgo(200) },
          { usd_price: 300, recorded_at: isoDaysAgo(150) },
          { usd_price: 449.95, recorded_at: isoDaysAgo(95) },
        ]}
        range="1Y"
      />
    );

    expect(screen.queryByText(/ROI:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CAGR:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Max DD/i)).toBeInTheDocument();
  });

  it("agrees with isPriceFresh at the tolerance boundary in a western timezone", () => {
    // Rows are bucketed by LOCAL date, so a 04:00 UTC reading lands on the
    // previous day west of UTC. Counting expiry in chart rows therefore
    // expired it a day early and the chart contradicted the card. Exactly 14
    // days old is the oldest still-fresh reading, so it must still plot.
    const fourteenDaysAgo = isoDaysAgo(14).replace("T09:00:00", "T04:00:00");

    expect(isPriceFresh(fourteenDaysAgo)).toBe(true);

    render(
      <PriceChart
        data={[
          { usd_price: 400, recorded_at: isoDaysAgo(40) },
          { usd_price: 450, recorded_at: fourteenDaysAgo },
        ]}
        range="1M"
      />
    );

    expect(
      screen.queryByText("No prices recorded in this period")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No recent prices")).not.toBeInTheDocument();
  });

  it("draws normally for a currently priced product", () => {
    render(
      <PriceChart
        data={[
          { usd_price: 100, recorded_at: isoDaysAgo(5) },
          { usd_price: 110, recorded_at: isoDaysAgo(1) },
        ]}
        range="1M"
      />
    );

    expect(
      screen.queryByText("No prices recorded in this period")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No recent prices")).not.toBeInTheDocument();
  });
});
