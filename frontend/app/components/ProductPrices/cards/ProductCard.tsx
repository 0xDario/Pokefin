"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProductImage from "../shared/ProductImage";
import ExpansionTypeBadge from "../shared/ExpansionTypeBadge";
import VariantBadge from "../shared/VariantBadge";
import ReturnMetrics from "../shared/ReturnMetrics";
import LazyPriceChart from "../shared/LazyPriceChart";
import MiniSparkline from "../../MarketView/MiniSparkline";
import { useVolumeMetrics } from "../hooks/useVolumeMetrics";
import { Product, PriceHistoryEntry, ChartTimeframe, Currency, ViewMode } from "../types";

interface ProductCardProps {
  product: Product;
  viewMode: ViewMode;
  showSetAsPrimary?: boolean;
  chartTimeframe: ChartTimeframe;
  history?: PriceHistoryEntry[];
  historyLoading?: boolean;
  selectedCurrency: Currency;
  exchangeRate: number;
  formatPrice: (price: number | null | undefined) => string;
  onLoadChart: (productId: number, timeframe: ChartTimeframe) => void;
}

// Color the card's left edge based on 1M return so the catalog scans like a
// finance dashboard. Neutral (zero or missing) gets no accent.
function getAccentClass(oneMonthReturn: number | null | undefined): string {
  if (oneMonthReturn === null || oneMonthReturn === undefined || Number.isNaN(oneMonthReturn)) {
    return "border-l-4 border-l-transparent";
  }
  if (oneMonthReturn > 0) return "border-l-4 border-l-[var(--pf-gain)]";
  if (oneMonthReturn < 0) return "border-l-4 border-l-[var(--pf-loss)]";
  return "border-l-4 border-l-transparent";
}

// Quiet slate chip showing trailing 30-day sales volume. Hidden entirely
// when volume metrics for the product are missing or null.
function VolumeChip({ unitsSold30d }: { unitsSold30d: number | null }) {
  if (unitsSold30d === null) return null;

  return (
    <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 ring-1 ring-slate-200 tabular-nums">
      {unitsSold30d} sold/30d
    </span>
  );
}

