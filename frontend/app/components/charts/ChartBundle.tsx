"use client";

/**
 * The single lazily-imported entry point for every Recharts consumer.
 *
 * Recharts is ~382 KB raw / ~109 KB gzip. Two things used to go wrong:
 *
 *  1. Every chart component imported `recharts` statically, so the bytes were
 *     in the eager <script> list of `/`, `/prices`, `/market` and `/portfolio`
 *     even when no chart was ever rendered (ProductCard hides its chart behind
 *     a toggle).
 *  2. The bundler emitted the library twice - once for the catalog routes and
 *     once for `/portfolio` - so navigating between them re-downloaded it.
 *
 * Both are fixed by routing every consumer through THIS module via
 * `next/dynamic`. Same module specifier everywhere => one shared async chunk.
 *
 * Never import this file statically from a component that renders eagerly, and
 * never import `recharts` (or PriceChart) directly from a route component -
 * that would put the library back on the critical path. Add new chart
 * implementations under `app/components/charts/` and re-export them here.
 */

export { default as PriceChart } from "../PriceChart";
export { default as PortfolioChartImpl } from "./PortfolioChartImpl";
export { default as AllocationChartImpl } from "./AllocationChartImpl";
export { default as MiniSparklineImpl } from "./MiniSparklineImpl";
export type { SparklinePoint } from "./MiniSparklineImpl";
