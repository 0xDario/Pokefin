"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { calculateHoldingPerformance } from "../../lib/portfolio";
import type { HoldingWithProduct, AllocationItem } from "../Portfolio/types";

export interface AllocationChartImplProps {
  holdings: HoldingWithProduct[];
  groupBy?: "set" | "product_type";
  currency?: "USD" | "CAD";
  exchangeRate?: number;
}

const COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
];

/**
 * Recharts implementation of AllocationChart. Only reachable through the
 * lazily-loaded ChartBundle chunk - import the wrapper in
 * components/Portfolio/shared/AllocationChart.tsx instead of this file.
 */
export default function AllocationChartImpl({
  holdings,
  groupBy = "set",
  currency = "USD",
  exchangeRate = 1.36,
}: AllocationChartImplProps) {
  const currencySymbol = currency === "CAD" ? "C$" : "$";

  // One pass over the holdings produces both the slices and the count of what
  // had to be left out: two memos calling calculateHoldingPerformance over the
  // same list did the arithmetic twice and let the two answers drift.
  const { allocationData, unpricedCount } = useMemo(() => {
    const groupMap = new Map<string, number>();
    let unpriced = 0;

    for (const holding of holdings) {
      const perf = calculateHoldingPerformance(holding);
      if (perf.current_value === null) {
        unpriced += 1;
        continue;
      }
      const value = currency === "CAD" ? perf.current_value * exchangeRate : perf.current_value;

      let groupName: string;
      if (groupBy === "set") {
        groupName = holding.products?.sets?.name || "Unknown Set";
      } else {
        groupName = holding.products?.product_types?.label ||
                    holding.products?.product_types?.name ||
                    "Unknown Type";
      }

      const existing = groupMap.get(groupName) || 0;
      groupMap.set(groupName, existing + value);
    }

    const total = Array.from(groupMap.values()).reduce((sum, val) => sum + val, 0);

    const items: AllocationItem[] = Array.from(groupMap.entries())
      .map(([name, value], index) => ({
        name,
        value,
        percentage: total > 0 ? (value / total) * 100 : 0,
        color: COLORS[index % COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);

    return { allocationData: items, unpricedCount: unpriced };
  }, [holdings, groupBy, currency, exchangeRate]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as AllocationItem;
      return (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">
            {currencySymbol}
            {data.value.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-xs text-slate-400">{data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  // Only an allocation with nothing in it is worth suppressing. An unpriced
  // holding is excluded from the slices and reported underneath — hiding the
  // whole breakdown would throw away every holding that is priced.
  if (holdings.length === 0 || allocationData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Allocation by {groupBy === "set" ? "Set" : "Product Type"}
        </h2>
        <div className="flex-1 flex items-center justify-center text-slate-500">
          {holdings.length === 0
            ? "No holdings to display"
            : "No current prices available"}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">
        Allocation by {groupBy === "set" ? "Set" : "Product Type"}
      </h2>

      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        {/* Pie Chart */}
        <div className="w-full h-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocationData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={35}
                outerRadius={55}
                paddingAngle={2}
              >
                {allocationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="w-full overflow-y-auto max-h-24">
          <ul className="space-y-1">
            {allocationData.slice(0, 6).map((item) => (
              <li key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  ></span>
                  <span className="text-slate-700 truncate">
                    {item.name}
                  </span>
                </div>
                <span className="text-slate-500 ml-2 flex-shrink-0">
                  {item.percentage.toFixed(1)}%
                </span>
              </li>
            ))}
            {allocationData.length > 6 && (
              <li className="text-xs text-slate-400">
                +{allocationData.length - 6} more
              </li>
            )}
          </ul>
        </div>

        {unpricedCount > 0 && (
          <p className="w-full text-xs text-slate-500">
            {unpricedCount} holding{unpricedCount !== 1 ? "s" : ""} excluded — no
            current price
          </p>
        )}
      </div>
    </div>
  );
}
