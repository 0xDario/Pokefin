import { Product, SortBy, SortDirection } from "../types";
import { hasCurrentPrice } from "../../../lib/priceGuard";

function normalize(value?: string | null): string {
  return (value || "").toLowerCase().replace(/[_-]/g, " ");
}

/**
 * Determine product sort order within a set based on product type
 *
 * @param product - Product to evaluate
 * @returns Sort order number (lower = higher priority)
 */
export function getProductSortOrder(product: Product): number {
  const productTypeName = normalize(product.product_types?.name);
  const productTypeLabel = normalize(product.product_types?.label);
  const variant = normalize(product.variant);

  // Booster Box - highest priority
  if (
    productTypeName.includes("booster box") ||
    productTypeLabel.includes("booster box")
  ) {
    return 1;
  }

  // Pokemon Center / PKC exclusive ETB
  if (
    (productTypeName.includes("elite trainer box") ||
      productTypeLabel.includes("elite trainer box")) &&
    (variant.includes("pokemon center") ||
      variant.includes("pkc") ||
      variant.includes("exclusive"))
  ) {
    return 2;
  }

  // Standard ETB (Elite Trainer Box)
  if (
    productTypeName.includes("elite trainer box") ||
    productTypeLabel.includes("elite trainer box")
  ) {
    return 3;
  }

  // Booster Bundle
  if (
    productTypeName.includes("booster bundle") ||
    productTypeLabel.includes("booster bundle")
  ) {
    return 4;
  }

  // Collections
  if (
    productTypeName.includes("collection") ||
    productTypeLabel.includes("collection")
  ) {
    return 5;
  }

  // Box sets
  if (
    productTypeName.includes("box set") ||
    productTypeName.includes("box sets") ||
    productTypeLabel.includes("box set") ||
    productTypeLabel.includes("box sets")
  ) {
    return 6;
  }

  // Booster Pack should be near the end
  if (
    productTypeName.includes("booster pack") ||
    productTypeName.includes("sleeved booster") ||
    productTypeLabel.includes("booster pack") ||
    productTypeLabel.includes("sleeved booster")
  ) {
    return 999;
  }

  // Other products go before booster packs
  return 700;
}

/**
 * Sort products based on sort key and direction
 *
 * @param products - Array of products to sort
 * @param sortKey - Sort by release_date or price
 * @param sortDirection - Sort direction (asc or desc)
 * @returns Sorted array of products
 */
export function sortProducts(
  products: Product[],
  sortKey: SortBy,
  sortDirection: SortDirection
): Product[] {
  return [...products].sort((a, b) => {
    // Primary sort by the selected sort key
    if (sortKey === "release_date") {
      const dateA = new Date(a.sets?.release_date ?? 0).getTime();
      const dateB = new Date(b.sets?.release_date ?? 0).getTime();

      // Sort by release date
      if (dateA !== dateB) {
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      }

      // If same release date, use product type order as secondary sort
      const orderA = getProductSortOrder(a);
      const orderB = getProductSortOrder(b);
      return orderA - orderB;
    } else if (sortKey === "price") {
      // Unknown prices sort last in either direction, matching HoldingsTable.
      // Coercing them to 0 would file every stale and never-priced product in
      // among the genuinely cheap ones at the top of an ascending sort.
      const hasA = hasCurrentPrice(a);
      const hasB = hasCurrentPrice(b);
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      const priceA = a.usd_price as number;
      const priceB = b.usd_price as number;
      return sortDirection === "asc" ? priceA - priceB : priceB - priceA;
    }

    return 0;
  });
}
