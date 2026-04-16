"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useBoosterPackPrices } from "./hooks/useBoosterBoxPrices";
import { useBoxRecipes } from "./hooks/useBoxRecipes";
import { useCurrencyConversion } from "../ProductPrices/hooks/useCurrencyConversion";
import CurrencySelector from "../ProductPrices/controls/CurrencySelector";
import { PackEntry, BoxRecipe, NavResult } from "./types";

/**
 * Calculate NAV in the user's display currency.
 * Pack prices come from the DB in USD and are converted via `convertPackPrice`.
 * `promoValue` and `retailPrice` are already in the display currency (user typed them).
 */
function calculateNav(
  packs: PackEntry[],
  promoValue: number,
  retailPrice: number,
  getPackPrice: (setId: number) => number | null,
  convertPackPrice: (usd: number) => number
): NavResult | null {
  if (packs.length === 0 || retailPrice <= 0) return null;

  const packBreakdown = packs.map((pack) => {
    const usdPrice = getPackPrice(pack.setId) || 0;
    const perPackPrice = convertPackPrice(usdPrice);
    return {
      setName: pack.setName,
      quantity: pack.quantity,
      perPackPrice,
      totalValue: perPackPrice * pack.quantity,
    };
  });

  const totalPackValue = packBreakdown.reduce((sum, p) => sum + p.totalValue, 0);
  const nav = totalPackValue + promoValue;
  const premiumDiscount = retailPrice - nav;
  const premiumDiscountPercent = nav > 0 ? (premiumDiscount / nav) * 100 : 0;

  let signal: "buy" | "hold" | "avoid";
  if (premiumDiscountPercent <= -10) signal = "buy";
  else if (premiumDiscountPercent <= 5) signal = "hold";
  else signal = "avoid";

  return {
    totalPackValue,
    promoValue,
    nav,
    retailPrice,
    premiumDiscount,
    premiumDiscountPercent,
    signal,
    packBreakdown,
  };
}

