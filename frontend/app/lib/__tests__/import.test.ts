// Mock supabase before importing
jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        order: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}));

import { parseCollectrCSV, calculateImportSummary } from "../import";
import type { ImportMatchResult } from "../../components/Portfolio/types";

describe("parseCollectrCSV", () => {
  it("should parse valid Collectr CSV content", () => {
    const csvContent = `Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2025-12-29),Price Override,Watchlist,Date Added,Notes
Sealed Product,Pokemon,Destined Rivals,Destined Rivals Booster Box ,,,Normal,Ungraded,Near Mint,352.0680,10,538.64,0,false,2025-06-08,; ; ; ;
Sealed Product,Pokemon,Destined Rivals,Destined Rivals Elite Trainer Box ,,,Normal,Ungraded,Near Mint,137.8199,5,178.44,0,false,2025-06-08,; `;

    const rows = parseCollectrCSV(csvContent);

    expect(rows).toHaveLength(2);

    expect(rows[0].portfolioName).toBe("Sealed Product");
    expect(rows[0].category).toBe("Pokemon");
    expect(rows[0].set).toBe("Destined Rivals");
    expect(rows[0].productName).toBe("Destined Rivals Booster Box");
    expect(rows[0].averageCostPaid).toBe(352.068);
    expect(rows[0].quantity).toBe(10);
    expect(rows[0].marketPrice).toBe(538.64);
    expect(rows[0].dateAdded).toBe("2025-06-08");

    expect(rows[1].productName).toBe("Destined Rivals Elite Trainer Box");
    expect(rows[1].quantity).toBe(5);
  });

  it("should handle empty CSV content", () => {
    const rows = parseCollectrCSV("");
    expect(rows).toHaveLength(0);
  });

  it("should handle header-only CSV", () => {
    const csvContent = `Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price,Price Override,Watchlist,Date Added,Notes`;
    const rows = parseCollectrCSV(csvContent);
    expect(rows).toHaveLength(0);
  });

  it("should parse CSV with various product types", () => {
    const csvContent = `Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price,Price Override,Watchlist,Date Added,Notes
Sealed Product,Pokemon,Prismatic Evolutions,Prismatic Evolutions Booster Bundle ,,,Normal,Ungraded,Near Mint,75.77,5,79.29,0,false,2025-06-08,
Sealed Product,Pokemon,White Flare,White Flare Elite Trainer Box ,,,Normal,Ungraded,Near Mint,120.50,6,107.00,0,true,2025-07-18,`;

    const rows = parseCollectrCSV(csvContent);

    expect(rows).toHaveLength(2);
    expect(rows[0].productName).toBe("Prismatic Evolutions Booster Bundle");
    expect(rows[1].productName).toBe("White Flare Elite Trainer Box");
    expect(rows[1].watchlist).toBe(true);
  });
});

describe("calculateImportSummary", () => {
  it("should calculate summary correctly", () => {
    const mockResults: ImportMatchResult[] = [
      {
        csvRow: {
          portfolioName: "Sealed Product",
          category: "Pokemon",
          set: "Test Set",
          productName: "Test Booster Box",
          cardNumber: "",
          rarity: "",
          variance: "Normal",
          grade: "Ungraded",
          cardCondition: "Near Mint",
          averageCostPaid: 100,
          quantity: 5,
          marketPrice: 120,
          priceOverride: 0,
          watchlist: false,
          dateAdded: "2025-01-01",
          notes: "",
        },
        matchedProduct: {
          id: 1,
          usd_price: 120,
          image_url: null,
          variant: null,
          sets: { name: "Test Set", code: "TST" },
          product_types: { name: "booster_box", label: "Booster Box" },
        },
        matchConfidence: "high",
        importStatus: "imported",
      },
      {
        csvRow: {
          portfolioName: "Sealed Product",
          category: "Pokemon",
          set: "Test Set 2",
          productName: "Test Collection",
          cardNumber: "",
          rarity: "",
          variance: "Normal",
          grade: "Ungraded",
          cardCondition: "Near Mint",
          averageCostPaid: 50,
          quantity: 2,
          marketPrice: 60,
          priceOverride: 0,
          watchlist: false,
          dateAdded: "2025-01-02",
          notes: "",
        },
        matchedProduct: null,
        matchConfidence: "none",
        importStatus: "skipped",
      },
      {
        csvRow: {
          portfolioName: "Sealed Product",
          category: "Pokemon",
          set: "Test Set 3",
          productName: "Test ETB",
          cardNumber: "",
          rarity: "",
          variance: "Normal",
          grade: "Ungraded",
          cardCondition: "Near Mint",
          averageCostPaid: 80,
          quantity: 3,
          marketPrice: 90,
          priceOverride: 0,
          watchlist: false,
          dateAdded: "2025-01-03",
          notes: "",
        },
        matchedProduct: {
          id: 2,
          usd_price: 90,
          image_url: null,
          variant: null,
          sets: { name: "Test Set 3", code: "TS3" },
          product_types: { name: "elite_trainer_box", label: "Elite Trainer Box" },
        },
        matchConfidence: "exact",
        importStatus: "error",
        errorMessage: "Failed to add",
      },
    ];

    const summary = calculateImportSummary(mockResults);

    expect(summary.total).toBe(3);
    expect(summary.matched).toBe(2);
    expect(summary.unmatched).toBe(1);
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("should handle empty results", () => {
    const summary = calculateImportSummary([]);

    expect(summary.total).toBe(0);
    expect(summary.matched).toBe(0);
    expect(summary.unmatched).toBe(0);
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
  });
});
