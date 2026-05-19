"use client";

import { useState } from "react";
import { usePortfolioData } from "./hooks";
import { useAuth } from "../../context/AuthContext";
import { deleteHolding } from "../../lib/portfolio";
import PortfolioSummaryCard from "./shared/PortfolioSummaryCard";
import PortfolioChart from "./shared/PortfolioChart";
import AllocationChart from "./shared/AllocationChart";
import HoldingsTable from "./cards/HoldingsTable";
import AddHoldingModal from "./cards/AddHoldingModal";
import EditHoldingModal from "./cards/EditHoldingModal";
import ImportHoldingsModal from "./cards/ImportHoldingsModal";
import type { HoldingWithProduct } from "./types";

interface PortfolioDashboardProps {
  currency?: "USD" | "CAD";
  exchangeRate?: number;
}

export default function PortfolioDashboard({
  currency = "USD",
  exchangeRate = 1.36,
}: PortfolioDashboardProps) {
  const { user } = useAuth();
  const {
    portfolio,
    holdings,
    summary,
    history,
    loading,
    error,
    timeframe,
    setTimeframe,
    refresh,
  } = usePortfolioData();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingWithProduct | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  const handleEdit = (holding: HoldingWithProduct) => {
    setEditingHolding(holding);
  };

  const handleDelete = async (holdingId: number) => {
    if (!user) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this holding? This action cannot be undone."
    );

    if (!confirmed) return;

    setDeleteLoading(holdingId);
    const success = await deleteHolding(holdingId, user.id);
    setDeleteLoading(null);

    if (success) {
      await refresh();
    } else {
      alert("Failed to delete holding. Please try again.");
    }
  };

  const handleAddSuccess = async () => {
    await refresh();
  };

  const handleEditSuccess = async () => {
    await refresh();
  };

  const handleImportSuccess = async () => {
    await refresh();
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-500">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto text-rose-400 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-rose-600 mb-4">{error}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white rounded-lg"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {portfolio?.name || "My Portfolio"}
          </h1>
          <p className="text-sm text-slate-500">
            Track your Pokemon TCG sealed product investments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Holding
          </button>
        </div>
      </div>

      {/* Summary + Allocation Row */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-2/3">
          <PortfolioSummaryCard
            summary={summary}
            currency={currency}
            exchangeRate={exchangeRate}
          />
        </div>
        <div className="lg:w-1/3">
          <AllocationChart
            holdings={holdings}
            groupBy="set"
            currency={currency}
            exchangeRate={exchangeRate}
          />
        </div>
      </div>

      {/* Portfolio Chart */}
      <PortfolioChart
        data={history}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        currency={currency}
        exchangeRate={exchangeRate}
      />

      {/* Holdings Table */}
      <HoldingsTable
        holdings={holdings}
        currency={currency}
        exchangeRate={exchangeRate}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* Add Modal */}
      {portfolio && (
        <AddHoldingModal
          portfolioId={portfolio.id}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={handleAddSuccess}
        />
      )}

      {/* Edit Modal */}
      <EditHoldingModal
        holding={editingHolding}
        isOpen={!!editingHolding}
        onClose={() => setEditingHolding(null)}
        onSuccess={handleEditSuccess}
      />

      {/* Import Modal */}
      {portfolio && (
        <ImportHoldingsModal
          portfolioId={portfolio.id}
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
}
