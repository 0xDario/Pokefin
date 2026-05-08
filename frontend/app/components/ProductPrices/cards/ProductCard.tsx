"use client";

import { memo, useEffect, useState } from "react";
import ProductImage from "../shared/ProductImage";
import ExpansionTypeBadge from "../shared/ExpansionTypeBadge";
import VariantBadge from "../shared/VariantBadge";
import ReturnMetrics from "../shared/ReturnMetrics";
import LazyPriceChart from "../shared/LazyPriceChart";
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
  const [showChart, setShowChart] = useState(false);
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

  useEffect(() => {
    if (showChart) {
      onLoadChart(product.id, chartTimeframe);
    }
  }, [showChart, product.id, chartTimeframe, onLoadChart]);

  const chartToggleLabel = showChart ? "Hide chart" : "Load chart";

  if (viewMode === "flat") {
    return (
      <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">
        <ProductImage
          imageUrl={product.image_url}
          productName={`${setName} ${productType}`}
          className="w-full h-40 sm:h-48"
        />

        <div className="p-4 md:p-5">
          <div className="mb-3">
            <h2 className="text-lg md:text-xl font-bold text-slate-900 leading-tight">
              {setName}
            </h2>
            <ExpansionTypeBadge type={product.sets?.expansion_type} />

            <h3 className="text-sm md:text-base font-medium text-slate-700 mt-1.5 leading-tight">
              {productType}
            </h3>
            {product.variant && <VariantBadge variant={product.variant} />}

            <p className="text-xs text-slate-500 mt-1.5 space-y-0.5">
              <span className="block">{generation}</span>
              <span className="block">Set: {setCode}</span>
              <span className="block">Release: {releaseDate}</span>
            </p>
          </div>

          <p className="text-2xl md:text-3xl font-extrabold text-green-600 tracking-tight mb-1">
            {formatPrice(product.usd_price)}
          </p>

          <ReturnMetrics
            chartTimeframe={chartTimeframe}
            selectedCurrency={selectedCurrency}
            exchangeRate={exchangeRate}
            returnMetrics={product.returns}
            history={history}
            layout="vertical"
          />

          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowChart((prev) => !prev)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {historyLoading ? "Loading chart..." : chartToggleLabel}
            </button>

            {showChart && history && history.length > 1 && (
              <LazyPriceChart
                data={history}
                range={chartTimeframe}
                currency={selectedCurrency}
                exchangeRate={exchangeRate}
                releaseDate={product.sets?.release_date}
              />
            )}

            {showChart && !historyLoading && (!history || history.length <= 1) && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Price history not available yet.
              </div>
            )}
          </div>

          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-blue-600 hover:underline mt-2"
          >
            View on TCGPlayer
          </a>

          <p className="text-[10px] md:text-xs text-slate-400 mt-2">
            Updated: {lastUpdated}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row">
        <ProductImage
          imageUrl={product.image_url}
          productName={`${setName} ${productType}`}
          className="w-full h-48 sm:w-32 sm:h-32 flex-shrink-0"
        />

        <div className="flex-1 p-3 md:p-4">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            <div className="flex-1">
              {showSetAsPrimary ? (
                <>
                  <h3 className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {setName}
                  </h3>
                  <p className="text-xs md:text-sm text-slate-700 mt-1">
                    {productType}
                  </p>
                  {product.variant && <VariantBadge variant={product.variant} />}
                  <p className="text-xs text-slate-500 mt-1">
                    {generation} • {setCode} • {releaseDate}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {productType}
                  </h3>
                  {product.variant && <VariantBadge variant={product.variant} />}
                  <p className="text-xs text-slate-500 mt-1">{generation}</p>
                </>
              )}
            </div>

            <div className="text-left sm:text-right sm:ml-2">
              <p className="text-xl md:text-2xl font-bold text-green-600 tracking-tight">
                {formatPrice(product.usd_price)}
              </p>

              <ReturnMetrics
                chartTimeframe={chartTimeframe}
                selectedCurrency={selectedCurrency}
                exchangeRate={exchangeRate}
                returnMetrics={product.returns}
                history={history}
                layout="horizontal"
                className="text-[10px] md:text-xs mt-1"
              />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowChart((prev) => !prev)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {historyLoading ? "Loading chart..." : chartToggleLabel}
            </button>

            {showChart && history && history.length > 1 && (
              <LazyPriceChart
                data={history}
                range={chartTimeframe}
                currency={selectedCurrency}
                exchangeRate={exchangeRate}
                releaseDate={product.sets?.release_date}
              />
            )}

            {showChart && !historyLoading && (!history || history.length <= 1) && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Price history not available yet.
              </div>
            )}
          </div>

          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline mt-2 inline-block"
          >
            View on TCGPlayer →
          </a>
        </div>
      </div>
    </div>
  );
});

export default ProductCard;
