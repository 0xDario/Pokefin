"use client";

import { useState, useRef } from "react";
import {
  processCollectrImport,
  importHoldings,
  calculateImportSummary,
} from "../../../lib/import";
import type { ImportMatchResult } from "../types";

interface ImportHoldingsModalProps {
  portfolioId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "complete";

export default function ImportHoldingsModal({
  portfolioId,
  isOpen,
  onClose,
  onSuccess,
}: ImportHoldingsModalProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [csvContent, setCsvContent] = useState("");
  const [matchResults, setMatchResults] = useState<ImportMatchResult[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    setCsvContent(content);
    await processCSV(content);
  };

  const handlePasteContent = async () => {
    if (!csvContent.trim()) {
      setError("Please paste CSV content first");
      return;
    }
    await processCSV(csvContent);
  };

  const processCSV = async (content: string) => {
    setLoading(true);
    setError(null);

    try {
      const results = await processCollectrImport(content);

      if (results.length === 0) {
        setError("No valid products found in CSV. Make sure it's a Collectr export with Pokemon sealed products.");
        setLoading(false);
        return;
      }

      setMatchResults(results);

      // Pre-select all matched items with high or exact confidence
      const preselected = new Set<number>();
      results.forEach((r, idx) => {
        if (r.matchedProduct && (r.matchConfidence === "exact" || r.matchConfidence === "high")) {
          preselected.add(idx);
        }
      });
      setSelectedMatches(preselected);

      setStep("preview");
    } catch (err) {
      setError("Failed to parse CSV file. Please check the format.");
      console.error("CSV parse error:", err);
    }

    setLoading(false);
  };

  const toggleMatch = (index: number) => {
    const newSelected = new Set(selectedMatches);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedMatches(newSelected);
  };

  const selectAll = () => {
    const newSelected = new Set<number>();
    matchResults.forEach((r, idx) => {
      if (r.matchedProduct) {
        newSelected.add(idx);
      }
    });
    setSelectedMatches(newSelected);
  };

  const deselectAll = () => {
    setSelectedMatches(new Set());
  };

  const handleImport = async () => {
    const toImport = matchResults.filter((_, idx) => selectedMatches.has(idx));

    if (toImport.length === 0) {
      setError("Please select at least one item to import");
      return;
    }

    setStep("importing");
    setLoading(true);

    try {
      const results = await importHoldings(portfolioId, toImport);
      setMatchResults(
        matchResults.map((r, idx) =>
          selectedMatches.has(idx) ? results.find((res) => res.csvRow === r.csvRow) || r : r
        )
      );
      setStep("complete");
    } catch (err) {
      setError("Import failed. Please try again.");
      console.error("Import error:", err);
      setStep("preview");
    }

    setLoading(false);
  };

  const handleClose = () => {
    setCsvContent("");
    setMatchResults([]);
    setSelectedMatches(new Set());
    setStep("upload");
    setError(null);
    onClose();
  };

  const handleComplete = () => {
    onSuccess();
    handleClose();
  };

  const summary = calculateImportSummary(matchResults);
  const matchedResults = matchResults.filter((r) => r.matchedProduct);
  const unmatchedResults = matchResults.filter((r) => !r.matchedProduct);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      ></div>

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">
              Import from Collectr
            </h2>
            <button
              onClick={handleClose}
              className="text-slate-400 hover:text-slate-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Step: Upload */}
            {step === "upload" && (
              <div className="space-y-6">
                <p className="text-slate-600">
                  Import your sealed Pokemon TCG collection from Collectr. Export your collection as CSV from Collectr, then upload it here.
                </p>

                <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3">
                  <p className="font-medium text-slate-700 mb-1">Supported product types:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Booster Boxes</li>
                    <li>Booster Bundles</li>
                    <li>Elite Trainer Boxes</li>
                    <li>Booster Packs</li>
                    <li>Blisters (including 3-pack)</li>
                    <li>Tins (mini and standard)</li>
                    <li>Collections (premium, poster, tech sticker, build &amp; battle)</li>
                  </ul>
                  <p className="mt-2 text-xs">Other product types will be skipped during import.</p>
                </div>

                {/* File Upload */}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-slate-300 rounded-lg hover:border-blue-500 transition-colors"
                  >
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-slate-600">
                      {loading ? "Processing..." : "Click to upload CSV file"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-slate-200"></div>
                  <span className="text-sm text-slate-500">or paste CSV content</span>
                  <div className="flex-1 h-px bg-slate-200"></div>
                </div>

                {/* Paste Content */}
                <div>
                  <textarea
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    placeholder="Paste your Collectr CSV content here..."
                    rows={6}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900 resize-none font-mono text-sm"
                  />
                  <button
                    onClick={handlePasteContent}
                    disabled={loading || !csvContent.trim()}
                    className="mt-2 px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loading ? "Processing..." : "Process CSV"}
                  </button>
                </div>

                {error && (
                  <div className="text-rose-600 text-sm bg-rose-50 p-3 rounded-lg">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Step: Preview */}
            {step === "preview" && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-emerald-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-emerald-600">
                      {summary.matched}
                    </div>
                    <div className="text-sm text-emerald-600">Matched</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-slate-600">
                      {summary.unmatched}
                    </div>
                    <div className="text-sm text-slate-600">Unmatched</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-[var(--pf-pokeblue)]">
                      {selectedMatches.size}
                    </div>
                    <div className="text-sm text-[var(--pf-pokeblue)]">Selected</div>
                  </div>
                </div>

                {/* Select All / Deselect All */}
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="px-3 py-1 text-sm text-[var(--pf-pokeblue)] hover:bg-blue-50 rounded"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAll}
                    className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded"
                  >
                    Deselect All
                  </button>
                </div>

                {/* Matched Items */}
                {matchedResults.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 mb-2">
                      Matched Products ({matchedResults.length})
                    </h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {matchResults.map((result, idx) => {
                        if (!result.matchedProduct) return null;
                        const isSelected = selectedMatches.has(idx);

                        return (
                          <div
                            key={idx}
                            onClick={() => toggleMatch(idx)}
                            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                              isSelected
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMatch(idx)}
                              className="h-4 w-4 text-[var(--pf-pokeblue)] rounded border-slate-300 focus:ring-[var(--pf-pokeblue)]"
                            />
                            {result.matchedProduct.image_url && (
                              <img
                                src={result.matchedProduct.image_url}
                                alt=""
                                className="w-10 h-10 object-cover rounded"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-slate-900 text-sm truncate">
                                  {result.matchedProduct.sets?.name} - {result.matchedProduct.product_types?.label || result.matchedProduct.product_types?.name}
                                </p>
                                <span
                                  className={`px-1.5 py-0.5 text-xs rounded ${
                                    result.matchConfidence === "exact"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : result.matchConfidence === "high"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {result.matchConfidence}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500">
                                From: {result.csvRow.set} - {result.csvRow.productName}
                              </p>
                              <p className="text-xs text-slate-500">
                                Qty: {result.csvRow.quantity} @ ${result.csvRow.averageCostPaid.toFixed(2)} each
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unmatched Items */}
                {unmatchedResults.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-500 mb-2">
                      Unmatched (will be skipped) ({unmatchedResults.length})
                    </h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {unmatchedResults.map((result, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 text-sm text-slate-500 bg-slate-50 rounded"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <div className="min-w-0">
                            <p className="truncate">
                              {result.csvRow.set} - {result.csvRow.productName} (Qty: {result.csvRow.quantity})
                            </p>
                            <p className="text-xs text-slate-400">
                              Reason: {result.unmatchedReason || "No match found"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-rose-600 text-sm bg-rose-50 p-3 rounded-lg">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Step: Importing */}
            {step === "importing" && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-slate-600">Importing holdings...</p>
              </div>
            )}

            {/* Step: Complete */}
            {step === "complete" && (
              <div className="space-y-6">
                <div className="text-center py-6">
                  <svg className="w-16 h-16 mx-auto text-emerald-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">
                    Import Complete!
                  </h3>
                  <p className="text-slate-600">
                    Successfully imported {summary.imported} holdings to your portfolio.
                  </p>
                </div>

                {/* Final Summary */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-emerald-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-emerald-600">
                      {summary.imported}
                    </div>
                    <div className="text-sm text-emerald-600">Imported</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-slate-600">
                      {summary.skipped}
                    </div>
                    <div className="text-sm text-slate-600">Skipped</div>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-rose-600">
                      {summary.errors}
                    </div>
                    <div className="text-sm text-rose-600">Errors</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
            {step === "upload" && (
              <button
                onClick={handleClose}
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}

            {step === "preview" && (
              <>
                <button
                  onClick={() => setStep("upload")}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedMatches.size === 0}
                  className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Import {selectedMatches.size} Items
                </button>
              </>
            )}

            {step === "complete" && (
              <button
                onClick={handleComplete}
                className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