export default function BoxCalculator() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const { sets, loading: pricesLoading, getPackPrice } = useBoosterPackPrices();
  const {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    convertPrice,
    formatPrice,
  } = useCurrencyConversion();

  const setNameMap = useMemo(
    () => new Map(sets.map((s) => [s.id, s.name])),
    [sets]
  );

  const {
    savedRecipes,
    recipesLoading,
    loadMyRecipes,
    saveRecipe,
    deleteRecipe,
    loadSharedRecipe,
  } = useBoxRecipes(setNameMap);

  // Recipe state
  const [recipeName, setRecipeName] = useState("My Collection Box");
  const [packs, setPacks] = useState<PackEntry[]>([]);
  const [promoValue, setPromoValue] = useState(0);
  const [retailPrice, setRetailPrice] = useState(0);
  const [currentRecipeId, setCurrentRecipeId] = useState<number | undefined>();
  const [currentShareCode, setCurrentShareCode] = useState<string | null>(null);

  // Add-pack form state
  const [selectedSetId, setSelectedSetId] = useState<number | "">("");
  const [packQuantity, setPackQuantity] = useState(1);

  // UI state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [showSavedRecipes, setShowSavedRecipes] = useState(false);

  // Load user's saved recipes on mount
  useEffect(() => {
    if (user) loadMyRecipes();
  }, [user, loadMyRecipes]);

  // Load shared recipe from URL param
  useEffect(() => {
    const shareCode = searchParams.get("recipe");
    if (shareCode && sets.length > 0) {
      loadSharedRecipe(shareCode).then((recipe) => {
        if (recipe) loadRecipeIntoState(recipe);
      });
    }
  }, [searchParams, sets]);

  function loadRecipeIntoState(recipe: BoxRecipe) {
    setRecipeName(recipe.name);
    setPacks(recipe.packs);
    setPromoValue(recipe.promoValue);
    setRetailPrice(recipe.retailPrice);
    setCurrentRecipeId(recipe.id);
    setCurrentShareCode(recipe.shareCode || null);
  }

  const handleAddPack = useCallback(() => {
    if (selectedSetId === "" || packQuantity < 1) return;
    const set = sets.find((s) => s.id === selectedSetId);
    if (!set) return;

    // Check if this set is already in the list
    const existing = packs.find((p) => p.setId === selectedSetId);
    if (existing) {
      setPacks((prev) =>
        prev.map((p) =>
          p.setId === selectedSetId
            ? { ...p, quantity: p.quantity + packQuantity }
            : p
        )
      );
    } else {
      setPacks((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          setId: set.id,
          setName: set.name,
          quantity: packQuantity,
        },
      ]);
    }

    setSelectedSetId("");
    setPackQuantity(1);
  }, [selectedSetId, packQuantity, sets, packs]);

  const handleRemovePack = useCallback((id: string) => {
    setPacks((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleUpdatePackQuantity = useCallback((id: string, quantity: number) => {
    if (quantity < 1) return;
    setPacks((prev) => prev.map((p) => (p.id === id ? { ...p, quantity } : p)));
  }, []);

  const handleSave = async () => {
    if (!user) return;
    setSaveStatus("saving");

    const recipe: BoxRecipe = {
      id: currentRecipeId,
      name: recipeName,
      retailPrice,
      promoValue,
      packs,
      shareCode: currentShareCode,
    };

    const saved = await saveRecipe(recipe);
    if (saved) {
      setCurrentRecipeId(saved.id);
      setCurrentShareCode(saved.shareCode || null);
      setSaveStatus("saved");
    } else {
      setSaveStatus("error");
    }

    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  const handleCopyShareLink = () => {
    if (!currentShareCode) return;
    const url = `${window.location.origin}/box-calculator?recipe=${currentShareCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNewRecipe = () => {
    setRecipeName("My Collection Box");
    setPacks([]);
    setPromoValue(0);
    setRetailPrice(0);
    setCurrentRecipeId(undefined);
    setCurrentShareCode(null);
  };

  const handleDeleteRecipe = async (recipeId: number) => {
    await deleteRecipe(recipeId);
    if (currentRecipeId === recipeId) handleNewRecipe();
  };

  const navResult = useMemo(
    () => calculateNav(packs, promoValue, retailPrice, getPackPrice, convertPrice),
    [packs, promoValue, retailPrice, getPackPrice, convertPrice]
  );

  if (pricesLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  const currencySymbol = selectedCurrency === "CAD" ? "C$" : "$";

  // Format a value that is already in the display currency (no conversion needed)
  const fmtPrice = (value: number) => `${currencySymbol}${value.toFixed(2)}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Currency Selector */}
      <CurrencySelector
        selectedCurrency={selectedCurrency}
        exchangeRate={exchangeRate}
        exchangeRateLoading={exchangeRateLoading}
        onChange={setSelectedCurrency}
      />

      {/* Recipe Name + Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <input
            type="text"
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            className="flex-1 text-lg font-semibold bg-transparent border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 dark:hover:border-gray-600 dark:focus:border-blue-400 outline-none py-1 text-gray-900 dark:text-white transition-colors"
            placeholder="Recipe name..."
          />
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={handleSave}
                disabled={saveStatus === "saving" || packs.length === 0}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
              >
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "saved"
                  ? "Saved!"
                  : saveStatus === "error"
                  ? "Error"
                  : currentRecipeId
                  ? "Update"
                  : "Save"}
              </button>
            )}
            {currentShareCode && (
              <button
                onClick={handleCopyShareLink}
                className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Share Link"}
              </button>
            )}
            <button
              onClick={handleNewRecipe}
              className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
            >
              New
            </button>
          </div>
        </div>

        {/* Saved Recipes Toggle */}
        {user && savedRecipes.length > 0 && (
          <div>
            <button
              onClick={() => setShowSavedRecipes(!showSavedRecipes)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              {showSavedRecipes ? "Hide" : "Show"} saved recipes ({savedRecipes.length})
            </button>
            {showSavedRecipes && (
              <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                {savedRecipes.map((r) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                      currentRecipeId === r.id
                        ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                    onClick={() => loadRecipeIntoState(r)}
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {r.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {r.packs.length} pack type{r.packs.length !== 1 ? "s" : ""} &middot; {formatPrice(r.retailPrice)}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRecipe(r.id!);
                      }}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1"
                      title="Delete recipe"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Booster Packs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Booster Packs
        </h2>

        {/* Add pack form */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <select
            value={selectedSetId}
            onChange={(e) => setSelectedSetId(e.target.value ? Number(e.target.value) : "")}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="">Select a set...</option>
            {sets.map((s) => {
              const price = getPackPrice(s.id);
              return (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {price ? ` — ${formatPrice(price)}/pack` : " — No price"}
                </option>
              );
            })}
          </select>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Qty:</label>
            <input
              type="number"
              min={1}
              max={99}
              value={packQuantity}
              onChange={(e) => setPackQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <button
              onClick={handleAddPack}
              disabled={selectedSetId === ""}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Add Packs
            </button>
          </div>
        </div>

        {/* Pack list */}
        {packs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic py-4 text-center">
            Add booster packs from the dropdown above to build your recipe.
          </p>
        ) : (
          <div className="space-y-2">
            {packs.map((pack) => {
              const packPrice = getPackPrice(pack.setId);
              const totalValue = (packPrice || 0) * pack.quantity;

              return (
                <div
                  key={pack.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {pack.setName}
                    </span>
                    {packPrice ? (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {formatPrice(packPrice)}/pack
                      </span>
                    ) : (
                      <span className="text-xs text-rose-500 ml-2">No price data</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleUpdatePackQuantity(pack.id, pack.quantity - 1)}
                        disabled={pack.quantity <= 1}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-40 text-sm font-bold text-gray-700 dark:text-gray-200 transition-colors"
                      >
                        -
                      </button>
                      <span className="w-8 text-center text-sm font-medium text-gray-900 dark:text-white">
                        {pack.quantity}
                      </span>
                      <button
                        onClick={() => handleUpdatePackQuantity(pack.id, pack.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-sm font-bold text-gray-700 dark:text-gray-200 transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white w-20 text-right">
                      {formatPrice(totalValue)}
                    </span>
                    <button
                      onClick={() => handleRemovePack(pack.id)}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1 transition-colors"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Promo Value + Retail Price */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Promo / Extras Value ({selectedCurrency})
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Estimated value of promos, coins, stickers, etc.
          </p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">{currencySymbol}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={promoValue || ""}
              onChange={(e) => setPromoValue(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0.00"
              className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Retail / Sticker Price ({selectedCurrency})
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            The price you&apos;d pay for this collection box.
          </p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">{currencySymbol}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={retailPrice || ""}
              onChange={(e) => setRetailPrice(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0.00"
              className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* NAV Results */}
      {navResult && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          {/* Signal Banner */}
          <div
            className={`px-5 py-4 ${
              navResult.signal === "buy"
                ? "bg-emerald-50 dark:bg-emerald-900/30 border-b-2 border-emerald-400"
                : navResult.signal === "hold"
                ? "bg-amber-50 dark:bg-amber-900/30 border-b-2 border-amber-400"
                : "bg-rose-50 dark:bg-rose-900/30 border-b-2 border-rose-400"
            }`}
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span
                  className={`text-2xl font-bold ${
                    navResult.signal === "buy"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : navResult.signal === "hold"
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  {navResult.signal === "buy"
                    ? "Good Deal"
                    : navResult.signal === "hold"
                    ? "Fair Price"
                    : "Overpriced"}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                    navResult.signal === "buy"
                      ? "bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200"
                      : navResult.signal === "hold"
                      ? "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200"
                      : "bg-rose-200 text-rose-800 dark:bg-rose-800 dark:text-rose-200"
                  }`}
                >
                  {navResult.premiumDiscount < 0
                    ? `${Math.abs(navResult.premiumDiscountPercent).toFixed(1)}% below NAV`
                    : navResult.premiumDiscount > 0
                    ? `${navResult.premiumDiscountPercent.toFixed(1)}% above NAV`
                    : "At NAV"}
                </span>
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div>
                <span className="block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Pack Value
                </span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {fmtPrice(navResult.totalPackValue)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Promo Value
                </span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {fmtPrice(navResult.promoValue)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  NAV
                </span>
                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  {fmtPrice(navResult.nav)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Retail Price
                </span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {fmtPrice(navResult.retailPrice)}
                </span>
              </div>
            </div>

            {/* Pack breakdown table */}
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Pack-by-Pack Breakdown
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="pb-2 pr-4">Set</th>
                    <th className="pb-2 pr-4 text-right">Per Pack</th>
                    <th className="pb-2 pr-4 text-right">Qty</th>
                    <th className="pb-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {navResult.packBreakdown.map((row, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                        {row.setName}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">
                        {row.perPackPrice > 0 ? fmtPrice(row.perPackPrice) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">
                        {row.quantity}
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-900 dark:text-white">
                        {fmtPrice(row.totalValue)}
                      </td>
                    </tr>
                  ))}
                  {navResult.promoValue > 0 && (
                    <tr>
                      <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                        Promos / Extras
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">—</td>
                      <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">—</td>
                      <td className="py-2 text-right font-semibold text-gray-900 dark:text-white">
                        {fmtPrice(navResult.promoValue)}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 dark:border-gray-600">
                    <td className="pt-3 pr-4 font-semibold text-gray-900 dark:text-white" colSpan={3}>
                      Total NAV
                    </td>
                    <td className="pt-3 text-right font-bold text-blue-600 dark:text-blue-400 text-base">
                      {fmtPrice(navResult.nav)}
                    </td>
                  </tr>
                  <tr>
                    <td className="pt-1 pr-4 font-semibold text-gray-900 dark:text-white" colSpan={3}>
                      Retail Price
                    </td>
                    <td className="pt-1 text-right font-bold text-gray-900 dark:text-white text-base">
                      {fmtPrice(navResult.retailPrice)}
                    </td>
                  </tr>
                  <tr>
                    <td className="pt-1 pr-4 font-semibold text-gray-900 dark:text-white" colSpan={3}>
                      {navResult.premiumDiscount > 0 ? "Premium" : "Discount"}
                    </td>
                    <td
                      className={`pt-1 text-right font-bold text-base ${
                        navResult.premiumDiscount > 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {navResult.premiumDiscount > 0 ? "+" : "-"}
                      {currencySymbol}
                      {Math.abs(navResult.premiumDiscount).toFixed(2)} (
                      {Math.abs(navResult.premiumDiscountPercent).toFixed(1)}%)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      {packs.length === 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            How it works
          </h3>
          <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
            <li>Add the booster packs included in the collection box (pick a set, enter quantity)</li>
            <li>Enter the estimated promo/extras value (coins, promo cards, etc.)</li>
            <li>Enter the retail price of the box</li>
            <li>
              The calculator uses today&apos;s live booster pack market prices per set,
              then sums everything to compute the NAV
            </li>
            <li>Save and share your recipes to revisit them later</li>
          </ol>
        </div>
      )}
    </div>
  );
}
