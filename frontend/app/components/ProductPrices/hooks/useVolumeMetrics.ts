"use client";

import { useEffect, useState } from "react";
import { fetchVolumeMetrics } from "../../../lib/clientMarketData";
import { logCaughtError } from "../../../lib/logger";
import { ProductVolumeMetrics } from "../types";

const EMPTY_METRICS: Record<number, ProductVolumeMetrics> = {};

/**
 * Session-cached sales-volume metrics keyed by product_id. The returned
 * Record is referentially stable: every consumer gets the same cached object
 * from fetchVolumeMetrics, and the initial value is a shared empty constant.
 */
export function useVolumeMetrics(): Record<number, ProductVolumeMetrics> {
  const [metrics, setMetrics] =
    useState<Record<number, ProductVolumeMetrics>>(EMPTY_METRICS);

  useEffect(() => {
    let cancelled = false;

    fetchVolumeMetrics()
      .then((result) => {
        if (!cancelled) {
          setMetrics(result);
        }
      })
      .catch((error) => {
        // fetchVolumeMetrics swallows errors itself; this is belt-and-braces.
        logCaughtError("volume_metrics_hook_failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return metrics;
}
