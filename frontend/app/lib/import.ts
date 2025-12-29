import { supabase } from "./supabase";
import type {
  CollectrCSVRow,
  ImportMatchResult,
  ProductSearchResult,
  NewHolding,
} from "../components/Portfolio/types";
import { addHolding } from "./portfolio";

// Product types we support for import
const SUPPORTED_PRODUCT_TYPES = [
  "booster_box",
  "booster_bundle",
  "elite_trainer_box",
];

// Keywords to identify product types from Collectr product names
const PRODUCT_TYPE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /\bBooster Box\b/i, type: "booster_box" },
  { pattern: /\bEnhanced Booster Box\b/i, type: "booster_box" },
  { pattern: /\bBooster Bundle\b/i, type: "booster_bundle" },
  { pattern: /\bElite Trainer Box\b/i, type: "elite_trainer_box" },
  { pattern: /\bETB\b/i, type: "elite_trainer_box" },
];

/**
 * Parse a Collectr CSV file content into structured rows
 */
export function parseCollectrCSV(csvContent: string): CollectrCSVRow[] {
  const lines = csvContent.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];

  // Skip header row
  const dataLines = lines.slice(1);
  const rows: CollectrCSVRow[] = [];

  for (const line of dataLines) {
    const values = parseCSVLine(line);
    if (values.length < 16) continue;

    const row: CollectrCSVRow = {
      portfolioName: values[0] || "",
      category: values[1] || "",
      set: values[2] || "",
      productName: values[3] || "",
      cardNumber: values[4] || "",
      rarity: values[5] || "",
      variance: values[6] || "",
      grade: values[7] || "",
      cardCondition: values[8] || "",
      averageCostPaid: parseFloat(values[9]) || 0,
      quantity: parseInt(values[10]) || 0,
      marketPrice: parseFloat(values[11]) || 0,
      priceOverride: parseFloat(values[12]) || 0,
      watchlist: values[13]?.toLowerCase() === "true",
      dateAdded: values[14] || "",
      notes: values[15] || "",
    };

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

/**
 * Detect product type from Collectr product name
 */
function detectProductType(productName: string): string | null {
  for (const { pattern, type } of PRODUCT_TYPE_PATTERNS) {
    if (pattern.test(productName)) {
      return type;
    }
  }
  return null;
}

/**
 * Check if a product type is supported for import
 */
function isProductTypeSupported(productName: string): boolean {
  const detectedType = detectProductType(productName);
  return detectedType !== null && SUPPORTED_PRODUCT_TYPES.includes(detectedType);
}

/**
 * Normalize set name for matching (handle variations)
 */
function normalizeSetName(setName: string): string {
  return setName
    .toLowerCase()
    .replace(/[:\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^sv\s*/, "") // Remove "SV: " prefix
    .trim();
}

/**
 * Fetch all products that match supported types
 */
async function fetchSupportedProducts(): Promise<ProductSearchResult[]> {
  const { data, error } = await supabase
    .from("products")
    .select(`
      id, usd_price, image_url, variant,
      sets ( name, code ),
      product_types ( name, label )
    `)
    .in("product_type_id", [1, 2, 3]) // Assuming these are the IDs for supported types
    .order("id", { ascending: true });

  if (error) {
    console.error("Error fetching products for import:", error);

    // Fallback: fetch all and filter client-side
    const { data: allData, error: allError } = await supabase
      .from("products")
      .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
      .order("id", { ascending: true });

    if (allError) {
      console.error("Error fetching all products:", allError);
      return [];
    }

    // Filter to supported product types
    return ((allData || []) as unknown as ProductSearchResult[]).filter((p) => {
      const typeName = p.product_types?.name?.toLowerCase() || "";
      return SUPPORTED_PRODUCT_TYPES.includes(typeName);
    });
  }

  return (data || []) as unknown as ProductSearchResult[];
}

/**
 * Match a Collectr CSV row to a product in the database
 */
function matchProduct(
  csvRow: CollectrCSVRow,
  products: ProductSearchResult[]
): { product: ProductSearchResult | null; confidence: "exact" | "high" | "low" | "none" } {
  // Check if this is a supported product type
  if (!isProductTypeSupported(csvRow.productName)) {
    return { product: null, confidence: "none" };
  }

  const detectedType = detectProductType(csvRow.productName);
  const normalizedSetName = normalizeSetName(csvRow.set);

  // Find products matching the set and type
  const candidates = products.filter((p) => {
    const productSetName = normalizeSetName(p.sets?.name || "");
    const productTypeName = p.product_types?.name?.toLowerCase() || "";

    // Check set name match
    const setMatch =
      productSetName === normalizedSetName ||
      productSetName.includes(normalizedSetName) ||
      normalizedSetName.includes(productSetName);

    // Check type match
    const typeMatch = productTypeName === detectedType;

    return setMatch && typeMatch;
  });

  if (candidates.length === 0) {
    return { product: null, confidence: "none" };
  }

  // If only one candidate, use it
  if (candidates.length === 1) {
    return { product: candidates[0], confidence: "high" };
  }

  // Try to find exact match by variant or more specific matching
  const exactMatch = candidates.find((p) => {
    const productSetName = normalizeSetName(p.sets?.name || "");
    return productSetName === normalizedSetName;
  });

  if (exactMatch) {
    return { product: exactMatch, confidence: "exact" };
  }

  // Check for variant matches (e.g., Pokemon Center exclusive)
  const csvProductLower = csvRow.productName.toLowerCase();
  const variantMatch = candidates.find((p) => {
    const variant = (p.variant || "").toLowerCase();
    if (csvProductLower.includes("pokemon center") && variant.includes("pokemon center")) {
      return true;
    }
    if (csvProductLower.includes("exclusive") && variant.includes("exclusive")) {
      return true;
    }
    return false;
  });

  if (variantMatch) {
    return { product: variantMatch, confidence: "high" };
  }

  // Default to first candidate with low confidence
  return { product: candidates[0], confidence: "low" };
}

/**
 * Process Collectr CSV and match to products
 */
export async function processCollectrImport(
  csvContent: string
): Promise<ImportMatchResult[]> {
  const csvRows = parseCollectrCSV(csvContent);
  const products = await fetchSupportedProducts();
  const results: ImportMatchResult[] = [];

  for (const csvRow of csvRows) {
    // Skip non-Pokemon or non-sealed products
    if (csvRow.category !== "Pokemon" || csvRow.portfolioName !== "Sealed Product") {
      continue;
    }

    const { product, confidence } = matchProduct(csvRow, products);

    results.push({
      csvRow,
      matchedProduct: product,
      matchConfidence: confidence,
      importStatus: "pending",
    });
  }

  return results;
}

/**
 * Import matched holdings into the portfolio
 */
export async function importHoldings(
  portfolioId: number,
  matches: ImportMatchResult[]
): Promise<ImportMatchResult[]> {
  const results: ImportMatchResult[] = [];

  for (const match of matches) {
    // Skip unmatched or already processed
    if (!match.matchedProduct || match.importStatus !== "pending") {
      results.push({
        ...match,
        importStatus: match.matchedProduct ? "skipped" : "skipped",
      });
      continue;
    }

    // Convert Collectr date format (YYYY-MM-DD) to our format
    const purchaseDate = match.csvRow.dateAdded || new Date().toISOString().split("T")[0];

    const newHolding: NewHolding = {
      portfolio_id: portfolioId,
      product_id: match.matchedProduct.id,
      quantity: match.csvRow.quantity,
      purchase_price_usd: match.csvRow.averageCostPaid,
      purchase_date: purchaseDate,
      notes: match.csvRow.notes ? `Imported from Collectr. ${match.csvRow.notes}` : "Imported from Collectr",
    };

    const result = await addHolding(newHolding);

    if (result) {
      results.push({
        ...match,
        importStatus: "imported",
      });
    } else {
      results.push({
        ...match,
        importStatus: "error",
        errorMessage: "Failed to add holding to portfolio",
      });
    }
  }

  return results;
}

/**
 * Calculate import summary from results
 */
export function calculateImportSummary(results: ImportMatchResult[]): {
  total: number;
  matched: number;
  unmatched: number;
  imported: number;
  skipped: number;
  errors: number;
} {
  return {
    total: results.length,
    matched: results.filter((r) => r.matchedProduct !== null).length,
    unmatched: results.filter((r) => r.matchedProduct === null).length,
    imported: results.filter((r) => r.importStatus === "imported").length,
    skipped: results.filter((r) => r.importStatus === "skipped").length,
    errors: results.filter((r) => r.importStatus === "error").length,
  };
}
