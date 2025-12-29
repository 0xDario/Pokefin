"use client";

import { calculateHoldingPerformance } from "../../../lib/portfolio";
import type { HoldingWithProduct } from "../types";

interface HoldingCardProps {
  holding: HoldingWithProduct;
  currency?: "USD" | "CAD";
  exchangeRate?: number;
  onEdit: (holding: HoldingWithProduct) => void;
  onDelete: (holdingId: number) => void;
}

export default function HoldingCard({
  holding,
  currency = "USD",
  exchangeRate = 1.36,
  onEdit,
  onDelete,
}: HoldingCardProps) {
  const performance = calculateHoldingPerformance(holding);
  const isPositive = performance.gain_loss >= 0;

  const formatCurrency = (value: number) => {
    const convertedValue = currency === "CAD" ? value * exchangeRate : value;
    const symbol = currency === "CAD" ? "C$" : "$";
    return `${symbol}${convertedValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const product = holding.products;
  const setName = product?.sets?.name || "Unknown Set";
  const productType = product?.product_types?.label || product?.product_types?.name || "";
  const variant = product?.variant ? ` (${product.variant})` : "";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        {/* Product Image */}
        {product?.image_url ? (
          <img
            src={product.image_url}
            alt={`${setName} ${productType}`}
            className="w-16 h-16 md:w-20 md:h-20 object-cover rounded-lg flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 md:w-20 md:h-20 bg-gray-200 dark:bg-gray-600 rounded-lg flex-shrink-0 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">
            {setName}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
            {productType}{variant}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Qty: <span className="font-medium text-gray-900 dark:text-white">{holding.quantity}</span>
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              Avg: <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(holding.purchase_price_usd)}</span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onEdit(holding)}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(holding.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Performance Bar */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Market Value</p>
            <p className="font-semibold text-gray-900 dark:text-white">
              {formatCurrency(performance.current_value)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">Gain/Loss</p>
            <p className={`font-semibold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {isPositive ? "+" : ""}{formatCurrency(performance.gain_loss)}
              <span className="text-xs ml-1">
                ({formatPercent(performance.gain_loss_percent)})
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
