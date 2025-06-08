"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const Skeleton = () => <div className="animate-pulse bg-slate-300 rounded h-36 w-full" />;

const PRODUCT_PRIORITY = ["booster_box", "etb", "booster_bundle"];
const USD_TO_CAD = 1.37;

function get1DReturn(history: { usd_price: number; recorded_at: string }[] | undefined) {
  if (!history || history.length < 2) return null;
  const [latest, ...rest] = history;
  // Find entry at least 24h before latest (for robustness if not exactly 24h apart)
  const oneDayAgo = rest.find(h =>
    (new Date(latest.recorded_at).getTime() - new Date(h.recorded_at).getTime()) >= 1000 * 60 * 60 * 24
  );
  if (!oneDayAgo) return null;
  const change = latest.usd_price - oneDayAgo.usd_price;
  const percent = (change / oneDayAgo.usd_price) * 100;
  return { change, percent };
}

export default function ProductPrices() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sortProductType, setSortProductType] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [sortBy, setSortBy] = useState<"price" | "release_date" | "set_name">("price");
  const [searchTerm, setSearchTerm] = useState("");
  const [priceHistory, setPriceHistory] = useState<Record<number, any[]>>({});

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      const { data, error } = await supabase
        .from("products")
        .select(`id, usd_price, last_updated, url,
                 sets ( id, name, code, release_date, generation_id, generations ( name ) ),
                 product_types ( name, label )`)
        .order("last_updated", { ascending: false });

      if (!error && data) setProducts(data);
      setLoading(false);
    }
    fetchProducts();
  }, []);

  useEffect(() => {
    if (products.length === 0) return;
    async function fetchHistory() {
      const productIds = products.map(p => p.id);
      const { data, error } = await supabase
        .from("product_price_history")
        .select("product_id, usd_price, recorded_at")
        .in("product_id", productIds)
        .order("recorded_at", { ascending: false });

      if (!error && data) {
        const historyByProduct: Record<number, any[]> = {};
        for (const h of data) {
          if (!historyByProduct[h.product_id]) historyByProduct[h.product_id] = [];
          historyByProduct[h.product_id].push(h);
        }
        setPriceHistory(historyByProduct);
      }
    }
    fetchHistory();
  }, [products]);

  const toggleSort = (type: string) => {
    if (sortProductType === type) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortProductType(type);
      setSortDirection("desc");
    }
  };

  const toggleSortBy = (key: "release_date" | "set_name") => {
    if (sortBy === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDirection("asc");
    }
  };

  const filteredProducts = products.filter((p) => {
    const search = searchTerm.toLowerCase().replace(/\betb\b/g, "elite trainer box");
    const searchTarget = `${p.sets?.name ?? ""} ${p.sets?.code ?? ""} ${p.product_types?.label ?? ""}`.toLowerCase();
    return searchTarget.includes(search);
  });

  const groupedProducts = filteredProducts.reduce((acc: Record<string, any[]>, item) => {
    const key = `${item.sets?.name}||${item.sets?.code}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const sortedFlatProducts = [...filteredProducts].filter(p =>
    sortProductType ? p.product_types?.name === sortProductType : true
  ).sort((a, b) => {
    if (sortBy === "release_date") {
      const dateA = new Date(a.sets?.release_date + "T00:00:00Z").getTime();
      const dateB = new Date(b.sets?.release_date + "T00:00:00Z").getTime();
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
    }
    if (sortBy === "set_name") {
      return sortDirection === "asc"
        ? a.sets?.name.localeCompare(b.sets?.name)
        : b.sets?.name.localeCompare(a.sets?.name);
    }
    const valA = a.usd_price ?? 0;
    const valB = b.usd_price ?? 0;
    return sortDirection === "asc" ? valA - valB : valB - valA;
  });

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans space-y-10">
      <div className="flex flex-wrap items-center gap-4 mb-6">

        <input
          type="text"
          placeholder="Search by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1 rounded border text-sm text-slate-700 bg-white"
        />

        <p className="font-semibold text-slate-800">Sort by product type:</p>
        {PRODUCT_PRIORITY.map((type) => (
          <button
            key={type}
            onClick={() => toggleSort(type)}
            className={`px-4 py-1 rounded border text-sm font-medium transition-all ${
              sortProductType === type ? "bg-blue-600 text-white" : "bg-white text-slate-700"
            }`}
          >
            {type.toUpperCase()} {sortProductType === type ? (sortDirection === "asc" ? "↑" : "↓") : ""}
          </button>
        ))}

        {viewMode === "flat" && (
          <>
            <p className="ml-6 font-semibold text-slate-800">Sort sets by:</p>
            <button
              onClick={() => toggleSortBy("release_date")}
              className={`px-4 py-1 rounded border text-sm font-medium ${
                sortBy === "release_date" ? "bg-blue-600 text-white" : "bg-white text-slate-700"
              }`}
            >
              Release Date {sortBy === "release_date" && (sortDirection === "asc" ? "↑" : "↓")}
            </button>
            <button
              onClick={() => toggleSortBy("set_name")}
              className={`px-4 py-1 rounded border text-sm font-medium ${
                sortBy === "set_name" ? "bg-blue-600 text-white" : "bg-white text-slate-700"
              }`}
            >
              Set Name {sortBy === "set_name" && (sortDirection === "asc" ? "↑" : "↓")}
            </button>
          </>
        )}

        <button
          onClick={() => setViewMode(viewMode === "grouped" ? "flat" : "grouped")}
          className="ml-auto px-4 py-1 rounded bg-slate-800 text-white text-sm font-medium"
        >
          Toggle View ({viewMode})
        </button>
      </div>

      {loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}

      {!loading && viewMode === "grouped" &&
        Object.entries(groupedProducts)
          .sort(([, a], [, b]) => {
            const dateA = new Date(a[0].sets?.release_date + "T00:00:00Z").getTime();
            const dateB = new Date(b[0].sets?.release_date + "T00:00:00Z").getTime();
            return dateB - dateA;
          })
          .map(([groupKey, items]) => {
            const [setName, setCode] = groupKey.includes("||") ? groupKey.split("||") : [groupKey, null];
            const sortedItems = [...items].sort((a, b) =>
              PRODUCT_PRIORITY.indexOf(a.product_types?.name) - PRODUCT_PRIORITY.indexOf(b.product_types?.name)
            );

            return (
              <div key={groupKey}>
                <h2 className="text-2xl font-bold text-slate-800 mb-4 border-b border-slate-300 pb-1">
                  {setName} {setCode && <span className="text-slate-500 text-base">({setCode})</span>}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {PRODUCT_PRIORITY.map((type) => {
                    const product = sortedItems.find(p => p.product_types?.name === type);
                    return product ? (
                      <div
                        key={product.id}
                        className="rounded-xl border border-slate-300 bg-white p-5 shadow hover:shadow-lg transition-shadow"
                      >
                        <div>
                          <p className="text-sm text-slate-600 mb-1">
                            <span className="font-medium text-slate-700">Type:</span> {product.product_types?.label || product.product_types?.name}
                          </p>
                          <p className="text-sm text-slate-600 mb-1">
                            <span className="font-medium text-slate-700">Generation:</span> {product.sets?.generations?.name || "Unknown"}
                          </p>
                          <p className="text-sm text-slate-600 mb-2">
                            <span className="font-medium text-slate-700">Release Date:</span>{" "}
                            {product.sets?.release_date
                              ? new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString()
                              : "Unknown"}
                          </p>
                          <p className="text-3xl font-extrabold text-green-600 tracking-tight mb-1">
                            ${product.usd_price?.toFixed(2) || "N/A"} USD
                          </p>
                          {/* 1D Return */}
                          {(() => {
                            const history = priceHistory[product.id] || [];
                            const ret = get1DReturn(history);
                            return (
                              <span className={`font-semibold text-sm block mb-1 ${ret?.percent > 0 ? "text-green-600" : ret?.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                                1D: {ret
                                  ? `${ret.percent > 0 ? "+" : ""}${ret.percent.toFixed(2)}%`
                                  : "—"}
                              </span>
                            );
                          })()}
                          <p className="text-md font-medium text-indigo-700 mb-3">
                            ~${(product.usd_price * USD_TO_CAD).toFixed(2)} CAD
                          </p>
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
                    ) : (
                      <div key={type} className="h-0" />
                    );
                  })}
                </div>
              </div>
            );
          })}

      {!loading && viewMode === "flat" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {sortedFlatProducts.map(product => (
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
                {product.sets?.release_date
                  ? new Date(product.sets.release_date + "T00:00:00Z").toLocaleDateString()
                  : "Unknown"}
              </p>
              <p className="text-2xl font-extrabold text-green-600 tracking-tight mb-1">
                ${product.usd_price?.toFixed(2) || "N/A"} USD
              </p>
              {/* 1D Return */}
              {(() => {
                const history = priceHistory[product.id] || [];
                const ret = get1DReturn(history);
                return (
                  <span className={`font-semibold text-sm block mb-1 ${ret?.percent > 0 ? "text-green-600" : ret?.percent < 0 ? "text-red-600" : "text-slate-500"}`}>
                    1D: {ret
                      ? `${ret.percent > 0 ? "+" : ""}${ret.percent.toFixed(2)}%`
                      : "—"}
                  </span>
                );
              })()}
              <p className="text-md font-medium text-indigo-700 mb-2">
                ~${(product.usd_price * USD_TO_CAD).toFixed(2)} CAD
              </p>
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
