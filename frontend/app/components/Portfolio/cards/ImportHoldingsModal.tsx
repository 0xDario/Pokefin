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
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Import from Collectr
            </h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                <p className="text-gray-600 dark:text-gray-400">
                  Import your sealed Pokemon TCG collection from Collectr. Export your collection as CSV from Collectr, then upload it here.
                </p>

                <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Supported product types:</p>
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
                    className="w-full flex items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                  >
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-gray-600 dark:text-gray-400">
                      {loading ? "Processing..." : "Click to upload CSV file"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
                  <span className="text-sm text-gray-500">or paste CSV content</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
                </div>

                {/* Paste Content */}
                <div>
                  <textarea
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    placeholder="Paste your Collectr CSV content here..."
                    rows={6}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none font-mono text-sm"
                  />
                  <button
                    onClick={handlePasteContent}
                    disabled={loading || !csvContent.trim()}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loading ? "Processing..." : "Process CSV"}
                  </button>
                </div>

                {error && (
                  <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
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
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {summary.matched}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-400">Matched</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                      {summary.unmatched}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Unmatched</div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {selectedMatches.size}
                    </div>
                    <div className="text-sm text-blue-600 dark:text-blue-400">Selected</div>
                  </div>
                </div>

                {/* Select All / Deselect All */}
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAll}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    Deselect All
                  </button>
                </div>

                {/* Matched Items */}
                {matchedResults.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMatch(idx)}
                              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
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
                                <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                  {result.matchedProduct.sets?.name} - {result.matchedProduct.product_types?.label || result.matchedProduct.product_types?.name}
                                </p>
                                <span
                                  className={`px-1.5 py-0.5 text-xs rounded ${
                                    result.matchConfidence === "exact"
                                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                      : result.matchConfidence === "high"
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                  }`}
                                >
                                  {result.matchConfidence}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                From: {result.csvRow.set} - {result.csvRow.productName}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
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
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Unmatched (will be skipped) ({unmatchedResults.length})
                    </h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {unmatchedResults.map((result, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/30 rounded"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <div className="min-w-0">
                            <p className="truncate">
                              {result.csvRow.set} - {result.csvRow.productName} (Qty: {result.csvRow.quantity})
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              Reason: {result.unmatchedReason || "No match found"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Step: Importing */}
            {step === "importing" && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Importing holdings...</p>
              </div>
            )}

            {/* Step: Complete */}
            {step === "complete" && (
              <div className="space-y-6">
                <div className="text-center py-6">
                  <svg className="w-16 h-16 mx-auto text-green-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    Import Complete!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Successfully imported {summary.imported} holdings to your portfolio.
                  </p>
                </div>

                {/* Final Summary */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {summary.imported}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-400">Imported</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                      {summary.skipped}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Skipped</div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {summary.errors}
                    </div>
                    <div className="text-sm text-red-600 dark:text-red-400">Errors</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
            {step === "upload" && (
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}

            {step === "preview" && (
              <>
                <button
                  onClick={() => setStep("upload")}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedMatches.size === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Import {selectedMatches.size} Items
                </button>
              </>
            )}

            {step === "complete" && (
              <button
                onClick={handleComplete}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
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
