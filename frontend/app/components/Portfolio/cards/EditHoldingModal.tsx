"use client";

import { useState, useEffect } from "react";
import { updateHolding } from "../../../lib/portfolio";
import { useAuth } from "../../../context/AuthContext";
import type { HoldingWithProduct, UpdateHolding } from "../types";
import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  PRICE_MAX,
  PRICE_MIN,
  clampNotes,
  isValidPastDate,
  isValidPrice,
  isValidQuantity,
} from "../../../lib/validation";

interface EditHoldingModalProps {
  holding: HoldingWithProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditHoldingModal({
  holding,
  isOpen,
  onClose,
  onSuccess,
}: EditHoldingModalProps) {
  const { user } = useAuth();
  const [quantity, setQuantity] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when holding changes
  useEffect(() => {
    if (holding && isOpen) {
      setQuantity(holding.quantity.toString());
      setPurchasePrice(holding.purchase_price_usd.toFixed(2));
      setPurchaseDate(holding.purchase_date);
      setNotes(holding.notes || "");
      setError(null);
    }
  }, [holding, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holding || !user) return;

    setError(null);

    const qty = parseInt(quantity, 10);
    if (!isValidQuantity(qty)) {
      setError(`Quantity must be a whole number between ${QUANTITY_MIN} and ${QUANTITY_MAX}`);
      return;
    }

    const price = parseFloat(purchasePrice);
    if (!isValidPrice(price)) {
      setError(`Purchase price must be between ${PRICE_MIN} and ${PRICE_MAX.toLocaleString()}`);
      return;
    }

    if (!isValidPastDate(purchaseDate)) {
      setError("Please select a valid date that is not in the future");
      return;
    }

    setLoading(true);

    const updates: UpdateHolding = {
      quantity: qty,
      purchase_price_usd: price,
      purchase_date: purchaseDate,
      notes: clampNotes(notes),
    };

    const result = await updateHolding(holding.id, user.id, updates);

    if (result) {
      onSuccess();
      onClose();
    } else {
      setError("Failed to update holding. Please try again.");
    }

    setLoading(false);
  };

  if (!isOpen || !holding) return null;

  const product = holding.products;
  const setName = product?.sets?.name || "Unknown Set";
  const productType = product?.product_types?.label || product?.product_types?.name || "";
  const variant = product?.variant ? ` (${product.variant})` : "";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">
              Edit Holding
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Product Display (read-only) */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              {product?.image_url ? (
                <img
                  src={product.image_url}
                  alt=""
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-12 h-12 bg-slate-200 rounded"></div>
              )}
              <div>
                <p className="font-medium text-slate-900">
                  {setName}
                </p>
                <p className="text-sm text-slate-500">
                  {productType}{variant}
                </p>
              </div>
            </div>

            {/* Quantity and Price Row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Purchase Price (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full pl-7 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* Purchase Date */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Purchase Date
              </label>
              <input
                type="date"
                value={purchaseDate}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900 resize-none"
                placeholder="e.g., Purchased from local game store"
              ></textarea>
            </div>

            {/* Error */}
            {error && (
              <div className="text-rose-600 text-sm">
                {error}
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