const ProductCard = memo(function ProductCard({
  product,
  viewMode,
  showSetAsPrimary = false,
  chartTimeframe,
  history,
  historyLoading = false,
  selectedCurrency,
  exchangeRate,
  formatPrice,
  onLoadChart,
}: ProductCardProps) {
  const [showFullChart, setShowFullChart] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hasTriggeredLoad = useRef(false);

  const volumeMetrics = useVolumeMetrics();
  const unitsSold30d = volumeMetrics[product.id]?.units_sold_30d ?? null;

  const setName = product.sets?.name || "Unknown Set";
  const productType = product.product_types?.label || product.product_types?.name || "Unknown Type";
  const generation = product.sets?.generations?.name || "Unknown Generation";
  const setCode = product.sets?.code || "N/A";
  const releaseDate = product.sets?.release_date
    ? new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString()
    : "Unknown";
  const lastUpdated = product.last_updated
    ? new Date(product.last_updated + "Z").toLocaleString(undefined, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeZoneName: "short",
      })
    : "Unknown";

  const accentClass = getAccentClass(product.returns?.["1M"]);

  // Auto-load history when card scrolls into viewport
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && !hasTriggeredLoad.current) {
        hasTriggeredLoad.current = true;
        onLoadChart(product.id, chartTimeframe);
      }
    },
    [product.id, chartTimeframe, onLoadChart]
  );

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(handleIntersection, {
      rootMargin: "200px 0px",
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [handleIntersection]);

  useEffect(() => {
    if (hasTriggeredLoad.current) {
      onLoadChart(product.id, chartTimeframe);
    }
  }, [chartTimeframe, product.id, onLoadChart]);

  useEffect(() => {
    if (showFullChart) {
      onLoadChart(product.id, chartTimeframe);
    }
  }, [showFullChart, product.id, chartTimeframe, onLoadChart]);

  const hasHistory = history && history.length > 1;
  const fullChartToggleLabel = showFullChart ? "Hide chart" : "Show full chart";

  if (viewMode === "flat") {
    return (
      <div
        ref={cardRef}
        className={`bg-white rounded-xl ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-all overflow-hidden ${accentClass}`}
      >
        <Link href={`/product/${product.id}`} className="block">
          <ProductImage
            imageUrl={product.image_url}
            productName={`${setName} ${productType}`}
            className="w-full h-40 sm:h-48"
          />
        </Link>

        <div className="p-4 md:p-5">
          <div className="mb-3">
            <Link
              href={`/product/${product.id}`}
              className="inline-block text-lg md:text-xl font-bold text-slate-900 leading-tight hover:text-[var(--pf-pokeball)] transition-colors"
            >
              <h2>{setName}</h2>
            </Link>
            <ExpansionTypeBadge type={product.sets?.expansion_type} />

            <h3 className="text-sm md:text-base font-medium text-slate-700 mt-1.5 leading-tight">
              {productType}
            </h3>
            {product.variant && <VariantBadge variant={product.variant} />}

            <p className="text-[11px] text-slate-500 mt-1.5 space-y-0.5">
              <span className="block">{generation}</span>
              <span className="block">Set: {setCode}</span>
              <span className="block">Release: {releaseDate}</span>
            </p>
          </div>

          <div className="flex items-center justify-between mb-1">
            <p className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
              {formatPrice(product.usd_price)}
            </p>
            <MiniSparkline
              history={history}
              currency={selectedCurrency}
              exchangeRate={exchangeRate}
              days={365}
            />
          </div>

          <ReturnMetrics
            chartTimeframe={chartTimeframe}
            selectedCurrency={selectedCurrency}
            exchangeRate={exchangeRate}
            returnMetrics={product.returns}
            history={history}
            layout="vertical"
          />

          {unitsSold30d !== null && (
            <div className="mt-2">
              <VolumeChip unitsSold30d={unitsSold30d} />
            </div>
          )}

          <div className="mt-3 space-y-2">
            {hasHistory && (
              <button
                type="button"
                onClick={() => setShowFullChart((prev) => !prev)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                {fullChartToggleLabel}
              </button>
            )}

            {showFullChart && hasHistory && (
              <LazyPriceChart
                data={history}
                range={chartTimeframe}
                currency={selectedCurrency}
                exchangeRate={exchangeRate}
                releaseDate={product.sets?.release_date}
              />
            )}
          </div>

          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)] hover:underline mt-2"
          >
            View on TCGPlayer →
          </a>

          <p className="text-[10px] md:text-xs text-slate-400 mt-2">
            Updated: {lastUpdated}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`bg-white rounded-lg ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-all ${accentClass}`}
    >
      <div className="flex flex-col sm:flex-row">
        <Link href={`/product/${product.id}`} className="block flex-shrink-0">
          <ProductImage
            imageUrl={product.image_url}
            productName={`${setName} ${productType}`}
            className="w-full h-48 sm:w-32 sm:h-32"
          />
        </Link>

        <div className="flex-1 p-3 md:p-4">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <div className="flex-1">
              {showSetAsPrimary ? (
                <>
                  <Link
                    href={`/product/${product.id}`}
                    className="inline-block text-sm md:text-base font-semibold text-slate-900 leading-tight hover:text-[var(--pf-pokeball)] transition-colors"
                  >
                    <h3>{setName}</h3>
                  </Link>
                  <p className="text-xs md:text-sm text-slate-700 mt-1">
                    {productType}
                  </p>
                  {product.variant && <VariantBadge variant={product.variant} />}
                  <p className="text-[11px] text-slate-500 mt-1">
                    {generation} • {setCode} • {releaseDate}
                  </p>
                </>
              ) : (
                <>
                  <Link
                    href={`/product/${product.id}`}
                    className="inline-block text-sm md:text-base font-semibold text-slate-900 leading-tight hover:text-[var(--pf-pokeball)] transition-colors"
                  >
                    <h3>{productType}</h3>
                  </Link>
                  {product.variant && <VariantBadge variant={product.variant} />}
                  <p className="text-[11px] text-slate-500 mt-1">{generation}</p>
                </>
              )}
            </div>

            <div className="text-left sm:text-right sm:ml-2">
              <div className="flex items-center gap-3 sm:justify-end">
                <MiniSparkline
                  history={history}
                  currency={selectedCurrency}
                  exchangeRate={exchangeRate}
                  days={365}
                />
                <p className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                  {formatPrice(product.usd_price)}
                </p>
              </div>

              <ReturnMetrics
                chartTimeframe={chartTimeframe}
                selectedCurrency={selectedCurrency}
                exchangeRate={exchangeRate}
                returnMetrics={product.returns}
                history={history}
                layout="horizontal"
                className="text-[10px] md:text-xs mt-1"
              />

              {unitsSold30d !== null && (
                <div className="mt-1 flex sm:justify-end">
                  <VolumeChip unitsSold30d={unitsSold30d} />
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {hasHistory && (
              <button
                type="button"
                onClick={() => setShowFullChart((prev) => !prev)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                {fullChartToggleLabel}
              </button>
            )}

            {showFullChart && hasHistory && (
              <LazyPriceChart
                data={history}
                range={chartTimeframe}
                currency={selectedCurrency}
                exchangeRate={exchangeRate}
                releaseDate={product.sets?.release_date}
              />
            )}
          </div>

          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)] hover:underline mt-2 inline-block"
          >
            View on TCGPlayer →
          </a>
        </div>
      </div>
    </div>
  );
});

export default ProductCard;
