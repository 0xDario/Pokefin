/**
 * Tests for portfolio library functions
 *
 * These tests cover:
 * - calculatePortfolioSummary with various holding combinations
 * - calculateHoldingPerformance gain/loss calculations
 */

// Mock supabase before importing portfolio module
jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import {
  calculatePortfolioSummary,
  calculateHoldingPerformance,
} from "../portfolio";
import type { HoldingWithProduct } from "../../components/Portfolio/types";

// Helper to create a mock HoldingWithProduct
function createMockHolding(overrides: Partial<{
  id: number;
  product_id: number;
  quantity: number;
  purchase_price_usd: number;
  purchase_date: string;
  current_price: number | null;
  set_name: string;
  product_type: string;
}>): HoldingWithProduct {
  // Handle null explicitly for current_price
  const currentPrice = "current_price" in overrides ? overrides.current_price : 15;

  return {
    id: overrides.id ?? 1,
    portfolio_id: 1,
    product_id: overrides.product_id ?? 100,
    quantity: overrides.quantity ?? 1,
    purchase_price_usd: overrides.purchase_price_usd ?? 10,
    purchase_date: overrides.purchase_date ?? "2024-01-01",
    notes: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    products: {
      id: overrides.product_id ?? 100,
      usd_price: currentPrice,
      image_url: "https://example.com/image.jpg",
      variant: "Booster Box",
      url: "https://example.com/product",
      sets: {
        id: 1,
        name: overrides.set_name ?? "Test Set",
        code: "TST",
        release_date: "2023-01-01",
        expansion_type: "Expansion",
        generations: {
          id: 1,
          name: "Generation 1",
        },
      },
      product_types: {
        id: 1,
        name: "booster_box",
        label: overrides.product_type ?? "Booster Box",
      },
    },
  };
}

