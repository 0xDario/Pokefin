import ProductImage from "../shared/ProductImage";
import ExpansionTypeBadge from "../shared/ExpansionTypeBadge";
import VariantBadge from "../shared/VariantBadge";
import ReturnMetrics from "../shared/ReturnMetrics";
import ResponsivePriceChart from "../shared/ResponsivePriceChart";
import { Product, PriceHistoryEntry, ChartTimeframe, Currency, ViewMode } from "../types";

interface ProductCardProps {
  product: Product;
  viewMode: ViewMode;
  chartTimeframe: ChartTimeframe;
  priceHistory: Record<number, PriceHistoryEntry[]>;
  selectedCurrency: Currency;
  exchangeRate: number;
  formatPrice: (price: number | null | undefined) => string;
}

/**
 * Unified ProductCard component supporting both flat and grouped views
 * Mobile-first responsive design
 */
export default function ProductCard({
  product,
  viewMode,
  chartTimeframe,
  priceHistory,
  selectedCurrency,
  exchangeRate,
  formatPrice,
}: ProductCardProps) {
  const setName = product.sets?.name || "Unknown Set";
  const productType = product.product_types?.label || product.product_types?.name || "Unknown Type";
  const generation = product.sets?.generations?.name || "Unknown Generation";
  const setCode = product.sets?.code || "N/A";
  const releaseDate = product.sets?.release_date
    ? new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString()
    : "Unknown";
  const lastUpdated = new Date(product.last_updated + "Z").toLocaleString(undefined, {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeZoneName: "short",
  });

  // Flat view - Vertical card layout
  if (viewMode === "flat") {
    return (
      <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">
        <ProductImage
          imageUrl={product.image_url}
          productName={`${setName} ${productType}`}
          className="w-full h-40 sm:h-48"
        />

        <div className="p-4 md:p-5">
          {/* Header */}
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

          {/* Price */}
          <p className="text-2xl md:text-3xl font-extrabold text-green-600 tracking-tight mb-1">
            {formatPrice(product.usd_price)}
          </p>

          {/* Return Metrics - Filtered by timeframe */}
          <ReturnMetrics
            productId={product.id}
            chartTimeframe={chartTimeframe}
            priceHistory={priceHistory}
            selectedCurrency={selectedCurrency}
            exchangeRate={exchangeRate}
            layout="vertical"
          />

          {/* Chart - Responsive height */}
          {priceHistory[product.id]?.length > 1 && (
            <div className="mt-2">
              <ResponsivePriceChart
                data={priceHistory[product.id]}
                range={chartTimeframe}
                currency={selectedCurrency}
                exchangeRate={exchangeRate}
                releaseDate={product.sets?.release_date}
              />
            </div>
          )}

          {/* TCGPlayer Link */}
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-blue-600 hover:underline mt-2"
          >
            View on TCGPlayer
          </a>

          {/* Updated timestamp */}
          <p className="text-[10px] md:text-xs text-slate-400 mt-2">
            Updated: {lastUpdated}
          </p>
        </div>
      </div>
    );
  }

  // Grouped view - Horizontal card layout (mobile: vertical, desktop: horizontal)
  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row">
        {/* Image - full width on mobile, fixed width on tablet+ */}
        <ProductImage
          imageUrl={product.image_url}
          productName={`${setName} ${productType}`}
          className="w-full h-48 sm:w-32 sm:h-32 flex-shrink-0"
        />

        {/* Content */}
        <div className="flex-1 p-3 md:p-4">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
            {/* Left: Product info */}
            <div className="flex-1">
              <h3 className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                {productType}
              </h3>
              {product.variant && <VariantBadge variant={product.variant} />}
              <p className="text-xs text-slate-500 mt-1">{generation}</p>
            </div>

            {/* Right: Price & Returns - side by side on desktop, stacked on mobile */}
            <div className="text-left sm:text-right sm:ml-2">
              <p className="text-xl md:text-2xl font-bold text-green-600 tracking-tight">
                {formatPrice(product.usd_price)}
              </p>

              {/* Return Metrics - Horizontal on desktop */}
              <ReturnMetrics
                productId={product.id}
                chartTimeframe={chartTimeframe}
                priceHistory={priceHistory}
                selectedCurrency={selectedCurrency}
                exchangeRate={exchangeRate}
                layout="horizontal"
                className="text-[10px] md:text-xs mt-1"
              />
            </div>
          </div>

          {/* Chart - Full width, responsive height */}
          {priceHistory[product.id]?.length > 1 && (
            <ResponsivePriceChart
              className="mt-3"
              data={priceHistory[product.id]}
              range={chartTimeframe}
              currency={selectedCurrency}
              exchangeRate={exchangeRate}
              releaseDate={product.sets?.release_date}
            />
          )}

          {/* TCGPlayer Link */}
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
}
