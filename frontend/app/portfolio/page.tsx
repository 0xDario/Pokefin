"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import PortfolioDashboard from "../components/Portfolio/PortfolioDashboard";
import { supabase } from "../lib/supabase";

export default function PortfolioPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Currency state
  const [currency, setCurrency] = useState<"USD" | "CAD">("USD");
  const [exchangeRate, setExchangeRate] = useState(1.36);

  // Fetch exchange rate
  useEffect(() => {
    async function fetchExchangeRate() {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("usd_to_cad")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();

      if (data && !error) {
        setExchangeRate(data.usd_to_cad);
      }
    }
    fetchExchangeRate();
  }, []);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/auth/login?redirect=/portfolio");
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span>Redirecting to login...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumb */}
        <nav className="mb-6">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-700 text-sm flex items-center w-fit"
          >
            <svg
              className="w-4 h-4 mr-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Price Tracker
          </Link>
        </nav>

        {/* Currency Toggle */}
        <div className="flex justify-end mb-4">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
            <button
              onClick={() => setCurrency("USD")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                currency === "USD"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              USD
            </button>
            <button
              onClick={() => setCurrency("CAD")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                currency === "CAD"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              CAD
            </button>
          </div>
        </div>

        {/* Dashboard */}
        <PortfolioDashboard currency={currency} exchangeRate={exchangeRate} />
      </div>
    </div>
  );
}