describe("portfolio library functions", () => {
  describe("calculatePortfolioSummary", () => {
    it("should return zero values for empty holdings array", () => {
      const result = calculatePortfolioSummary([]);

      expect(result).toEqual({
        total_cost_basis: 0,
        total_current_value: 0,
        total_gain_loss: 0,
        total_gain_loss_percent: 0,
        holdings_count: 0,
        unique_products_count: 0,
      });
    });

    it("should calculate correct summary for a single holding with profit", () => {
      const holding = createMockHolding({
        quantity: 2,
        purchase_price_usd: 100,
        current_price: 150,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(200); // 2 * 100
      expect(result.total_current_value).toBe(300); // 2 * 150
      expect(result.total_gain_loss).toBe(100); // 300 - 200
      expect(result.total_gain_loss_percent).toBe(50); // (100/200) * 100
      expect(result.holdings_count).toBe(1);
      expect(result.unique_products_count).toBe(1);
    });

    it("should calculate correct summary for a single holding with loss", () => {
      const holding = createMockHolding({
        quantity: 3,
        purchase_price_usd: 100,
        current_price: 80,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(300); // 3 * 100
      expect(result.total_current_value).toBe(240); // 3 * 80
      expect(result.total_gain_loss).toBe(-60); // 240 - 300
      expect(result.total_gain_loss_percent).toBe(-20); // (-60/300) * 100
    });

    it("should calculate correct summary for multiple holdings", () => {
      const holdings = [
        createMockHolding({
          id: 1,
          product_id: 100,
          quantity: 2,
          purchase_price_usd: 50,
          current_price: 75,
        }),
        createMockHolding({
          id: 2,
          product_id: 101,
          quantity: 1,
          purchase_price_usd: 200,
          current_price: 180,
        }),
      ];

      const result = calculatePortfolioSummary(holdings);

      // First holding: cost = 100, value = 150, gain = 50
      // Second holding: cost = 200, value = 180, loss = -20
      expect(result.total_cost_basis).toBe(300);
      expect(result.total_current_value).toBe(330);
      expect(result.total_gain_loss).toBe(30);
      expect(result.total_gain_loss_percent).toBe(10); // (30/300) * 100
      expect(result.holdings_count).toBe(2);
      expect(result.unique_products_count).toBe(2);
    });

    it("should count unique products correctly with duplicate product IDs", () => {
      const holdings = [
        createMockHolding({
          id: 1,
          product_id: 100,
          quantity: 2,
          purchase_price_usd: 50,
          current_price: 60,
        }),
        createMockHolding({
          id: 2,
          product_id: 100, // Same product ID
          quantity: 1,
          purchase_price_usd: 55,
          current_price: 60,
        }),
        createMockHolding({
          id: 3,
          product_id: 101, // Different product
          quantity: 1,
          purchase_price_usd: 100,
          current_price: 120,
        }),
      ];

      const result = calculatePortfolioSummary(holdings);

      expect(result.holdings_count).toBe(3);
      expect(result.unique_products_count).toBe(2); // Only 2 unique products
    });

    it("should handle holdings with null current price", () => {
      const holding = createMockHolding({
        quantity: 2,
        purchase_price_usd: 100,
        current_price: null,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(200);
      expect(result.total_current_value).toBe(0); // null price treated as 0
      expect(result.total_gain_loss).toBe(-200);
      expect(result.total_gain_loss_percent).toBe(-100);
    });

    it("should handle zero cost basis (avoid division by zero)", () => {
      const holding = createMockHolding({
        quantity: 1,
        purchase_price_usd: 0,
        current_price: 50,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(0);
      expect(result.total_current_value).toBe(50);
      expect(result.total_gain_loss).toBe(50);
      expect(result.total_gain_loss_percent).toBe(0); // Avoid NaN/Infinity
    });

    it("should handle break-even scenario", () => {
      const holding = createMockHolding({
        quantity: 5,
        purchase_price_usd: 100,
        current_price: 100,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(500);
      expect(result.total_current_value).toBe(500);
      expect(result.total_gain_loss).toBe(0);
      expect(result.total_gain_loss_percent).toBe(0);
    });

    it("should calculate correctly for high quantity holdings", () => {
      const holding = createMockHolding({
        quantity: 1000,
        purchase_price_usd: 10.5,
        current_price: 12.75,
      });

      const result = calculatePortfolioSummary([holding]);

      expect(result.total_cost_basis).toBe(10500);
      expect(result.total_current_value).toBe(12750);
      expect(result.total_gain_loss).toBeCloseTo(2250, 2);
      expect(result.total_gain_loss_percent).toBeCloseTo(21.43, 2);
    });
  });

  describe("calculateHoldingPerformance", () => {
    it("should calculate positive performance correctly", () => {
      const holding = createMockHolding({
        id: 42,
        quantity: 3,
        purchase_price_usd: 100,
        current_price: 150,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.holding_id).toBe(42);
      expect(result.cost_basis).toBe(300); // 3 * 100
      expect(result.current_value).toBe(450); // 3 * 150
      expect(result.gain_loss).toBe(150); // 450 - 300
      expect(result.gain_loss_percent).toBe(50); // (150/300) * 100
      expect(result.purchase_price).toBe(100);
      expect(result.current_price).toBe(150);
    });

    it("should calculate negative performance correctly", () => {
      const holding = createMockHolding({
        id: 7,
        quantity: 2,
        purchase_price_usd: 200,
        current_price: 150,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.holding_id).toBe(7);
      expect(result.cost_basis).toBe(400);
      expect(result.current_value).toBe(300);
      expect(result.gain_loss).toBe(-100);
      expect(result.gain_loss_percent).toBe(-25);
      expect(result.purchase_price).toBe(200);
      expect(result.current_price).toBe(150);
    });

    it("should handle break-even performance", () => {
      const holding = createMockHolding({
        quantity: 5,
        purchase_price_usd: 50,
        current_price: 50,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.cost_basis).toBe(250);
      expect(result.current_value).toBe(250);
      expect(result.gain_loss).toBe(0);
      expect(result.gain_loss_percent).toBe(0);
    });

    it("should handle null current price as zero", () => {
      const holding = createMockHolding({
        quantity: 2,
        purchase_price_usd: 100,
        current_price: null,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.cost_basis).toBe(200);
      expect(result.current_value).toBe(0);
      expect(result.gain_loss).toBe(-200);
      expect(result.gain_loss_percent).toBe(-100);
      expect(result.current_price).toBe(0);
    });

    it("should handle zero purchase price (avoid division by zero)", () => {
      const holding = createMockHolding({
        quantity: 1,
        purchase_price_usd: 0,
        current_price: 100,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.cost_basis).toBe(0);
      expect(result.current_value).toBe(100);
      expect(result.gain_loss).toBe(100);
      expect(result.gain_loss_percent).toBe(0); // Avoid NaN/Infinity
    });

    it("should handle single quantity holding", () => {
      const holding = createMockHolding({
        quantity: 1,
        purchase_price_usd: 75,
        current_price: 90,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.cost_basis).toBe(75);
      expect(result.current_value).toBe(90);
      expect(result.gain_loss).toBe(15);
      expect(result.gain_loss_percent).toBe(20);
    });

    it("should handle decimal prices correctly", () => {
      const holding = createMockHolding({
        quantity: 4,
        purchase_price_usd: 25.5,
        current_price: 30.25,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.cost_basis).toBe(102); // 4 * 25.5
      expect(result.current_value).toBe(121); // 4 * 30.25
      expect(result.gain_loss).toBeCloseTo(19, 2);
      expect(result.gain_loss_percent).toBeCloseTo(18.63, 2);
    });

    it("should handle large percentage gains", () => {
      const holding = createMockHolding({
        quantity: 1,
        purchase_price_usd: 10,
        current_price: 100,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.gain_loss).toBe(90);
      expect(result.gain_loss_percent).toBe(900); // 10x increase
    });

    it("should handle large percentage losses", () => {
      const holding = createMockHolding({
        quantity: 1,
        purchase_price_usd: 100,
        current_price: 5,
      });

      const result = calculateHoldingPerformance(holding);

      expect(result.gain_loss).toBe(-95);
      expect(result.gain_loss_percent).toBe(-95);
    });
  });
});
