"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { calculateHoldingPerformance } from "../../../lib/portfolio";
import type { HoldingWithProduct, AllocationItem } from "../types";

interface AllocationChartProps {
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

export default function AllocationChart({
  holdings,
  groupBy = "set",
  currency = "USD",
  exchangeRate = 1.36,
}: AllocationChartProps) {
  const currencySymbol = currency === "CAD" ? "C$" : "$";

  const allocationData = useMemo(() => {
    const groupMap = new Map<string, number>();

    for (const holding of holdings) {
      const perf = calculateHoldingPerformance(holding);
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

    return items;
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

  if (holdings.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Allocation by {groupBy === "set" ? "Set" : "Product Type"}
        </h2>
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No holdings to display
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6 h-full flex flex-col">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
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
                  <span className="text-gray-700 dark:text-gray-300 truncate">
                    {item.name}
                  </span>
                </div>
                <span className="text-gray-500 dark:text-gray-400 ml-2 flex-shrink-0">
                  {item.percentage.toFixed(1)}%
                </span>
              </li>
            ))}
            {allocationData.length > 6 && (
              <li className="text-xs text-gray-400 dark:text-gray-500">
                +{allocationData.length - 6} more
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
