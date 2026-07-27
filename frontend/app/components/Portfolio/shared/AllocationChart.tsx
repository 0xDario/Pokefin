"use client";

import dynamic from "next/dynamic";
import type { HoldingWithProduct } from "../types";

interface AllocationChartProps {
  holdings: HoldingWithProduct[];
  groupBy?: "set" | "product_type";
  currency?: "USD" | "CAD";
  exchangeRate?: number;
}

// Mirrors the impl's card shell (heading + pie block + legend block) so
// swapping in the real chart does not shift the dashboard grid. The heading is
// a placeholder bar rather than text because `loading` cannot see `groupBy`;
// h-7 matches the text-lg h2 line box it stands in for.
function AllocationChartSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
      <div className="h-7 w-40 mb-4 animate-pulse rounded bg-slate-100" />
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-full h-32 flex items-center justify-center">
          <div className="h-28 w-28 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="w-full max-h-24 space-y-1">
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

// Recharts (~109 KB gzip) is fetched only when the dashboard mounts, and the
// specifier matches the other chart wrappers so /portfolio and /prices share
// one async chunk instead of shipping the library twice.
// See app/components/charts/ChartBundle.tsx.
const AllocationChartImpl = dynamic(
  () => import("../../charts/ChartBundle").then((m) => m.AllocationChartImpl),
  {
    ssr: false,
    loading: () => <AllocationChartSkeleton />,
  }
);

export default function AllocationChart({
  holdings,
  groupBy = "set",
  currency = "USD",
  exchangeRate = 1.36,
}: AllocationChartProps) {
  // Answer the empty case here rather than inside the dynamic impl: a brand
  // new portfolio would otherwise download the ~109 KB Recharts chunk and show
  // a skeleton purely to render this line of text. Kept byte-identical to the
  // impl's own empty state so the two paths look the same.
  if (holdings.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Allocation by {groupBy === "set" ? "Set" : "Product Type"}
        </h2>
        <div className="flex-1 flex items-center justify-center text-slate-500">
          No holdings to display
        </div>
      </div>
    );
  }

  return (
    <AllocationChartImpl
      holdings={holdings}
      groupBy={groupBy}
      currency={currency}
      exchangeRate={exchangeRate}
    />
  );
}
