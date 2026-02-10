"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type ShopifyProduct = {
  sku: string;
  title: string;
  handle?: string;
  shopifyPrice: number | null;
  shopifyCost: number | null;
};

type MarketProduct = {
  sku: string;
  marketPriceUsd: number | null;
  setName?: string | null;
  releaseDate?: string | null;
  productType?: string | null;
  lastUpdated?: string | null;
};

type ComparisonRow = {
  sku: string;
  title: string;
  shopifyPrice: number | null;
  shopifyCost: number | null;
  marketPriceUsd: number | null;
  marketPriceCad: number | null;
  difference: number | null;
  differencePct: number | null;
  shopifyProfit: number | null;
  shopifyMargin: number | null;
  marketProfit: number | null;
  marketProfitPerDay: number | null;
  marketMargin: number | null;
  releaseDate: string | null;
  releaseDateMs: number | null;
  setName?: string | null;
  productType?: string | null;
  lastUpdated?: string | null;
};

type SortDirection = "asc" | "desc";
type CompareSortKey =
  | "sku"
  | "title"
  | "shopifyPrice"
  | "shopifyCost"
  | "marketPriceUsd"
  | "marketPriceCad"
  | "difference"
  | "differencePct";
type ShopifyProfitSortKey =
  | "sku"
  | "title"
  | "shopifyPrice"
  | "shopifyCost"
  | "shopifyProfit"
  | "shopifyMargin";
type MarketProfitSortKey =
  | "sku"
  | "title"
  | "releaseDateMs"
  | "marketPriceUsd"
  | "marketPriceCad"
  | "shopifyCost"
  | "marketProfit"
  | "marketProfitPerDay"
  | "marketMargin";

type SortState<K extends string> = {
  key: K;
  direction: SortDirection;
};

const DEFAULT_EXCHANGE_RATE = 1.35;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        const nextChar = text[i + 1];
        if (nextChar === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseShopifyCsv(text: string): {
  products: Record<string, ShopifyProduct>;
  error?: string;
} {
  const rows = parseCsv(text);
  if (!rows.length) {
    return { products: {}, error: "CSV file is empty." };
  }

  const headers = rows[0].map((header) => header.trim());
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    headerIndex.set(header, index);
  });

  const skuIndex = headerIndex.get("Variant SKU");
  const titleIndex = headerIndex.get("Title");
  const priceIndex = headerIndex.get("Variant Price");
  const costIndex = headerIndex.get("Cost per item");
  const handleIndex = headerIndex.get("Handle");

  if (skuIndex === undefined || priceIndex === undefined) {
    return {
      products: {},
      error:
        "Missing required columns. Ensure the CSV includes Variant SKU and Variant Price.",
    };
  }

  const products: Record<string, ShopifyProduct> = {};

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const sku = row[skuIndex]?.trim();
    if (!sku) continue;

    const title = titleIndex !== undefined ? row[titleIndex]?.trim() : "";
    const price = parseNumber(row[priceIndex]);
    const cost = costIndex !== undefined ? parseNumber(row[costIndex]) : null;
    const handle = handleIndex !== undefined ? row[handleIndex]?.trim() : "";

    if (price === null) continue;

    products[sku] = {
      sku,
      title: title || sku,
      handle: handle || undefined,
      shopifyPrice: price,
      shopifyCost: cost,
    };
  }

  return { products };
}

function formatCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function getReleaseUtcMs(releaseDate: string | null | undefined): number | null {
  if (!releaseDate) return null;
  const dateKey = releaseDate.split("T")[0].split(" ")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function formatReleaseDate(releaseDate: string | null | undefined): string {
  const releaseMs = getReleaseUtcMs(releaseDate);
  if (releaseMs === null) return "Unknown";
  return new Date(releaseMs).toLocaleDateString();
}

function getTodayUtcStartMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function calculateProfit(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null) return null;
  return price - cost;
}

function calculateMargin(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null || price === 0) return null;
  return ((price - cost) / price) * 100;
}

function compareValues(
  a: number | string | null,
  b: number | string | null,
  direction: SortDirection
) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b), undefined, {
      sensitivity: "base",
    }) * multiplier;
  }

  if (a === b) return 0;
  return a > b ? multiplier : -multiplier;
}

