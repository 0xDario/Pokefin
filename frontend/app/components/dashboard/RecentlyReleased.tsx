"use client";

import { useMemo } from "react";
import GroupHeader from "../ProductPrices/cards/GroupHeader";
import ProductCard from "../ProductPrices/cards/ProductCard";
import { useProductData } from "../ProductPrices/hooks/useProductData";
import { useCurrencyConversion } from "../ProductPrices/hooks/useCurrencyConversion";
import { groupProductsBySet } from "../ProductPrices/utils/filtering";
import { Product } from "../ProductPrices/types";

interface RecentlyReleasedProps {
  initialProducts: Product[];
  initialExchangeRate: number;
}

export default function RecentlyReleased({
  initialProducts,
  initialExchangeRate,
}: RecentlyReleasedProps) {
  const { priceHistory, loadingProductIds, ensureHistoryLoaded } =
    useProductData({ initialProducts });
  const { selectedCurrency, exchangeRate, formatPrice } = useCurrencyConversion(
    initialExchangeRate,
    "USD"
  );

  const grouped = useMemo(
    () => groupProductsBySet(initialProducts),
    [initialProducts]
  );

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([setName, setProducts]) => (
        <div key={setName}>
          <GroupHeader
            setName={setName}
            setCode={setProducts[0]?.sets?.code || "N/A"}
            generation={setProducts[0]?.sets?.generations?.name || "Unknown"}
            expansionType={setProducts[0]?.sets?.expansion_type}
            releaseDate={setProducts[0]?.sets?.release_date || ""}
          />
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
            {setProducts.map((product) => (
              <div key={product.id} className="w-[260px] flex-shrink-0">
                <ProductCard
                  product={product}
                  viewMode="flat"
                  chartTimeframe="3M"
                  history={priceHistory[product.id]}
                  historyLoading={loadingProductIds.includes(product.id)}
                  selectedCurrency={selectedCurrency}
                  exchangeRate={exchangeRate}
                  formatPrice={formatPrice}
                  onLoadChart={ensureHistoryLoaded}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
