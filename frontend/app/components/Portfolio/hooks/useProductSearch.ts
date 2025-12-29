"use client";

import { useState, useEffect, useCallback } from "react";
import { searchProducts, getAllProducts } from "../../../lib/portfolio";
import type { ProductSearchResult } from "../types";

interface UseProductSearchReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  results: ProductSearchResult[];
  allProducts: ProductSearchResult[];
  loading: boolean;
  error: string | null;
}

export function useProductSearch(): UseProductSearchReturn {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [allProducts, setAllProducts] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all products on mount for initial display
  useEffect(() => {
    async function loadAllProducts() {
      const products = await getAllProducts();
      setAllProducts(products);
    }
    loadAllProducts();
  }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const searchResults = await searchProducts(searchQuery);
        setResults(searchResults);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    results,
    allProducts,
    loading,
    error,
  };
}
