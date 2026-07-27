"use client";

import { useEffect, useState } from "react";
import { fetchVolumeMetrics } from "../../../lib/clientMarketData";
import { logCaughtError } from "../../../lib/logger";
import { ProductVolumeMetrics } from "../types";

const EMPTY_METRICS: Record<number, ProductVolumeMetrics> = {};

/**
 * Sales-volume metrics keyed by product_id.
 *
 * Pass `initialMetrics` when the caller already has the data server-rendered
 * (see getCachedVolumeMetrics) — the hook then skips the client fetch entirely
 * and the values are present on the very first paint. Called with no argument
 * it falls back to the session-cached client fetch.
 *
 * The returned Record is referentially stable: the server-supplied object is
 * returned as-is, every client consumer gets the same cached object from
 * fetchVolumeMetrics, and the initial value is a shared empty constant.
 */
export function useVolumeMetrics(
  initialMetrics?: Record<number, ProductVolumeMetrics> | null
): Record<number, ProductVolumeMetrics> {
  // Gate on content, not existence: getCachedVolumeMetrics returns {} when the
  // RPC fails, and unstable_cache stores that for an hour. Treating {} as
  // "data supplied" would suppress the client fetch and leave every volume
  // surface blank with no retry path.
  const hasInitial =
    initialMetrics != null && Object.keys(initialMetrics).length > 0;
  const [clientMetrics, setClientMetrics] =
    useState<Record<number, ProductVolumeMetrics>>(EMPTY_METRICS);

  useEffect(() => {
    if (hasInitial) return;

    let cancelled = false;

    fetchVolumeMetrics()
      .then((result) => {
        if (!cancelled) {
          setClientMetrics(result);
        }
      })
      .catch((error) => {
        // fetchVolumeMetrics swallows errors itself; this is belt-and-braces.
        logCaughtError("volume_metrics_hook_failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, [hasInitial]);

  // Read the server value straight from the prop rather than seeding state
  // with it. A router.refresh() or a navigation that crosses the hourly
  // server-cache boundary hands down a NEW object, and state initialised on
  // first render would pin the stale one forever.
  return hasInitial ? initialMetrics : clientMetrics;
}
