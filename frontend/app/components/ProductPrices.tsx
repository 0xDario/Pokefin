"use client";

import React, { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import Image from "next/image";
import PriceChart from "./PriceChart";
import { fetchUSDToCADRate } from "./ExchangeRateService";
import CardRinkPromo from "./CardRinkPromo";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

// Define currency type
type Currency = "USD" | "CAD";

// Add Image component with fallback
const ProductImage = ({ imageUrl, productName, className = "" }: { 
  imageUrl?: string | null; 
  productName: string; 
  className?: string;
}) => {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setIsLoading(false);
  };

  if (!imageUrl || imageError) {
    return (
      <div className={`bg-slate-200 border-2 border-dashed border-slate-300 flex items-center justify-center ${className}`}>
        <div className="text-center text-slate-500 p-4">
          <div className="text-2xl mb-2">🃏</div>
          <div className="text-xs font-medium">No Image</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse flex items-center justify-center">
          <div className="text-slate-400">Loading...</div>
        </div>
      )}
      <div className="w-full h-full flex items-center justify-center p-4">
        <Image
          src={imageUrl}
          alt={productName}
          width={200}
          height={200}
          className={`max-w-full max-h-full object-contain transition-opacity ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={handleImageLoad}
          onError={handleImageError}
          loading="lazy"
          unoptimized={imageUrl.includes('tcgplayer') || imageUrl.includes('external')}
        />
      </div>
    </div>
  );
};

// Expansion type badge component
const ExpansionTypeBadge = ({ type }: { type?: string }) => {
  if (!type) return null;
  
  const badgeColors = {
    'Main Series': 'bg-blue-100 text-blue-800 border-blue-200',
    'Special Expansion': 'bg-purple-100 text-purple-800 border-purple-200',
    'Subset': 'bg-amber-100 text-amber-800 border-amber-200',
    'Starter Set': 'bg-green-100 text-green-800 border-green-200'
  };
  
  const color = badgeColors[type as keyof typeof badgeColors] || 'bg-gray-100 text-gray-800 border-gray-200';
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      {type}
    </span>
  );
};

// Variant badge component
const VariantBadge = ({ variant }: { variant?: string }) => {
  if (!variant) return null;
  
  // Special styling for Pokemon Center exclusives
  if (variant.toLowerCase().includes('pokemon center')) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm">
        ⭐ {variant}
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300">
      {variant}
    </span>
  );
};

type PriceHistoryEntry = {
  usd_price: number;
  recorded_at: string;
};

export default function ProductPrices() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGeneration, setSelectedGeneration] = useState("all");
  const [selectedProductType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<"price" | "release_date">("release_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("grouped");
  const [chartTimeframe, setChartTimeframe] = useState<"7D" | "1M" | "3M" | "6M" | "1Y">("1M");
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  
  // Currency state
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("CAD");
  const [exchangeRate, setExchangeRate] = useState(1.36);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
    
  // Helper function to convert prices based on selected currency
  const convertPrice = (usdPrice: number | null | undefined): number => {
    if (!usdPrice) return 0;
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  };

  // Helper function to format price with currency symbol
  const formatPrice = (usdPrice: number | null | undefined): string => {
    const price = convertPrice(usdPrice);
    const symbol = selectedCurrency === "CAD" ? "C$" : "$";
    return `${symbol}${price.toFixed(2)}`;
  };

  // Load products
  useEffect(() => {
    async function fetchProducts() {
      const { data, error } = await supabase
        .from("products")
        .select(`id, usd_price, last_updated, url, image_url, variant,
                 sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( name ) ),
                 product_types ( name, label )`)
        .order("last_updated", { ascending: false });

      if (!error && data) setProducts(data as any);
      setLoading(false);
    }
    fetchProducts();
  }, []);

  // Exchange rate loading
  useEffect(() => {
    async function loadExchangeRate() {
      setExchangeRateLoading(true);
      try {
        const result = await fetchUSDToCADRate();
        setExchangeRate(result.rate);
        console.log(`[ProductPrices] Exchange rate loaded: ${result.rate} (date: ${result.date})`);
      } catch (error) {
        console.error('[ProductPrices] Failed to load exchange rate:', error);
      } finally {
        setExchangeRateLoading(false);
      }
    }
    loadExchangeRate();
  }, []);

  // Price history loading - single optimized query
  useEffect(() => {
    if (products.length === 0) return;

    async function fetchHistory() {
      const daysNeeded = chartTimeframe === "7D" ? 7
        : chartTimeframe === "1M" ? 30
        : chartTimeframe === "3M" ? 90
        : chartTimeframe === "6M" ? 180
        : 365; // 1Y

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysNeeded);

      const productIds = products.map(p => p.id);

      try {
        // Use RPC function for deduplicated data (one row per product per day)
        const { data, error } = await supabase.rpc('get_price_history_deduplicated', {
          p_product_ids: productIds,
          p_start_date: startDate.toISOString()
        });

        if (error) {
          console.error("[ProductPrices] Fetch error:", error);
          return;
        }

        // Group by product_id
        const historyByProduct: Record<number, PriceHistoryEntry[]> = {};
        for (const entry of data || []) {
          if (!historyByProduct[entry.product_id]) {
            historyByProduct[entry.product_id] = [];
          }
          historyByProduct[entry.product_id].push({
            usd_price: entry.usd_price,
            recorded_at: entry.recorded_at,
          });
        }

        setPriceHistory(historyByProduct);
      } catch (err) {
        console.error("[ProductPrices] Fetch exception:", err);
      }
    }

    fetchHistory();
  }, [products, chartTimeframe]);

  // Return calculations with currency conversion
  const get1DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;
    
    const currentPrice = convertPrice(history[0].usd_price);
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneDayAgo;
    });
    
    if (!pastEntry) return null;
    
    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;
    
    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const get7DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= sevenDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const get30DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= thirtyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const get90DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= ninetyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const get180DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneEightyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const get365DReturn = (history: PriceHistoryEntry[] | undefined) => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const pastEntry = history.find(entry => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneYearAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  const render1DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get1DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;
    
    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";
    
    return (
      <p className="text-sm text-slate-600 mt-1">
        1D: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const render7DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get7DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;

    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";

    return (
      <p className="text-sm text-slate-600">
        7D: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const render30DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get30DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;

    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";

    return (
      <p className="text-sm text-slate-600">
        1M: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const render90DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get90DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;

    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";

    return (
      <p className="text-sm text-slate-600">
        3M: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const render180DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get180DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;

    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";

    return (
      <p className="text-sm text-slate-600">
        6M: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const render365DReturn = (productId: number, history: Record<number, PriceHistoryEntry[]>) => {
    const ret = get365DReturn(history[productId]);
    if (!ret || typeof ret.percent !== "number") return null;

    const percentSign = ret.percent > 0 ? "+" : "";
    const colorClass = ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500";

    return (
      <p className="text-sm text-slate-600">
        1Y: <span className={`font-bold ${colorClass}`}>{percentSign}{ret.percent.toFixed(2)}%</span>
      </p>
    );
  };

  const availableGenerations = [...new Set(products.map(p => p.sets?.generations?.name).filter(Boolean))].sort();

  // Helper function to determine product sort order within a set
  const getProductSortOrder = (product: any): number => {
    const productTypeName = (product.product_types?.name || "").toLowerCase();
    const productTypeLabel = (product.product_types?.label || "").toLowerCase();
    const variant = (product.variant || "").toLowerCase();

    // Booster Box
    if (productTypeName.includes("booster_box") || productTypeLabel.includes("booster box")) {
      return 1;
    }

    // ETB (Elite Trainer Box)
    if (productTypeName.includes("elite_trainer_box") || productTypeLabel.includes("elite trainer box")) {
      // Pokemon Center ETB comes first (order 2)
      if (variant.includes("pokemon center")) {
        return 2;
      }
      // Standard ETB comes second (order 3)
      return 3;
    }

    // Booster Bundle
    if (productTypeName.includes("booster_bundle") || productTypeLabel.includes("booster bundle")) {
      return 4;
    }

    // Booster Pack (includes both regular and sleeved)
    if (productTypeName.includes("booster_pack") || productTypeLabel.includes("booster pack")) {
      return 5;
    }

    // Sleeved Booster Pack
    if (productTypeName.includes("sleeved_booster") || productTypeLabel.includes("sleeved booster")) {
      return 6;
    }

    // Any other product type goes to the end
    return 999;
  };

  const filteredProducts = useMemo(() =>
    products.filter(product => {
      const matchesGeneration = selectedGeneration === "all" || product.sets?.generations?.name === selectedGeneration;
      const productTypeLabel = product.product_types?.label || product.product_types?.name || "";
      const matchesProductType = selectedProductType === "all" || productTypeLabel === selectedProductType;

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        product.sets?.name?.toLowerCase().includes(searchLower) ||
        product.sets?.code?.toLowerCase().includes(searchLower) ||
        product.product_types?.name?.toLowerCase().includes(searchLower) ||
        product.variant?.toLowerCase().includes(searchLower);

      return matchesGeneration && matchesProductType && matchesSearch;
    })
    .sort((a, b) => {
      // Primary sort by the selected sort key
      if (sortKey === "release_date") {
        const dateA = new Date(a.sets?.release_date ?? 0).getTime();
        const dateB = new Date(b.sets?.release_date ?? 0).getTime();

        // Sort by release date
        if (dateA !== dateB) {
          return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
        }

        // If same release date, use product type order as secondary sort
        const orderA = getProductSortOrder(a);
        const orderB = getProductSortOrder(b);
        return orderA - orderB;
      } else if (sortKey === "price") {
        const priceA = a.usd_price ?? 0;
        const priceB = b.usd_price ?? 0;
        return sortDirection === "asc" ? priceA - priceB : priceB - priceA;
      }

      return 0;
    }), [products, selectedGeneration, selectedProductType, searchTerm, sortKey, sortDirection]);

  const groupedProducts = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const product of filteredProducts) {
      const setName = product.sets?.name || "Unknown Set";
      if (!groups.has(setName)) {
        groups.set(setName, []);
      }
      groups.get(setName)!.push(product);
    }

    // Sort products within each group by the custom order
    for (const [, products] of groups.entries()) {
      products.sort((a, b) => {
        const orderA = getProductSortOrder(a);
        const orderB = getProductSortOrder(b);
        return orderA - orderB;
      });
    }

    return Array.from(groups.entries()).sort((a, b) => {
      const dateA = a[1][0]?.sets?.release_date || "";
      const dateB = b[1][0]?.sets?.release_date || "";
      return dateB.localeCompare(dateA);
    });
  }, [filteredProducts]);

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans space-y-10">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Generation Filter */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">Generation:</span>
          <select
            value={selectedGeneration}
            onChange={(e) => setSelectedGeneration(e.target.value)}
            className="px-3 py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="all">All Generations</option>
            {availableGenerations.map((generation) => (
              <option key={generation} value={generation}>
                {generation}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name or variant..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1 rounded border text-sm text-slate-700 bg-white"
        />

        {/* Chart timeframe */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">Chart:</span>
          {(["7D", "1M", "3M", "6M", "1Y"] as const).map((timeframe) => (
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

        {/* Exchange Rate Display with Currency Dropdown */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded border">
            <span className="text-sm font-medium text-blue-800">
              USD → CAD: 
            </span>
            {exchangeRateLoading ? (
              <span className="text-sm text-blue-600">Loading...</span>
            ) : (
              <span className="text-sm font-bold text-blue-900">
                {exchangeRate.toFixed(4)}
              </span>
            )}
          </div>

          {/* Currency Selector Dropdown */}
          <select
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
            className="px-3 py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="USD">🇺🇸 USD</option>
            <option value="CAD">🇨🇦 CAD</option>
          </select>
        </div>
      </div>

      {/* Sorting and View Controls */}
      <div className="flex gap-2 items-center">
        <span className="font-semibold text-slate-800">Sort by:</span>
        {(["release_date", "price"] as const).map(key => (
          <button
            key={key}
            onClick={() => {
              if (sortKey === key) {
                setSortDirection(sortDirection === "asc" ? "desc" : "asc");
              } else {
                setSortKey(key);
                setSortDirection(key === "price" ? "desc" : "desc");
              }
            }}
            className={`px-3 py-1 rounded border text-sm font-medium transition-all ${
              sortKey === key
                ? "bg-purple-600 text-white"
                : "bg-white text-slate-700 hover:bg-gray-50"
            }`}
          >
            {key === "release_date" ? "Release Date" : "Price"}
            {sortKey === key && (
              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="font-semibold text-slate-800">View:</span>
          <button
            onClick={() => setViewMode(viewMode === "flat" ? "grouped" : "flat")}
            className="px-3 py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all"
          >
            {viewMode === "flat" ? "📋 Flat" : "📁 Grouped"}
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-slate-600">
        Found {filteredProducts.length} products
      </div>

      {/* CardRinkTCG Promotional Banner */}
      <CardRinkPromo variant="banner" />

      {loading && <div>Loading products...</div>}

      {/* Product Display - Flat View */}
      {!loading && viewMode === "flat" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <div key={product.id} className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow">
              <ProductImage
                imageUrl={product.image_url}
                productName={`${product.sets?.name} ${product.product_types?.label || product.product_types?.name}`}
                className="w-full h-48"
              />
              <div className="p-5">
                <div className="mb-3">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    {product.sets?.name}
                  </h2>
                  <ExpansionTypeBadge type={product.sets?.expansion_type} />
                  <h3 className="text-md font-medium text-slate-700 mt-2 leading-tight">
                    {product.product_types?.label || product.product_types?.name}
                  </h3>
                  {product.variant && <VariantBadge variant={product.variant} />}
                  <p className="text-xs text-slate-500 mt-1 space-y-0.5">
                    <span className="block">{product.sets?.generations?.name}</span>
                    <span className="block">Set: {product.sets?.code}</span>
                    Release: {product.sets?.release_date ? 
                      new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString() : "Unknown"}
                  </p>
                </div>
                <p className="text-3xl font-extrabold text-green-600 tracking-tight mb-1">
                  {formatPrice(product.usd_price)}
                </p>
                {/* Conditional rendering based on chart timeframe */}
                {chartTimeframe === "7D" && (
                  <>
                    {render1DReturn(product.id, priceHistory)}
                    {render7DReturn(product.id, priceHistory)}
                  </>
                )}
                {chartTimeframe === "1M" && (
                  <>
                    {render7DReturn(product.id, priceHistory)}
                    {render30DReturn(product.id, priceHistory)}
                  </>
                )}
                {chartTimeframe === "3M" && (
                  <>
                    {render30DReturn(product.id, priceHistory)}
                    {render90DReturn(product.id, priceHistory)}
                  </>
                )}
                {chartTimeframe === "6M" && (
                  <>
                    {render90DReturn(product.id, priceHistory)}
                    {render180DReturn(product.id, priceHistory)}
                  </>
                )}
                {chartTimeframe === "1Y" && (
                  <>
                    {render90DReturn(product.id, priceHistory)}
                    {render180DReturn(product.id, priceHistory)}
                    {render365DReturn(product.id, priceHistory)}
                  </>
                )}
                {priceHistory[product.id]?.length > 1 && (
                  <div className="mt-2">
                    <PriceChart 
                      data={priceHistory[product.id]} 
                      range={chartTimeframe} 
                      currency={selectedCurrency}
                      exchangeRate={exchangeRate}
                      releaseDate={product.sets?.release_date}
                    />
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
          ))}
        </div>
      )}

      {/* Product Display - Grouped View */}
      {!loading && viewMode === "grouped" && groupedProducts.map(([setName, setProducts]) => (
        <div key={setName} className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-2xl font-bold text-slate-900">{setName}</h2>
            <span className="text-sm text-slate-600">
              ({setProducts[0]?.sets?.code}) - {setProducts[0]?.sets?.generations?.name}
            </span>
            {setProducts[0]?.sets?.expansion_type && (
              <ExpansionTypeBadge type={setProducts[0].sets.expansion_type} />
            )}
            <span className="text-sm text-slate-500 ml-auto">
              Release: {setProducts[0]?.sets?.release_date ? 
                new Date(setProducts[0].sets.release_date + "T00:00:00Z").toLocaleDateString() : "Unknown"}
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {setProducts.map((product) => (
              <div key={product.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                <div className="flex">
                  {/* Left: Image */}
                  <ProductImage
                    imageUrl={product.image_url}
                    productName={`${product.sets?.name} ${product.product_types?.label || product.product_types?.name}`}
                    className="w-32 h-32 flex-shrink-0"
                  />
                  
                  {/* Right: Details */}
                  <div className="flex-1 p-3">
                    <div className="flex justify-between items-start gap-2">
                      {/* Left: Product Info */}
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-800 leading-tight">
                          {product.product_types?.label || product.product_types?.name}
                        </h3>
                        {product.variant && (
                          <div className="mt-1">
                            <VariantBadge variant={product.variant} />
                          </div>
                        )}
                        <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                          <div>{product.sets?.generations?.name}</div>
                        </div>
                      </div>
                      
                      {/* Right: Prices */}
                      <div className="text-right ml-2">
                        <p className="text-xl font-bold text-green-600">
                          {formatPrice(product.usd_price)}
                        </p>
                        {/* Returns info - conditional based on chart timeframe */}
                        <div className="mt-1 text-xs">
                          {chartTimeframe === "7D" && (
                            <>
                              {(() => {
                                const ret = get1DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">1D:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get7DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">7D:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                            </>
                          )}
                          {chartTimeframe === "1M" && (
                            <>
                              {(() => {
                                const ret = get7DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">7D:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get30DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">1M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                            </>
                          )}
                          {chartTimeframe === "3M" && (
                            <>
                              {(() => {
                                const ret = get30DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">1M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get90DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">3M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                            </>
                          )}
                          {chartTimeframe === "6M" && (
                            <>
                              {(() => {
                                const ret = get90DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">3M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get180DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">6M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                            </>
                          )}
                          {chartTimeframe === "1Y" && (
                            <>
                              {(() => {
                                const ret = get90DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">3M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get180DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">6M:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                              {" "}
                              {(() => {
                                const ret = get365DReturn(priceHistory[product.id]);
                                if (!ret || typeof ret.percent !== "number") return null;
                                const percentSign = ret.percent > 0 ? "+" : "";
                                return (
                                  <span>
                                    <span className="text-slate-600">1Y:</span>
                                    <span className={`font-bold ml-1 ${ret.percent > 0 ? "text-green-600" : ret.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                      {percentSign}{ret.percent.toFixed(2)}%
                                    </span>
                                  </span>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Price Chart */}
                    {priceHistory[product.id]?.length > 1 && (
                      <div className="mt-2">
                        <PriceChart 
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
                      className="text-xs text-blue-600 hover:underline mt-2 inline-block"
                    >
                      View on TCGPlayer →
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}