import { Product } from "../types";

function getProductTypeLabel(product: Product): string {
  return product.product_types?.label || product.product_types?.name || "Unknown Type";
}

/**
 * Filter products based on generation, product type, and search term
 *
 * @param products - Array of products to filter
 * @param filters - Filter criteria
 * @returns Filtered array of products
 */
export function filterProducts(
  products: Product[],
  filters: {
    selectedGeneration: string;
    selectedProductType: string;
    searchTerm: string;
  }
): Product[] {
  const { selectedGeneration, selectedProductType, searchTerm } = filters;

  return products.filter((product) => {
    // Generation filter
    const matchesGeneration =
      selectedGeneration === "all" ||
      product.sets?.generations?.name === selectedGeneration;

    // Product type filter
    const productTypeLabel = getProductTypeLabel(product);
    const matchesProductType =
      selectedProductType === "all" || productTypeLabel === selectedProductType;

    // Search filter
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      product.sets?.name?.toLowerCase().includes(searchLower) ||
      product.sets?.code?.toLowerCase().includes(searchLower) ||
      productTypeLabel.toLowerCase().includes(searchLower) ||
      product.product_types?.name?.toLowerCase().includes(searchLower) ||
      product.variant?.toLowerCase().includes(searchLower);

    return matchesGeneration && matchesProductType && matchesSearch;
  });
}

/**
 * Extract available generations from products
 *
 * @param products - Array of products
 * @returns Sorted array of unique generation names
 */
export function getAvailableGenerations(products: Product[]): string[] {
  return [
    ...new Set(
      products.map((p) => p.sets?.generations?.name).filter(Boolean) as string[]
    ),
  ].sort();
}

/**
 * Extract available product types from products
 *
 * @param products - Array of products
 * @returns Sorted array of unique product type labels
 */
export function getAvailableProductTypes(products: Product[]): string[] {
  return [...new Set(products.map(getProductTypeLabel))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * Group products by set name
 *
 * @param products - Array of products
 * @returns Map of set name to products
 */
export function groupProductsBySet(products: Product[]): Map<string, Product[]> {
  const groupMap = new Map<string, Product[]>();

  for (const product of products) {
    const setName = product.sets?.name || "Unknown Set";
    if (!groupMap.has(setName)) {
      groupMap.set(setName, []);
    }
    groupMap.get(setName)!.push(product);
  }

  return groupMap;
}

/**
 * Group products by product type label
 *
 * @param products - Array of products
 * @returns Map of product type to products
 */
export function groupProductsByType(products: Product[]): Map<string, Product[]> {
  const groupMap = new Map<string, Product[]>();

  for (const product of products) {
    const productType = getProductTypeLabel(product);
    if (!groupMap.has(productType)) {
      groupMap.set(productType, []);
    }
    groupMap.get(productType)!.push(product);
  }

  return groupMap;
}
