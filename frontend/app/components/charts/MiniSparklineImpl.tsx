"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

export type SparklinePoint = {
  date: string;
  price: number;
};

interface MiniSparklineImplProps {
  data: SparklinePoint[];
  stroke: string;
}

/**
 * Recharts half of MiniSparkline. Kept apart from the public wrapper so the
 * recharts bytes only arrive through the lazily-loaded ChartBundle chunk.
 */
export default function MiniSparklineImpl({
  data,
  stroke,
}: MiniSparklineImplProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="price"
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
