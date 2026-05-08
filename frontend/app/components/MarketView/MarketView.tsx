"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ControlBar from "../ProductPrices/controls/ControlBar";
import { useProductData } from "../ProductPrices/hooks/useProductData";
import { useCurrencyConversion } from "../ProductPrices/hooks/useCurrencyConversion";
import {
  filterProducts,
  getAvailableGenerations,
} from "../ProductPrices/utils/filtering";
import {
  ChartTimeframe,
  Product,
} from "../ProductPrices/types";
import ProductImage from "../ProductPrices/shared/ProductImage";
import ExpansionTypeBadge from "../ProductPrices/shared/ExpansionTypeBadge";
import VariantBadge from "../ProductPrices/shared/VariantBadge";
import PriceChart from "../PriceChart";
import CardRinkPromo from "../CardRinkPromo";
import MiniSparkline from "./MiniSparkline";
import {
  getCagrPercent,
  getMaxDrawdownPercent,
  getReturnPercent,
  getVolatilityPercent,
} from "./returns";

const RETURN_WINDOWS = [
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

type ReturnWindowLabel = (typeof RETURN_WINDOWS)[number]["label"];

type ReturnMap = Record<ReturnWindowLabel, number | null>;

type SortDirection = "asc" | "desc";
type SortKey =
  | "product"
  | "set"
  | "price"
  | "release_date"
  | "days_since_release"
  | "price_per_day"
  | "cagr"
  | "max_drawdown"
  | "volatility_30d"
  | "return_7d"
  | "return_1m"
  | "return_3m"
  | "return_6m"
  | "return_1y";

const AGE_FILTER_OPTIONS = [
  { label: "All Ages", value: "all", minDays: 0 },
  { label: "1 Month+", value: "1m", minDays: 30 },
  { label: "3 Months+", value: "3m", minDays: 90 },
  { label: "6 Months+", value: "6m", minDays: 180 },
  { label: "1 Year+", value: "1y", minDays: 365 },
] as const;

type AgeFilterValue = (typeof AGE_FILTER_OPTIONS)[number]["value"];

interface MarketViewProps {
  initialProducts?: Product[];
  initialExchangeRate?: number;
}

function formatReleaseDate(releaseDate?: string | null) {
  if (!releaseDate) return "Unknown";
  return new Date(`${releaseDate}T00:00:00Z`).toLocaleDateString();
}

function renderReturnValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-slate-400">--</span>;
  }

  const sign = value > 0 ? "+" : "";
  const colorClass =
    value > 0
      ? "text-emerald-600"
      : value < 0
      ? "text-rose-600"
      : "text-slate-500";

  return (
    <span className={`font-semibold ${colorClass}`}>
      {sign}
      {value.toFixed(2)}%
    </span>
  );
}

