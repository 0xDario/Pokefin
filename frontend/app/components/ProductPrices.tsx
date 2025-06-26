// Updated ProductPrices.tsx with dynamic exchange rate and generation filter

"use client";

import React, { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import PriceChart from "./PriceChart";
import { fetchUSDToCADRate } from "./ExchangeRateService";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const Skeleton = () => <div className="animate-pulse bg-slate-300 rounded h-36 w-full" />;

const PRODUCT_PRIORITY = ["booster_box", "pokemon_center_etb", "etb", "booster_bundle"];

const PRODUCT_TYPE_DISPLAY_NAMES = {
  "booster_box": "Booster Box",
  "etb": "Elite Trainer Box", 
  "pokemon_center_etb": "Pokemon Center Exclusive ETB",
  "booster_bundle": "Booster Bundle"
};

type PriceHistoryEntry = {
  usd_price: number;
  recorded_at: string;
};

type Product = {
  id: number;
  usd_price: number;
  last_updated: string;
  url: string;
  sets: {
    id: number;
    name: string;
    code: string;
    release_date: string;
    generation_id: number;
    generations: {
      name: string;
    };
  };
  product_types: {
    name: string;
    label: string;
  };
};

function get1DReturn(history: PriceHistoryEntry[] | undefined) {
  if (!history || history.length < 2) return null;
  const latest = history[0];
  const latestDate = new Date(latest.recorded_at).toISOString().split("T")[0];
  const prevDayEntry = history.find(h => {
    const hDate = new Date(h.recorded_at).toISOString().split("T")[0];
    return hDate < latestDate;
  });
  if (!prevDayEntry) return null;
  const change = latest.usd_price - prevDayEntry.usd_price;
  const percent = (change / prevDayEntry.usd_price) * 100;
  return { change, percent };
}

function get30DReturn(history: PriceHistoryEntry[] | undefined) {
  if (!history || history.length < 2) return null;
  const [latest, ...rest] = history;
  const thirtyDaysAgo = rest.find(h =>
    new Date(latest.recorded_at).getTime() - new Date(h.recorded_at).getTime() >= 1000 * 60 * 60 * 24 * 30
  );
  if (!thirtyDaysAgo) return null;
  const change = latest.usd_price - thirtyDaysAgo.usd_price;
  const percent = (change / thirtyDaysAgo.usd_price) * 100;
  return { change, percent };
}

function render1DReturn(productId: number, priceHistory: Record<number, PriceHistoryEntry[]>) {
  const history = priceHistory[productId] || [];
  const ret = get1DReturn(history);
  if (!ret || typeof ret.percent !== "number") {
    return <span className="font-semibold text-sm block mb-1 text-slate-500">1D: —</span>;
  }
  
  const changeSign = ret.change > 0 ? "+" : "";
  const percentSign = ret.percent > 0 ? "+" : "";
  
  return (
    <span className={`font-semibold text-sm block mb-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
      1D: {changeSign}${ret.change.toFixed(2)} ({percentSign}{ret.percent.toFixed(2)}%)
    </span>
  );
}

function render30DReturn(productId: number, priceHistory: Record<number, PriceHistoryEntry[]>) {
  const history = priceHistory[productId] || [];
  const ret = get30DReturn(history);
  if (!ret || typeof ret.percent !== "number") return null;
  
  const changeSign = ret.change > 0 ? "+" : "";
  const percentSign = ret.percent > 0 ? "+" : "";
  
  return (
    <span className={`font-semibold text-sm block mb-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
      30D: {changeSign}${ret.change.toFixed(2)} ({percentSign}{ret.percent.toFixed(2)}%)
    </span>
  );
}

export default function ProductPrices() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortProductType, setSortProductType] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  const [chartTimeframe, setChartTimeframe] = useState<"7D" | "30D" | "90D">("30D");
  const [sortStates, setSortStates] = useState<{
    [key in "release_date" | "set_name" | "price"]?: "asc" | "desc" | null;
  }>({
    release_date: null,
    set_name: null,
    price: "desc", // default sort
  });
  
  // New state for generation filter
  const [selectedGeneration, setSelectedGeneration] = useState<string>("all");
  
  // New state for exchange rate
  const [exchangeRate, setExchangeRate] = useState<number>(1.37); // fallback
  const [exchangeRateDate, setExchangeRateDate] = useState<string>("");
  const [exchangeRateLoading, setExchangeRateLoading] = useState<boolean>(true);

  // Extract unique generations from products
  const availableGenerations = useMemo(() => {
    // Define generation order (from newest to oldest)
    const generationOrder = [
      "Scarlet & Violet",
      "Sword & Shield",
      "Sun & Moon",
      "XY",
      "Black & White",
      "HeartGold & SoulSilver",
      "Platinum",
      "Diamond & Pearl",
      "EX",
      "E-Card",
      "Neo",
      "Base"
    ];

    const generations = new Set<string>();
    products.forEach(product => {
      if (product.sets?.generations?.name) {
        generations.add(product.sets.generations.name);
      }
    });
    
    // Sort by predefined order, with any unknown generations at the end
    return Array.from(generations).sort((a, b) => {
      const indexA = generationOrder.indexOf(a);
      const indexB = generationOrder.indexOf(b);
      
      // If both are in the order list, sort by their position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only one is in the list, it comes first
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      // If neither is in the list, sort alphabetically
      return a.localeCompare(b);
    });
  }, [products]);

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      const { data, error } = await supabase
        .from("products")
        .select(`id, usd_price, last_updated, url,
                 sets ( id, name, code, release_date, generation_id, generations!inner ( name ) ),
                 product_types ( name, label )`)
        .order("last_updated", { ascending: false });

      if (!error && data) setProducts(data as any);
      setLoading(false);
    }
    fetchProducts();
  }, []);

  // New useEffect to fetch exchange rate
  useEffect(() => {
    async function loadExchangeRate() {
      setExchangeRateLoading(true);
      try {
        const result = await fetchUSDToCADRate();
        setExchangeRate(result.rate);
        if (result.date) {
          setExchangeRateDate(result.date);
        }
        console.log(`[ProductPrices] Exchange rate loaded: ${result.rate} (cached: ${result.cached})`);
      } catch (error) {
        console.error('[ProductPrices] Failed to load exchange rate:', error);
        // Keep the fallback rate (1.37) that's already set
      } finally {
        setExchangeRateLoading(false);
      }
    }
    loadExchangeRate();
  }, []);

  useEffect(() => {
    if (products.length === 0) return;
    
    async function fetchHistoryBatch() {
      console.log(`[ProductPrices] Fetching history for ${products.length} products...`);
      
      // Calculate cutoff date for 90 days ago
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const historyByProduct: Record<number, PriceHistoryEntry[]> = {};
      
      // Process products in smaller batches to avoid hitting limits
      const batchSize = 5;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const batchIds = batch.map(p => p.id);
        
        console.log(`[ProductPrices] Fetching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(products.length/batchSize)} (products ${batchIds.join(', ')})`);
        
        try {
          const { data, error } = await supabase
            .from("product_price_history")
            .select("product_id, usd_price, recorded_at")
            .in("product_id", batchIds)
            .gte("recorded_at", ninetyDaysAgo.toISOString())
            .order("recorded_at", { ascending: false })
            .limit(1000); // This should be enough for 5 products * ~120 records each

          if (error) {
            console.error(`[ProductPrices] Error fetching batch:`, error);
            continue;
          }

          if (data) {
            // Group by product ID
            for (const record of data as (PriceHistoryEntry & { product_id: number })[]) {
              if (!historyByProduct[record.product_id]) {
                historyByProduct[record.product_id] = [];
              }
              historyByProduct[record.product_id].push(record);
            }
          }
          
          // Small delay between batches to be nice to the API
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (err) {
          console.error(`[ProductPrices] Error in batch ${i}:`, err);
        }
      }
      
      // Log results
      Object.entries(historyByProduct).forEach(([productId, history]) => {
        if (history.length > 0) {
          const earliest = history[history.length - 1]?.recorded_at;
          const latest = history[0]?.recorded_at;
          console.log(`[ProductPrices] Product ${productId}: ${history.length} records from ${earliest} to ${latest}`);
        }
      });
      
      console.log(`[ProductPrices] Total history records fetched: ${Object.values(historyByProduct).reduce((sum, arr) => sum + arr.length, 0)}`);
      setPriceHistory(historyByProduct);
    }
    
    fetchHistoryBatch();
  }, [products]);

  const toggleSortBy = (key: "release_date" | "set_name" | "price") => {
    setSortStates((prev) => {
      const current = prev[key];
      let next: "asc" | "desc" | null = null;
      if (current === null) next = "asc";
      else if (current === "asc") next = "desc";
      else next = null;
      return { ...prev, [key]: next };
    });
  };

  const filteredProducts = products.filter((p: any) => {
    // Search filter
    const search = searchTerm.toLowerCase().replace(/\betb\b/g, "elite trainer box");
    const target = `${p.sets?.name ?? ""} ${p.sets?.code ?? ""} ${p.product_types?.label ?? ""}`.toLowerCase();
    const matchesSearch = target.includes(search);
    
    // Generation filter
    const matchesGeneration = selectedGeneration === "all" || p.sets?.generations?.name === selectedGeneration;
    
    return matchesSearch && matchesGeneration;
  });

  const groupedProducts: Record<string, Product[]> = filteredProducts.reduce((acc: Record<string, Product[]>, item: Product) => {
    const key = `${item.sets?.name}||${item.sets?.code}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const sortedFlatProducts = [...filteredProducts]
    .filter((p: any) => (sortProductType ? p.product_types?.name === sortProductType : true))
    .sort((a: any, b: any) => {
      const sortKeys: ("release_date" | "set_name" | "price")[] = ["release_date", "set_name", "price"];
      for (const key of sortKeys) {
        const dir = sortStates[key];
        if (!dir) continue;
        let valA, valB;
        if (key === "release_date") {
          valA = new Date(a.sets?.release_date ?? 0).getTime();
          valB = new Date(b.sets?.release_date ?? 0).getTime();
        } else if (key === "set_name") {
          valA = a.sets?.name ?? "";
          valB = b.sets?.name ?? "";
        } else if (key === "price") {
          valA = a.usd_price ?? 0;
          valB = b.usd_price ?? 0;
        }
        if (valA < valB) return dir === "asc" ? -1 : 1;
        if (valA > valB) return dir === "asc" ? 1 : -1;
      }
      return 0;
    });

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans space-y-10">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Generation Filter */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">Generation:</span>
          <button
            onClick={() => setSelectedGeneration("all")}
            className={`px-3 py-1 rounded border text-sm font-medium transition-all ${
              selectedGeneration === "all" 
                ? "bg-purple-600 text-white" 
                : "bg-white text-slate-700 hover:bg-gray-50"
            }`}
          >
            All
          </button>
          {availableGenerations.map((generation) => (
            <button
              key={generation}
              onClick={() => setSelectedGeneration(generation)}
              className={`px-3 py-1 rounded border text-sm font-medium transition-all ${
                selectedGeneration === generation 
                  ? "bg-purple-600 text-white" 
                  : "bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              {generation}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1 rounded border text-sm text-slate-700 bg-white"
        />

        {/* Chart timeframe */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">Chart timeframe:</span>
          {(["7D", "30D", "90D"] as const).map((timeframe) => (
            <button
              key={timeframe}
              onClick={() => setChartTimeframe(timeframe)}
              className={`px-3 py-1 rounded border text-sm font-medium transition-all ${
                chartTimeframe === timeframe 
                  ? "bg-green-600 text-white" 
                  : "bg-white text-slate-700 hover:bg-gray-50"
              }`}
            >
              {timeframe}
            </button>
          ))}
        </div>

        {/* Exchange Rate Display */}
        <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-blue-50 rounded border">
          <span className="text-sm font-medium text-blue-800">
            USD → CAD: 
          </span>
          {exchangeRateLoading ? (
            <span className="text-sm text-blue-600">Loading...</span>
          ) : (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-blue-600">
                {exchangeRate.toFixed(4)}
              </span>
              {exchangeRateDate && (
                <span className="text-xs text-blue-500">
                  as of {exchangeRateDate}
                </span>
              )}
              {/* Add this to show if it's cached */}
              <span className="text-xs text-blue-400">
                {/* This would show the source if we modify the service to return it */}
                Live rate
              </span>
            </div>
          )}
        </div>
        {/* Toggle View */}
        <button
          onClick={() => setViewMode(viewMode === "grouped" ? "flat" : "grouped")}
          className="ml-auto px-4 py-1 rounded bg-slate-800 text-white text-sm font-medium"
        >
          Toggle View ({viewMode})
        </button>
      </div>

      {/* Flat view only: Product type and set sorting */}
      {viewMode === "flat" && (
        <div className="flex flex-wrap items-center gap-4 mb-6">
          {/* Product type filter/sort */}
          <span className="font-semibold text-slate-800">Filter by product type:</span>
          {PRODUCT_PRIORITY.map((type) => (
            <button
              key={type}
              onClick={() => setSortProductType(sortProductType === type ? null : type)}
              className={`px-4 py-1 rounded border text-sm font-medium transition-all ${
                sortProductType === type ? "bg-blue-600 text-white" : "bg-white text-slate-700"
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}

          {/* Set sorting */}
          <span className="font-semibold text-slate-800 ml-6">Sort sets by:</span>
          {(["release_date", "set_name", "price"] as const).map((key) => (
            <button
              key={key}
              onClick={() => toggleSortBy(key)}
              className={`px-4 py-1 rounded border text-sm font-medium ${
                sortStates[key] ? "bg-blue-600 text-white" : "bg-white text-slate-700"
              }`}
            >
              {key === "release_date" && "Release Date"}
              {key === "set_name" && "Set Name"}
              {key === "price" && "Price"}
              {sortStates[key] === "asc" && " ↑"}
              {sortStates[key] === "desc" && " ↓"}
            </button>
          ))}
        </div>
      )}

      {loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}

{/* OPTION 2: PLACEHOLDER GRID - Replace the grouped products section with this */}
      {!loading && viewMode === "grouped" &&
        Object.entries(groupedProducts)
          .sort(([, a]: [string, Product[]], [, b]: [string, Product[]]) => {
            const dateA = new Date(a[0].sets?.release_date + "T00:00:00Z").getTime();
            const dateB = new Date(b[0].sets?.release_date + "T00:00:00Z").getTime();
            return dateB - dateA;
          })
          .map(([groupKey, items]: [string, Product[]]) => {
            const [setName, setCode] = groupKey.split("||");
            const sortedItems = [...items].sort((a: Product, b: Product) =>
              PRODUCT_PRIORITY.indexOf(a.product_types?.name) - PRODUCT_PRIORITY.indexOf(b.product_types?.name)
            );

            return (
              <div key={groupKey}>
                <h2 className="text-2xl font-bold text-slate-800 mb-4 border-b border-slate-300 pb-1">
                  {setName} {setCode && <span className="text-slate-500 text-base">({setCode})</span>}
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    ({sortedItems.length}/{PRODUCT_PRIORITY.length} products available)
                  </span>
                </h2>
                {/* Fixed 4-column grid with placeholders for missing products */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {PRODUCT_PRIORITY.map((type: string) => {
                    const product = sortedItems.find((p: Product) => p.product_types?.name === type);
                    
                    if (product) {
                      // Existing product card
                      return (
                        <div
                          key={product.id}
                          className="rounded-xl border border-slate-300 bg-white p-5 shadow hover:shadow-lg transition-shadow"
                        >
                          <div>
                            <h3 className="font-semibold text-slate-800 text-lg mb-2">
                              {product.product_types?.label || product.product_types?.name}
                            </h3>
                            <p className="text-sm text-slate-600 mb-1">
                              <span className="font-medium text-slate-700">Generation:</span> {product.sets?.generations?.name || "Unknown"}
                            </p>
                            <p className="text-sm text-slate-600 mb-2">
                              <span className="font-medium text-slate-700">Release Date:</span>{" "}
                              {product.sets?.release_date ? 
                                new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString() : "Unknown"}
                            </p>
                            <p className="text-3xl font-extrabold text-green-600 tracking-tight mb-1">
                              ${product.usd_price?.toFixed(2) || "N/A"} USD
                            </p>
                            {render1DReturn(product.id, priceHistory)}
                            {render30DReturn(product.id, priceHistory)}
                            <p className="text-md font-medium text-indigo-700 mb-3">
                              ~${(product.usd_price * exchangeRate).toFixed(2)} CAD
                            </p>
                            {priceHistory[product.id]?.length > 1 && (
                              <div className="mt-2">
                                <PriceChart data={priceHistory[product.id]} range={chartTimeframe} />
                              </div>
                            )}
                            <a
                              href={product.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-sm font-medium text-blue-600 hover:underline"
                            >
                              View on TCGPlayer
                            </a>
                            <p className="text-xs text-slate-400 mt-2">
                              Updated: {new Date(product.last_updated + 'Z').toLocaleString(undefined, {
                                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                timeZoneName: 'short'
                              })}
                            </p>
                          </div>
                        </div>
                      );
                    } else {
                      // Placeholder for missing product
                      const displayName = PRODUCT_TYPE_DISPLAY_NAMES[type] || type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ');
                      return (
                        <div
                          key={`${groupKey}-${type}-placeholder`}
                          className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 flex items-center justify-center min-h-[250px]"
                        >
                          <div className="text-center text-slate-400">
                            <div className="text-4xl mb-3">📦</div>
                            <p className="text-sm font-medium mb-1">
                              {displayName}
                            </p>
                            <p className="text-xs text-slate-500">
                              Not Available
                            </p>
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>
            );
          })}

      {!loading && viewMode === "flat" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {sortedFlatProducts.map((product: any) => (
            <div
              key={product.id}
              className="rounded-xl border border-slate-300 bg-white p-5 shadow hover:shadow-lg transition-shadow"
            >
              <h2 className="font-semibold text-slate-800 text-lg mb-2">
                {product.sets?.name} ({product.sets?.code})
              </h2>
              <p className="text-sm text-slate-600 mb-1">
                <span className="font-medium text-slate-700">Type:</span> {product.product_types?.label || product.product_types?.name}
              </p>
              <p className="text-sm text-slate-600 mb-1">
                <span className="font-medium text-slate-700">Generation:</span> {product.sets?.generations?.name || "Unknown"}
              </p>
              <p className="text-sm text-slate-600 mb-2">
                <span className="font-medium text-slate-700">Release Date:</span>{" "}
                {product.sets?.release_date ? 
                  new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString() : "Unknown"}
              </p>
              <p className="text-2xl font-extrabold text-green-600 tracking-tight mb-1">
                ${product.usd_price?.toFixed(2) || "N/A"} USD
              </p>
              {render1DReturn(product.id, priceHistory)}
              {render30DReturn(product.id, priceHistory)}
              <p className="text-md font-medium text-indigo-700 mb-2">
                ~${(product.usd_price * exchangeRate).toFixed(2)} CAD
              </p>
              {priceHistory[product.id]?.length > 1 && (
                <div className="mt-2">
                  <PriceChart data={priceHistory[product.id]} range={chartTimeframe} />
                </div>
              )}
              <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm font-medium text-blue-600 hover:underline"
              >
                View on TCGPlayer
              </a>
              <p className="text-xs text-slate-400 mt-2">
                Updated: {new Date(product.last_updated + 'Z').toLocaleString(undefined, {
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  timeZoneName: 'short'
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}