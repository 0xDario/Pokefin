"use client";

import { useState, useEffect } from "react";
import { searchProducts } from "../../../lib/portfolio";
import type { ProductSearchResult } from "../types";

interface UseProductSearchReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  results: ProductSearchResult[];
  loading: boolean;
  error: string | null;
}

export function useProductSearch(): UseProductSearchReturn {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    loading,
    error,
  };
}
