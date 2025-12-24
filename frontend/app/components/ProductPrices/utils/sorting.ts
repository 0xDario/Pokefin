import { Product, SortBy, SortDirection } from "../types";

/**
 * Determine product sort order within a set based on product type
 *
 * @param product - Product to evaluate
 * @returns Sort order number (lower = higher priority)
 */
export function getProductSortOrder(product: Product): number {
  const productTypeName = (product.product_types?.name || "").toLowerCase();
  const productTypeLabel = (product.product_types?.label || "").toLowerCase();
  const variant = (product.variant || "").toLowerCase();

  // Booster Box - highest priority
  if (
    productTypeName.includes("booster_box") ||
    productTypeLabel.includes("booster box")
  ) {
    return 1;
  }

  // ETB (Elite Trainer Box)
  if (
    productTypeName.includes("elite_trainer_box") ||
    productTypeLabel.includes("elite trainer box")
  ) {
    // Pokemon Center ETB comes first
    if (variant.includes("pokemon center")) {
      return 2;
    }
    // Standard ETB comes second
    return 3;
  }

  // Booster Bundle
  if (
    productTypeName.includes("booster_bundle") ||
    productTypeLabel.includes("booster bundle")
  ) {
    return 4;
  }

  // Booster Pack (includes both regular and sleeved)
  if (
    productTypeName.includes("booster_pack") ||
    productTypeLabel.includes("booster pack")
  ) {
    return 5;
  }

  // Sleeved Booster Pack
  if (
    productTypeName.includes("sleeved_booster") ||
    productTypeLabel.includes("sleeved booster")
  ) {
    return 6;
  }

  // Any other product type goes to the end
  return 999;
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
      const priceA = a.usd_price ?? 0;
      const priceB = b.usd_price ?? 0;
      return sortDirection === "asc" ? priceA - priceB : priceB - priceA;
    }

    return 0;
  });
}