function getReleaseMs(releaseDate?: string | null) {
  if (!releaseDate) return null;
  const dateKey = releaseDate.split("T")[0].split(" ")[0];
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function getDefaultSortDirection(key: SortKey): SortDirection {
  if (key === "product" || key === "set") return "asc";
  if (key === "days_since_release") return "asc";
  if (key === "max_drawdown" || key === "volatility_30d") return "asc";
  return "desc";
}

export default function MarketView({
  initialProducts = [],
  initialExchangeRate,
}: MarketViewProps) {
  const [chartTimeframe, setChartTimeframe] =
    useState<ChartTimeframe>("1Y");
  const {
    products,
    priceHistory,
    loading,
    loadingProductIds,
    ensureHistoryLoaded,
  } = useProductData({ initialProducts });
  const {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    convertPrice,
    formatPrice,
  } = useCurrencyConversion(initialExchangeRate);

  const [selectedGeneration, setSelectedGeneration] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [ageFilter, setAgeFilter] = useState<AgeFilterValue>("all");
  const [sortKey, setSortKey] = useState<SortKey>("release_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedProductId, setExpandedProductId] = useState<number | null>(
    null
  );

  const ageFilterMinDays = useMemo(() => {
    return (
      AGE_FILTER_OPTIONS.find((option) => option.value === ageFilter)?.minDays ?? 0
    );
  }, [ageFilter]);

  const availableGenerations = useMemo(
    () => getAvailableGenerations(products),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const baseFiltered = filterProducts(products, {
      selectedGeneration,
      selectedProductType: "all",
      searchTerm,
    });

    if (ageFilterMinDays === 0) {
      return baseFiltered;
    }

    const today = new Date();
    const todayUtcMs = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    return baseFiltered.filter((product) => {
      const releaseMs = getReleaseMs(product.sets?.release_date ?? null);
      if (releaseMs === null) return false;

      const daysSinceRelease = Math.max(
        0,
        Math.floor((todayUtcMs - releaseMs) / DAY_MS)
      );
      return daysSinceRelease >= ageFilterMinDays;
    });
  }, [products, selectedGeneration, searchTerm, ageFilterMinDays]);

  const rows = useMemo(() => {
    const today = new Date();
    const todayUtcMs = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    return filteredProducts.map((product) => {
      const history = priceHistory[product.id];
      const returns: ReturnMap = {
        "7D": product.returns?.["7D"] ?? getReturnPercent(history, 7, convertPrice),
        "1M": product.returns?.["1M"] ?? getReturnPercent(history, 30, convertPrice),
        "3M": product.returns?.["3M"] ?? getReturnPercent(history, 90, convertPrice),
        "6M": product.returns?.["6M"] ?? getReturnPercent(history, 180, convertPrice),
        "1Y": product.returns?.["1Y"] ?? getReturnPercent(history, 365, convertPrice),
      };
      const releaseMs = getReleaseMs(product.sets?.release_date ?? null);
      const daysSinceRelease =
        releaseMs === null
          ? null
          : Math.max(0, Math.floor((todayUtcMs - releaseMs) / DAY_MS));
      const price =
        typeof product.usd_price === "number"
          ? convertPrice(product.usd_price)
          : null;
      const pricePerDay =
        price !== null && daysSinceRelease && daysSinceRelease > 0
          ? price / daysSinceRelease
          : null;
      const cagr = getCagrPercent(history, convertPrice);
      const maxDrawdown = getMaxDrawdownPercent(history, convertPrice);
      const volatility30d = getVolatilityPercent(history, convertPrice, 30);

      return {
        product,
        history,
        returns,
        releaseMs,
        daysSinceRelease,
        price,
        pricePerDay,
        cagr,
        maxDrawdown,
        volatility30d,
      };
    });
  }, [filteredProducts, priceHistory, convertPrice]);

  useEffect(() => {
    if (expandedProductId !== null) {
      void ensureHistoryLoaded(expandedProductId, chartTimeframe);
    }
  }, [chartTimeframe, ensureHistoryLoaded, expandedProductId]);

  const sortedRows = useMemo(() => {
    const getSortValue = (
      row: (typeof rows)[number],
      key: SortKey
    ): number | string | null => {
      const productType =
        row.product.product_types?.label ||
        row.product.product_types?.name ||
        "Unknown Type";
      const setName = row.product.sets?.name || "Unknown Set";
      const variant = row.product.variant || "";

      switch (key) {
        case "product":
          return `${productType} ${variant}`.trim().toLowerCase();
        case "set":
          return setName.toLowerCase();
        case "price":
          return row.price;
        case "release_date":
          return row.releaseMs;
        case "days_since_release":
          return row.daysSinceRelease;
        case "price_per_day":
          return row.pricePerDay;
        case "cagr":
          return row.cagr;
        case "max_drawdown":
          return row.maxDrawdown;
        case "volatility_30d":
          return row.volatility30d;
        case "return_7d":
          return row.returns["7D"];
        case "return_1m":
          return row.returns["1M"];
        case "return_3m":
          return row.returns["3M"];
        case "return_6m":
          return row.returns["6M"];
        case "return_1y":
          return row.returns["1Y"];
        default:
          return null;
      }
    };

    const compareValues = (
      valueA: number | string | null,
      valueB: number | string | null
    ) => {
      if (valueA === null && valueB === null) return 0;
      if (valueA === null) return 1;
      if (valueB === null) return -1;

      if (typeof valueA === "string" || typeof valueB === "string") {
        return String(valueA).localeCompare(String(valueB));
      }

      return valueA - valueB;
    };

    return [...rows].sort((rowA, rowB) => {
      const valueA = getSortValue(rowA, sortKey);
      const valueB = getSortValue(rowB, sortKey);
      const base = compareValues(valueA, valueB);
      return sortDirection === "asc" ? base : base * -1;
    });
  }, [rows, sortKey, sortDirection]);

  const toggleExpanded = (productId: number) => {
    setExpandedProductId((prev) => {
      const next = prev === productId ? null : productId;
      if (next !== null) {
        void ensureHistoryLoaded(next, chartTimeframe);
      }
      return next;
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(getDefaultSortDirection(key));
  };

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ^" : " v";
  };

  const renderProductCell = (product: Product) => {
    const productType =
      product.product_types?.label ||
      product.product_types?.name ||
      "Unknown Type";
    const setName = product.sets?.name || "Unknown Set";

    return (
      <div className="flex items-center gap-3">
        <ProductImage
          imageUrl={product.image_url}
          productName={`${setName} ${productType}`}
          className="w-14 h-14 rounded-lg border border-slate-200 bg-white"
        />
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {productType}
          </div>
          <div className="text-xs text-slate-500">{setName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <ExpansionTypeBadge type={product.sets?.expansion_type} />
            {product.variant && <VariantBadge variant={product.variant} />}
          </div>
        </div>
      </div>
    );
  };

  const renderSetCell = (product: Product) => {
    const setName = product.sets?.name || "Unknown Set";
    const setCode = product.sets?.code || "N/A";
    const generation = product.sets?.generations?.name || "Unknown";

    return (
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-800">{setName}</div>
        <div className="text-xs text-slate-500">
          {generation} / {setCode}
        </div>
      </div>
    );
  };

  const currencySymbol = selectedCurrency === "CAD" ? "C$" : "$";
  const formatRatio = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return "--";
    return `${currencySymbol}${value.toFixed(2)}`;
  };

  return (
    <div className="p-3 md:p-6 bg-slate-100 min-h-screen">
      <div className="space-y-4 md:space-y-6">
        <ControlBar
          selectedGeneration={selectedGeneration}
          availableGenerations={availableGenerations}
          onGenerationChange={setSelectedGeneration}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          selectedAgeFilter={ageFilter}
          ageFilterOptions={AGE_FILTER_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          onAgeFilterChange={(value) => setAgeFilter(value as AgeFilterValue)}
          chartTimeframe={chartTimeframe}
          onChartTimeframeChange={setChartTimeframe}
          selectedCurrency={selectedCurrency}
          exchangeRate={exchangeRate}
          exchangeRateLoading={exchangeRateLoading}
          onCurrencyChange={setSelectedCurrency}
          showChartTimeframe={false}
          showProductTypeFilter={false}
        />

        {ageFilter !== "all" && (
          <div className="text-xs text-slate-500 -mt-3">
            Products without a valid release date are excluded when a minimum
            age filter is active.
          </div>
        )}

        <CardRinkPromo variant="banner" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-600">
          <div>Found {rows.length} products</div>
          <div className="text-xs text-slate-500">
            Click a column header to sort.
          </div>
        </div>

        {loading && <div className="text-slate-600">Loading products...</div>}

        {!loading && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[1440px] w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3 text-left">#</th>
                    <th className="px-3 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort("product")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Product{getSortIndicator("product")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => handleSort("set")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Set{getSortIndicator("set")}
                      </button>
                    </th>
                    <th
                      className="px-3 py-3 text-right"
                      aria-sort={
                        sortKey === "price"
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSort("price")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Price{getSortIndicator("price")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("release_date")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Release{getSortIndicator("release_date")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("days_since_release")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Days Since{getSortIndicator("days_since_release")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("price_per_day")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Price/Day{getSortIndicator("price_per_day")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("cagr")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        CAGR{getSortIndicator("cagr")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("max_drawdown")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Max DD{getSortIndicator("max_drawdown")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("volatility_30d")}
                        className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                      >
                        Vol 30D{getSortIndicator("volatility_30d")}
                      </button>
                    </th>
                    {RETURN_WINDOWS.map((window) => (
                      <th
                        key={window.label}
                        className="px-3 py-3 text-right"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            handleSort(
                              window.label === "7D"
                                ? "return_7d"
                                : window.label === "1M"
                                ? "return_1m"
                                : window.label === "3M"
                                ? "return_3m"
                                : window.label === "6M"
                                ? "return_6m"
                                : "return_1y"
                            )
                          }
                          className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                        >
                          {window.label}
                          {getSortIndicator(
                            window.label === "7D"
                              ? "return_7d"
                              : window.label === "1M"
                              ? "return_1m"
                              : window.label === "3M"
                              ? "return_3m"
                              : window.label === "6M"
                              ? "return_6m"
                              : "return_1y"
                          )}
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right">Last 7D</th>
                    <th className="px-3 py-3 text-right">Chart</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, index) => {
                    const {
                      product,
                      history,
                      returns,
                      daysSinceRelease,
                      pricePerDay,
                      cagr,
                      maxDrawdown,
                      volatility30d,
                    } = row;
                    const isExpanded = expandedProductId === product.id;

                    return (
                      <Fragment key={product.id}>
                        <tr className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-4 text-slate-400">
                            {index + 1}
                          </td>
                          <td className="px-3 py-4">
                            {renderProductCell(product)}
                          </td>
                          <td className="px-3 py-4">{renderSetCell(product)}</td>
                          <td className="px-3 py-4 text-right font-semibold text-slate-900">
                            {formatPrice(product.usd_price)}
                          </td>
                          <td className="px-3 py-4 text-right text-slate-600">
                            {formatReleaseDate(product.sets?.release_date)}
                          </td>
                          <td className="px-3 py-4 text-right text-slate-600">
                            {daysSinceRelease ?? "--"}
                          </td>
                          <td className="px-3 py-4 text-right text-slate-600">
                            {formatRatio(pricePerDay)}
                          </td>
                          <td className="px-3 py-4 text-right">
                            {renderReturnValue(cagr)}
                          </td>
                          <td className="px-3 py-4 text-right">
                            {renderReturnValue(
                              maxDrawdown === null ? null : maxDrawdown * -1
                            )}
                          </td>
                          <td className="px-3 py-4 text-right">
                            {renderReturnValue(volatility30d)}
                          </td>
                          {RETURN_WINDOWS.map((window) => (
                            <td
                              key={window.label}
                              className="px-3 py-4 text-right"
                            >
                              {renderReturnValue(returns[window.label])}
                            </td>
                          ))}
                          <td className="px-3 py-4">
                            <div className="flex justify-end">
                              {history && history.length > 1 ? (
                                <MiniSparkline
                                  history={history}
                                  currency={selectedCurrency}
                                  exchangeRate={exchangeRate}
                                />
                              ) : loadingProductIds.includes(product.id) ? (
                                <span className="text-xs text-slate-400">Loading...</span>
                              ) : (
                                <span className="text-xs text-slate-400">Open chart</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(product.id)}
                              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? "Hide" : "Show"}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={17} className="px-6 py-5">
                              {loadingProductIds.includes(product.id) ? (
                                <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                                  Loading price history...
                                </div>
                              ) : history && history.length > 1 ? (
                                <div className="rounded-lg border border-slate-200 bg-white p-4">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <div className="text-sm font-semibold text-slate-800">
                                        Price history
                                      </div>
                                      <div className="text-xs text-slate-500">
                                        Showing {chartTimeframe} range
                                      </div>
                                    </div>
                                    {product.url && (
                                      <a
                                        href={product.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-semibold text-blue-600 hover:underline"
                                      >
                                        View on TCGPlayer &gt;
                                      </a>
                                    )}
                                  </div>
                                  <div className="mt-3">
                                    <PriceChart
                                      data={history}
                                      range={chartTimeframe}
                                      currency={selectedCurrency}
                                      exchangeRate={exchangeRate}
                                      height={220}
                                      releaseDate={product.sets?.release_date}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                                  Price history not available yet.
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