function SortButton<K extends string>({
  label,
  sortKey,
  sortState,
  onChange,
  align = "left",
}: {
  label: string;
  sortKey: K;
  sortState: SortState<K>;
  onChange: (next: SortState<K>) => void;
  align?: "left" | "right";
}) {
  const isActive = sortState.key === sortKey;
  const indicator = isActive ? (sortState.direction === "asc" ? "▲" : "▼") : "↕";

  const handleClick = () => {
    if (isActive) {
      onChange({
        key: sortKey,
        direction: sortState.direction === "asc" ? "desc" : "asc",
      });
      return;
    }
    onChange({ key: sortKey, direction: "asc" });
  };

  const alignment = align === "right" ? "justify-end text-right" : "justify-start";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-slate-900 ${alignment}`}
    >
      <span>{label}</span>
      <span className="text-[10px]">{indicator}</span>
    </button>
  );
}

export default function CompareDashboardPage() {
  const [shopifyProducts, setShopifyProducts] = useState<
    Record<string, ShopifyProduct>
  >({});
  const [marketProducts, setMarketProducts] = useState<
    Record<string, MarketProduct>
  >({});
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [exchangeRateDate, setExchangeRateDate] = useState<string | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showUsd, setShowUsd] = useState(false);
  const [thresholdPct, setThresholdPct] = useState(5);

  const [compareSort, setCompareSort] = useState<SortState<CompareSortKey>>({
    key: "differencePct",
    direction: "asc",
  });
  const [shopifyProfitSort, setShopifyProfitSort] =
    useState<SortState<ShopifyProfitSortKey>>({
      key: "shopifyMargin",
      direction: "asc",
    });
  const [marketProfitSort, setMarketProfitSort] =
    useState<SortState<MarketProfitSortKey>>({
      key: "marketMargin",
      direction: "asc",
    });

  useEffect(() => {
    const fetchMarketData = async () => {
      setLoadingMarket(true);
      setErrorMessage(null);

      try {
        const { data: rateData, error: rateError } = await supabase
          .from("exchange_rates")
          .select("usd_to_cad, recorded_at")
          .order("recorded_at", { ascending: false })
          .limit(1);

        if (rateError) {
          throw rateError;
        }

        if (rateData && rateData.length > 0) {
          setExchangeRate(rateData[0].usd_to_cad ?? DEFAULT_EXCHANGE_RATE);
          setExchangeRateDate(rateData[0].recorded_at ?? null);
        } else {
          setExchangeRate(DEFAULT_EXCHANGE_RATE);
          setExchangeRateDate(null);
        }

        const { data: productData, error: productError } = await supabase
          .from("products")
          .select(
            "sku, usd_price, last_updated, sets(name, code, release_date), product_types(name, label)"
          )
          .not("sku", "is", null);

        if (productError) {
          throw productError;
        }

        const map: Record<string, MarketProduct> = {};
        (productData || []).forEach((item: any) => {
          if (!item.sku) return;
          const setInfo = Array.isArray(item.sets) ? item.sets[0] : item.sets;
          const typeInfo = Array.isArray(item.product_types)
            ? item.product_types[0]
            : item.product_types;

          map[item.sku] = {
            sku: item.sku,
            marketPriceUsd:
              typeof item.usd_price === "number" ? item.usd_price : null,
            setName: setInfo?.name ?? null,
            releaseDate: setInfo?.release_date ?? null,
            productType: typeInfo?.label ?? typeInfo?.name ?? null,
            lastUpdated: item.last_updated ?? null,
          };
        });

        setMarketProducts(map);
      } catch (err: any) {
        setErrorMessage(
          err?.message ||
            "Unable to load market data. Check your Supabase connection."
        );
      } finally {
        setLoadingMarket(false);
      }
    };

    fetchMarketData();
  }, []);

  const exchangeRateValue = exchangeRate ?? DEFAULT_EXCHANGE_RATE;

  const comparisonRows = useMemo(() => {
    const rows: ComparisonRow[] = [];
    const shopifyList = Object.values(shopifyProducts);
    const todayUtcMs = getTodayUtcStartMs();

    shopifyList.forEach((shopifyItem) => {
      const marketItem = marketProducts[shopifyItem.sku];
      if (!marketItem) return;
      if (marketItem.marketPriceUsd === null) return;

      const marketCad = marketItem.marketPriceUsd * exchangeRateValue;
      const diff = shopifyItem.shopifyPrice !== null ? shopifyItem.shopifyPrice - marketCad : null;
      const diffPct =
        diff !== null && marketCad > 0 ? (diff / marketCad) * 100 : null;

      const shopifyProfit = calculateProfit(
        shopifyItem.shopifyPrice,
        shopifyItem.shopifyCost
      );
      const shopifyMargin = calculateMargin(
        shopifyItem.shopifyPrice,
        shopifyItem.shopifyCost
      );
      const marketProfit = calculateProfit(marketCad, shopifyItem.shopifyCost);
      const marketMargin = calculateMargin(marketCad, shopifyItem.shopifyCost);
      const releaseDate = marketItem.releaseDate ?? null;
      const releaseDateMs = getReleaseUtcMs(releaseDate);
      const daysSinceRelease =
        releaseDateMs === null
          ? null
          : Math.max(0, Math.floor((todayUtcMs - releaseDateMs) / DAY_MS));
      const marketProfitPerDay =
        marketProfit !== null && daysSinceRelease !== null && daysSinceRelease > 0
          ? marketProfit / daysSinceRelease
          : null;

      rows.push({
        sku: shopifyItem.sku,
        title: shopifyItem.title,
        shopifyPrice: shopifyItem.shopifyPrice,
        shopifyCost: shopifyItem.shopifyCost,
        marketPriceUsd: marketItem.marketPriceUsd,
        marketPriceCad: marketCad,
        difference: diff,
        differencePct: diffPct,
        shopifyProfit,
        shopifyMargin,
        marketProfit,
        marketProfitPerDay,
        marketMargin,
        releaseDate,
        releaseDateMs,
        setName: marketItem.setName,
        productType: marketItem.productType,
        lastUpdated: marketItem.lastUpdated,
      });
    });

    return rows;
  }, [shopifyProducts, marketProducts, exchangeRateValue]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return comparisonRows;
    return comparisonRows.filter((row) => {
      return (
        row.sku.toLowerCase().includes(term) ||
        row.title.toLowerCase().includes(term)
      );
    });
  }, [comparisonRows, searchTerm]);

  const sortedCompareRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const valueA = a[compareSort.key];
      const valueB = b[compareSort.key];
      return compareValues(valueA ?? null, valueB ?? null, compareSort.direction);
    });
    return rows;
  }, [filteredRows, compareSort]);

  const sortedShopifyProfitRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const valueA = a[shopifyProfitSort.key];
      const valueB = b[shopifyProfitSort.key];
      return compareValues(
        valueA ?? null,
        valueB ?? null,
        shopifyProfitSort.direction
      );
    });
    return rows;
  }, [filteredRows, shopifyProfitSort]);

  const sortedMarketProfitRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const valueA = a[marketProfitSort.key];
      const valueB = b[marketProfitSort.key];
      return compareValues(
        valueA ?? null,
        valueB ?? null,
        marketProfitSort.direction
      );
    });
    return rows;
  }, [filteredRows, marketProfitSort]);

  const summaryStats = useMemo(() => {
    let below = 0;
    let above = 0;
    let ok = 0;
    let missingCost = 0;

    comparisonRows.forEach((row) => {
      if (row.shopifyCost === null) missingCost += 1;
      if (row.differencePct === null) return;
      if (row.differencePct < -thresholdPct) {
        below += 1;
      } else if (row.differencePct > thresholdPct) {
        above += 1;
      } else {
        ok += 1;
      }
    });

    return { below, above, ok, total: comparisonRows.length, missingCost };
  }, [comparisonRows, thresholdPct]);

  const handleCsvUpload = async (file: File) => {
    const text = await file.text();
    const { products, error } = parseShopifyCsv(text);
    if (error) {
      setErrorMessage(error);
      setShopifyProducts({});
      setFileName(null);
      return;
    }
    setErrorMessage(null);
    setShopifyProducts(products);
    setFileName(file.name);
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-[96rem] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-gradient-to-br from-white to-slate-100 p-6 shadow-sm ring-1 ring-slate-200 dark:from-slate-900 dark:to-slate-900/60 dark:ring-slate-800">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Shopify vs Market Dashboard
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Upload your Shopify export and explore pricing + margin insights
                in sortable tables. All prices are CAD unless noted.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Exchange rate: 1 USD = {exchangeRateValue.toFixed(4)} CAD
                </span>
                {exchangeRateDate && (
                  <span>
                    Updated: {new Date(exchangeRateDate).toLocaleDateString()}
                  </span>
                )}
                {loadingMarket && <span>Loading market data…</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Upload Shopify CSV
                </span>
                <span className="text-xs">
                  {fileName ?? "Choose products_export.csv"}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleCsvUpload(file);
                  }}
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowUsd((prev) => !prev)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {showUsd ? "Hide USD" : "Show USD"}
                </button>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Threshold %
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={thresholdPct}
                    onChange={(event) =>
                      setThresholdPct(Number(event.target.value) || 0)
                    }
                    className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
              </div>
            </div>
          </div>
          {errorMessage && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {[
            { label: "Matched", value: summaryStats.total },
            { label: "Below Threshold", value: summaryStats.below },
            { label: "Above Threshold", value: summaryStats.above },
            { label: "Within Threshold", value: summaryStats.ok },
            { label: "Missing Cost", value: summaryStats.missingCost },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {item.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Shopify vs Market Comparison
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Prices in CAD. Sort any column to explore.
              </p>
            </div>
            <input
              type="text"
              placeholder="Search SKU or title"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-300 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:w-64"
            />
          </div>

          <div className="overflow-hidden">
            <table className="w-full table-auto border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="px-3 pb-2 text-left">
                    <SortButton
                      label="SKU"
                      sortKey="sku"
                      sortState={compareSort}
                      onChange={setCompareSort}
                    />
                  </th>
                  <th className="px-3 pb-2 text-left">
                    <SortButton
                      label="Title"
                      sortKey="title"
                      sortState={compareSort}
                      onChange={setCompareSort}
                    />
                  </th>
                  <th className="px-3 pb-2 text-right">
                    <SortButton
                      label="Shopify"
                      sortKey="shopifyPrice"
                      sortState={compareSort}
                      onChange={setCompareSort}
                      align="right"
                    />
                  </th>
                  <th className="px-3 pb-2 text-right">
                    <SortButton
                      label="Cost"
                      sortKey="shopifyCost"
                      sortState={compareSort}
                      onChange={setCompareSort}
                      align="right"
                    />
                  </th>
                  {showUsd && (
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Market USD"
                        sortKey="marketPriceUsd"
                        sortState={compareSort}
                        onChange={setCompareSort}
                        align="right"
                      />
                    </th>
                  )}
                  <th className="px-3 pb-2 text-right">
                    <SortButton
                      label="Market"
                      sortKey="marketPriceCad"
                      sortState={compareSort}
                      onChange={setCompareSort}
                      align="right"
                    />
                  </th>
                  <th className="px-3 pb-2 text-right">
                    <SortButton
                      label="Diff"
                      sortKey="difference"
                      sortState={compareSort}
                      onChange={setCompareSort}
                      align="right"
                    />
                  </th>
                  <th className="px-3 pb-2 text-right">
                    <SortButton
                      label="Diff %"
                      sortKey="differencePct"
                      sortState={compareSort}
                      onChange={setCompareSort}
                      align="right"
                    />
                  </th>
                  <th className="px-3 pb-2 text-left">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Status
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedCompareRows.map((row) => {
                  const status =
                    row.differencePct === null
                      ? "N/A"
                      : row.differencePct < -thresholdPct
                      ? "Below"
                      : row.differencePct > thresholdPct
                      ? "Above"
                      : "OK";

                  const statusStyles =
                    status === "Below"
                      ? "bg-rose-100 text-rose-700"
                      : status === "Above"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-700";

                  return (
                    <tr
                      key={row.sku}
                      className="rounded-xl bg-slate-50/80 shadow-sm ring-1 ring-slate-200/60 transition hover:bg-white dark:bg-slate-900/70 dark:ring-slate-800"
                    >
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-white break-all">
                        {row.sku}
                      </td>
                      <td
                        className="px-3 py-3 text-slate-600 dark:text-slate-300 break-words"
                        title={row.title}
                      >
                        {row.title}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-900 dark:text-white">
                        {formatCurrency(row.shopifyPrice)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.shopifyCost)}
                      </td>
                      {showUsd && (
                        <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                          {formatCurrency(row.marketPriceUsd)}
                        </td>
                      )}
                      <td className="px-3 py-3 text-right text-slate-900 dark:text-white">
                        {formatCurrency(row.marketPriceCad)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                        {formatSignedCurrency(row.difference)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatPercent(row.differencePct)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyles}`}
                        >
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sortedCompareRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={showUsd ? 9 : 8}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      Upload a Shopify CSV to see matched products.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Shopify Margin Table
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sorted by lowest margin first.
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-hidden">
            <table className="w-full table-auto border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr>
                    <th className="px-3 pb-2 text-left">
                      <SortButton
                        label="SKU"
                        sortKey="sku"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                      />
                    </th>
                    <th className="px-3 pb-2 text-left">
                      <SortButton
                        label="Title"
                        sortKey="title"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Shopify"
                        sortKey="shopifyPrice"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Cost"
                        sortKey="shopifyCost"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Profit"
                        sortKey="shopifyProfit"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Margin"
                        sortKey="shopifyMargin"
                        sortState={shopifyProfitSort}
                        onChange={setShopifyProfitSort}
                        align="right"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedShopifyProfitRows.map((row) => (
                    <tr
                      key={`shopify-${row.sku}`}
                      className="rounded-xl bg-slate-50/80 shadow-sm ring-1 ring-slate-200/60 transition hover:bg-white dark:bg-slate-900/70 dark:ring-slate-800"
                    >
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-white break-all">
                        {row.sku}
                      </td>
                      <td
                        className="px-3 py-3 text-slate-600 dark:text-slate-300 break-words"
                        title={row.title}
                      >
                        {row.title}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-900 dark:text-white">
                        {formatCurrency(row.shopifyPrice)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.shopifyCost)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                        {formatSignedCurrency(row.shopifyProfit)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatPercent(row.shopifyMargin)}
                      </td>
                    </tr>
                  ))}
                  {sortedShopifyProfitRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-sm text-slate-500"
                      >
                        No matched products yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Market Margin Table
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sorted by lowest margin first.
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-hidden">
            <table className="w-full table-auto border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr>
                    <th className="px-3 pb-2 text-left">
                      <SortButton
                        label="SKU"
                        sortKey="sku"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                      />
                    </th>
                    <th className="px-3 pb-2 text-left">
                      <SortButton
                        label="Title"
                        sortKey="title"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                      />
                    </th>
                    <th className="px-3 pb-2 text-left">
                      <SortButton
                        label="Release Date"
                        sortKey="releaseDateMs"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                      />
                    </th>
                    {showUsd && (
                      <th className="px-3 pb-2 text-right">
                        <SortButton
                          label="Market USD"
                          sortKey="marketPriceUsd"
                          sortState={marketProfitSort}
                          onChange={setMarketProfitSort}
                          align="right"
                        />
                      </th>
                    )}
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Market"
                        sortKey="marketPriceCad"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Cost"
                        sortKey="shopifyCost"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Profit"
                        sortKey="marketProfit"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Profit / Day"
                        sortKey="marketProfitPerDay"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                        align="right"
                      />
                    </th>
                    <th className="px-3 pb-2 text-right">
                      <SortButton
                        label="Margin"
                        sortKey="marketMargin"
                        sortState={marketProfitSort}
                        onChange={setMarketProfitSort}
                        align="right"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMarketProfitRows.map((row) => (
                    <tr
                      key={`market-${row.sku}`}
                      className="rounded-xl bg-slate-50/80 shadow-sm ring-1 ring-slate-200/60 transition hover:bg-white dark:bg-slate-900/70 dark:ring-slate-800"
                    >
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-white break-all">
                        {row.sku}
                      </td>
                      <td
                        className="px-3 py-3 text-slate-600 dark:text-slate-300 break-words"
                        title={row.title}
                      >
                        {row.title}
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                        {formatReleaseDate(row.releaseDate)}
                      </td>
                      {showUsd && (
                        <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                          {formatCurrency(row.marketPriceUsd)}
                        </td>
                      )}
                      <td className="px-3 py-3 text-right text-slate-900 dark:text-white">
                        {formatCurrency(row.marketPriceCad)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.shopifyCost)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                        {formatSignedCurrency(row.marketProfit)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatSignedCurrency(row.marketProfitPerDay)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 dark:text-slate-400">
                        {formatPercent(row.marketMargin)}
                      </td>
                    </tr>
                  ))}
                  {sortedMarketProfitRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={showUsd ? 9 : 8}
                        className="px-3 py-6 text-center text-sm text-slate-500"
                      >
                        No matched products yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
