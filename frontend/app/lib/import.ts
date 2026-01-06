import { supabase } from "./supabase";
import type {
  CollectrCSVRow,
  ImportMatchResult,
  ProductSearchResult,
  NewHolding,
} from "../components/Portfolio/types";
import { addHolding } from "./portfolio";

type SupportedProductType = {
  key: string;
  label: string;
  patterns: RegExp[];
  tokenGroups: string[][];
  excludeTokens?: string[];
};

const SUPPORTED_PRODUCT_TYPES: SupportedProductType[] = [
  {
    key: "booster_box",
    label: "Booster Boxes",
    patterns: [/\bEnhanced Booster Box(?:es)?\b/i, /\bBooster Box(?:es)?\b/i],
    tokenGroups: [["booster", "box"]],
  },
  {
    key: "booster_bundle",
    label: "Booster Bundles",
    patterns: [/\bBooster Bundle(?:s)?\b/i],
    tokenGroups: [["booster", "bundle"]],
  },
  {
    key: "elite_trainer_box",
    label: "Elite Trainer Boxes",
    patterns: [/\bElite Trainer Box(?:es)?\b/i, /\bETBs?\b/i],
    tokenGroups: [["elite", "trainer", "box"]],
  },
  {
    key: "ultra_premium_collection",
    label: "Ultra Premium Collections",
    patterns: [/\bUltra Premium Collection(?:s)?\b/i],
    tokenGroups: [
      ["ultra", "premium", "collection"],
      ["premium", "collection"],
    ],
  },
  {
    key: "premium_collection",
    label: "Premium Collections",
    patterns: [/\bSuper-Premium Collection(?:s)?\b/i, /\bPremium Collection(?:s)?\b/i],
    tokenGroups: [["premium", "collection"]],
  },
  {
    key: "poster_collection",
    label: "Poster Collections",
    patterns: [/\bPoster Collection(?:s)?\b/i],
    tokenGroups: [["poster", "collection"]],
  },
  {
    key: "tech_sticker_collection",
    label: "Tech Sticker Collections",
    patterns: [/\bTech Sticker Collection(?:s)?\b/i],
    tokenGroups: [["tech", "sticker", "collection"]],
  },
  {
    key: "collection",
    label: "Collections",
    patterns: [/\bCollection(?:s)?\b/i],
    tokenGroups: [["collection"]],
  },
  {
    key: "build_and_battle_box",
    label: "Build & Battle Boxes",
    patterns: [/\bBuild\s*&\s*Battle Box(?:es)?\b/i],
    tokenGroups: [["build", "battle", "box"]],
  },
  {
    key: "three_pack_blister",
    label: "3-Pack Blisters",
    patterns: [/\b3\s*-?\s*Pack Blister(?:s)?\b/i],
    tokenGroups: [
      ["3", "pack", "blister"],
      ["three", "pack", "blister"],
    ],
  },
  {
    key: "blister",
    label: "Blisters",
    patterns: [/\bBlister(?:s)?\b/i],
    tokenGroups: [["blister"]],
  },
  {
    key: "mini_tin",
    label: "Mini Tins",
    patterns: [/\bMini Tin(?:s)?\b/i],
    tokenGroups: [["mini", "tin"]],
  },
  {
    key: "tin",
    label: "Tins",
    patterns: [/\bTin(?:s)?\b/i],
    tokenGroups: [["tin"]],
    excludeTokens: ["mini"],
  },
  {
    key: "booster_pack",
    label: "Booster Packs",
    patterns: [/\bBooster Pack(?:s)?\b/i],
    tokenGroups: [["booster", "pack"]],
  },
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
function detectProductType(productName: string): SupportedProductType | null {
  for (const type of SUPPORTED_PRODUCT_TYPES) {
    if (type.patterns.some((pattern) => pattern.test(productName))) {
      return type;
    }
  }
  return null;
}

/**
 * Check if a product type is supported for import
 */
function isProductTypeSupported(productName: string): boolean {
  return detectProductType(productName) !== null;
}

/**
 * Normalize set name for matching (handle variations)
 */
function normalizeSetName(setName: string): string {
  return setName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[:\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^sv\s*/, "") // Remove "SV: " prefix
    .trim();
}

function normalizeTypeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeTypeText(value).split(" ").filter(Boolean));
}

function matchesTokenGroups(
  tokens: Set<string>,
  tokenGroups: string[][],
  excludeTokens?: string[]
): boolean {
  if (excludeTokens && excludeTokens.some((token) => tokens.has(token))) {
    return false;
  }

  return tokenGroups.some((group) => group.every((token) => tokens.has(token)));
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
      const typeText = p.product_types?.label || p.product_types?.name || "";
      if (!typeText) return false;
      const tokens = tokenize(typeText);
      return SUPPORTED_PRODUCT_TYPES.some((type) =>
        matchesTokenGroups(tokens, type.tokenGroups, type.excludeTokens)
      );
    });
  }

  return ((data || []) as unknown as ProductSearchResult[]).filter((p) => {
    const typeText = p.product_types?.label || p.product_types?.name || "";
    if (!typeText) return false;
    const tokens = tokenize(typeText);
    return SUPPORTED_PRODUCT_TYPES.some((type) =>
      matchesTokenGroups(tokens, type.tokenGroups, type.excludeTokens)
    );
  });
}

/**
 * Match a Collectr CSV row to a product in the database
 */
function matchProduct(
  csvRow: CollectrCSVRow,
  products: ProductSearchResult[]
): {
  product: ProductSearchResult | null;
  confidence: "exact" | "high" | "low" | "none";
  unmatchedReason?: string;
} {
  // Check if this is a supported product type
  if (!isProductTypeSupported(csvRow.productName)) {
    return { product: null, confidence: "none", unmatchedReason: "Unsupported product type" };
  }

  const detectedType = detectProductType(csvRow.productName);
  const normalizedSetName = normalizeSetName(csvRow.set);
  const detectedTokens = detectedType ? detectedType.tokenGroups : [];

  const setMatches = products.filter((p) => {
    const productSetName = normalizeSetName(p.sets?.name || "");
    return (
      productSetName === normalizedSetName ||
      productSetName.includes(normalizedSetName) ||
      normalizedSetName.includes(productSetName)
    );
  });

  if (setMatches.length === 0) {
    return {
      product: null,
      confidence: "none",
      unmatchedReason: "Set not found in database",
    };
  }

  // Find products matching the set and type
  const candidates = setMatches.filter((p) => {
    if (!detectedType) {
      return false;
    }

    const productTypeText = p.product_types?.label || p.product_types?.name || "";
    const typeTokens = tokenize(productTypeText);

    return matchesTokenGroups(typeTokens, detectedTokens, detectedType.excludeTokens);
  });

  if (candidates.length === 0) {
    return {
      product: null,
      confidence: "none",
      unmatchedReason: detectedType
        ? `No matching ${detectedType.label.toLowerCase()} for this set`
        : "Product type not found for set",
    };
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

    const { product, confidence, unmatchedReason } = matchProduct(csvRow, products);

    results.push({
      csvRow,
      matchedProduct: product,
      matchConfidence: confidence,
      importStatus: "pending",
      unmatchedReason,
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
