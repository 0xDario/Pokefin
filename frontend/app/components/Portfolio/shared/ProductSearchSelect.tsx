"use client";

import { useState, useRef, useEffect } from "react";
import { useProductSearch } from "../hooks";
import type { ProductSearchResult } from "../types";

interface ProductSearchSelectProps {
  onSelect: (product: ProductSearchResult | null) => void;
  selectedProduct: ProductSearchResult | null;
  placeholder?: string;
}

export default function ProductSearchSelect({
  onSelect,
  selectedProduct,
  placeholder = "Search for a product...",
}: ProductSearchSelectProps) {
  const { searchQuery, setSearchQuery, results, loading } = useProductSearch();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayProducts = searchQuery.length >= 2 ? results : [];

  const getProductDisplayName = (product: ProductSearchResult) => {
    const setName = product.sets?.name || "Unknown Set";
    const productType = product.product_types?.label || product.product_types?.name || "";
    const variant = product.variant ? ` (${product.variant})` : "";
    return `${setName} - ${productType}${variant}`;
  };

  const handleSelect = (product: ProductSearchResult) => {
    onSelect(product);
    setSearchQuery("");
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Selected product display */}
      {selectedProduct ? (
        <div className="flex items-center gap-3 p-3 border border-slate-300 rounded-lg bg-slate-50">
          {selectedProduct.image_url && (
            <img
              src={selectedProduct.image_url}
              alt=""
              className="w-12 h-12 object-cover rounded"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900 truncate">
              {getProductDisplayName(selectedProduct)}
            </p>
            <p className="text-sm text-slate-500">
              Current: ${selectedProduct.usd_price?.toFixed(2) || "N/A"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-slate-400 hover:text-slate-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          {/* Search input */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
          />

          {/* Dropdown */}
          {isOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-slate-500">
                  <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                </div>
              ) : displayProducts.length === 0 ? (
                <div className="p-4 text-center text-slate-500">
                  {searchQuery.length >= 2
                    ? "No products found"
                    : "Type at least 2 characters to search."}
                </div>
              ) : (
                <ul>
                  {displayProducts.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(product)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-slate-100 text-left"
                      >
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt=""
                            className="w-10 h-10 object-cover rounded flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-slate-200 rounded flex-shrink-0"></div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">
                            {getProductDisplayName(product)}
                          </p>
                          <p className="text-sm text-slate-500">
                            ${product.usd_price?.toFixed(2) || "N/A"}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
