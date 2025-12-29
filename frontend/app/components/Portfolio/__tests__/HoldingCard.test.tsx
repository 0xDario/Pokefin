/**
 * Tests for HoldingCard component
 *
 * These tests cover:
 * - Rendering with different holding data
 * - Currency formatting (USD and CAD)
 * - User interactions (edit and delete buttons)
 * - Performance display (gain/loss)
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import HoldingCard from "../cards/HoldingCard";
import type { HoldingWithProduct } from "../types";

// Mock the portfolio library to control performance calculations
jest.mock("../../../lib/portfolio", () => ({
  calculateHoldingPerformance: jest.fn((holding) => {
    const costBasis = holding.quantity * holding.purchase_price_usd;
    const currentPrice = holding.products?.usd_price ?? 0;
    const currentValue = holding.quantity * currentPrice;
    const gainLoss = currentValue - costBasis;
    const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
    return {
      holding_id: holding.id,
      cost_basis: costBasis,
      current_value: currentValue,
      gain_loss: gainLoss,
      gain_loss_percent: gainLossPercent,
      purchase_price: holding.purchase_price_usd,
      current_price: currentPrice,
    };
  }),
}));

// Helper to create a mock HoldingWithProduct
function createMockHolding(overrides: Partial<{
  id: number;
  quantity: number;
  purchase_price_usd: number;
  current_price: number | null;
  set_name: string;
  product_type: string;
  product_label: string;
  variant: string | null;
  image_url: string | null;
}> = {}): HoldingWithProduct {
  // Handle null explicitly for current_price, variant, and image_url
  const currentPrice = "current_price" in overrides ? overrides.current_price : 75;
  const variant = "variant" in overrides ? overrides.variant : "1st Edition";
  const imageUrl = "image_url" in overrides ? overrides.image_url : "https://example.com/product.jpg";

  return {
    id: overrides.id ?? 1,
    portfolio_id: 1,
    product_id: 100,
    quantity: overrides.quantity ?? 2,
    purchase_price_usd: overrides.purchase_price_usd ?? 50,
    purchase_date: "2024-01-15",
    notes: null,
    created_at: "2024-01-15T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    products: {
      id: 100,
      usd_price: currentPrice,
      image_url: imageUrl,
      variant: variant,
      url: "https://example.com/product",
      sets: {
        id: 1,
        name: overrides.set_name ?? "Scarlet & Violet",
        code: "SV",
        release_date: "2023-03-31",
        expansion_type: "Expansion",
        generations: {
          id: 9,
          name: "Generation IX",
        },
      },
      product_types: {
        id: 1,
        name: "booster_box",
        label: overrides.product_label ?? overrides.product_type ?? "Booster Box",
      },
    },
  };
}

describe("HoldingCard", () => {
  const mockOnEdit = jest.fn();
  const mockOnDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Product information display", () => {
    it("should render the set name", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ set_name: "151" })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("151")).toBeInTheDocument();
    });

    it("should render the product type with variant", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            product_type: "ETB",
            variant: "Pokemon Center",
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("ETB (Pokemon Center)")).toBeInTheDocument();
    });

    it("should render product type without variant when variant is null", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            product_type: "Booster Box",
            variant: null,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Booster Box")).toBeInTheDocument();
    });

    it("should display the product image when available", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            image_url: "https://example.com/card.jpg",
            set_name: "Test Set",
            product_type: "Booster Box",
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/card.jpg");
      expect(img).toHaveAttribute("alt", "Test Set Booster Box");
    });

    it("should display placeholder when image is null", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ image_url: null })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Should not have an img element
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });

  describe("Holding details display", () => {
    it("should display the quantity", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ quantity: 5 })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Qty:")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("should display the average purchase price in USD", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ purchase_price_usd: 125.5 })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Avg:")).toBeInTheDocument();
      expect(screen.getByText("$125.50")).toBeInTheDocument();
    });

    it("should display the average purchase price in CAD", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ purchase_price_usd: 100 })}
          currency="CAD"
          exchangeRate={1.36}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("C$136.00")).toBeInTheDocument();
    });
  });

  describe("Performance display", () => {
    it("should display market value", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 2,
            current_price: 150,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Market Value")).toBeInTheDocument();
      // 2 * 150 = 300
      expect(screen.getByText("$300.00")).toBeInTheDocument();
    });

    it("should display positive gain/loss with green styling", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 2,
            purchase_price_usd: 50,
            current_price: 100,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Gain/Loss")).toBeInTheDocument();
      // Cost: 100, Value: 200, Gain: 100
      const gainElement = screen.getByText("+$100.00");
      expect(gainElement).toHaveClass("text-green-600");
    });

    it("should display negative gain/loss with red styling", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 2,
            purchase_price_usd: 100,
            current_price: 50,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Cost: 200, Value: 100, Loss: -100
      // toLocaleString formats as $-100.00
      const lossElement = screen.getByText("$-100.00");
      expect(lossElement).toHaveClass("text-red-600");
    });

    it("should display gain/loss percentage", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 1,
            purchase_price_usd: 100,
            current_price: 150,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // 50% gain
      expect(screen.getByText("(+50.00%)")).toBeInTheDocument();
    });
  });

  describe("User interactions", () => {
    it("should call onEdit with holding when edit button is clicked", () => {
      const holding = createMockHolding({ id: 42 });
      render(
        <HoldingCard
          holding={holding}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledTimes(1);
      expect(mockOnEdit).toHaveBeenCalledWith(holding);
    });

    it("should call onDelete with holding ID when delete button is clicked", () => {
      render(
        <HoldingCard
          holding={createMockHolding({ id: 99 })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledTimes(1);
      expect(mockOnDelete).toHaveBeenCalledWith(99);
    });

    it("should not call onEdit when delete button is clicked", () => {
      render(
        <HoldingCard
          holding={createMockHolding()}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);

      expect(mockOnEdit).not.toHaveBeenCalled();
      expect(mockOnDelete).toHaveBeenCalledTimes(1);
    });

    it("should not call onDelete when edit button is clicked", () => {
      render(
        <HoldingCard
          holding={createMockHolding()}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);

      expect(mockOnDelete).not.toHaveBeenCalled();
      expect(mockOnEdit).toHaveBeenCalledTimes(1);
    });
  });

  describe("Currency conversion", () => {
    it("should convert market value to CAD", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 1,
            current_price: 100,
          })}
          currency="CAD"
          exchangeRate={1.36}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // 100 * 1.36 = 136
      expect(screen.getByText("C$136.00")).toBeInTheDocument();
    });

    it("should use default exchange rate when not specified for CAD", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 1,
            current_price: 100,
          })}
          currency="CAD"
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Default rate is 1.36, so 100 * 1.36 = 136
      expect(screen.getByText("C$136.00")).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("should handle null current price (worthless)", () => {
      render(
        <HoldingCard
          holding={createMockHolding({
            quantity: 2,
            purchase_price_usd: 100,
            current_price: null,
          })}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Market value should be 0
      expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
      // Loss should be full cost basis (formatted as $-200.00)
      expect(screen.getByText("$-200.00")).toBeInTheDocument();
    });

    it("should handle missing set name gracefully", () => {
      const holding = createMockHolding({
        id: 1,
        quantity: 1,
        purchase_price_usd: 50,
        current_price: 75,
      });
      // Set the sets to null
      holding.products.sets = null;

      render(
        <HoldingCard
          holding={holding}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Unknown Set")).toBeInTheDocument();
    });

    it("should handle missing product type", () => {
      const holding = createMockHolding({
        id: 1,
        quantity: 1,
        purchase_price_usd: 50,
        current_price: 75,
      });
      holding.products.product_types = null;

      render(
        <HoldingCard
          holding={holding}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Should still render without crashing
      expect(screen.getByText("Qty:")).toBeInTheDocument();
    });
  });
});
