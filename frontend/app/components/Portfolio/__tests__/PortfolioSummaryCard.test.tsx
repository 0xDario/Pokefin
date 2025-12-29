/**
 * Tests for PortfolioSummaryCard component
 *
 * These tests cover:
 * - Rendering with different summary data
 * - Currency formatting (USD and CAD)
 * - Positive/negative gain/loss styling
 * - Holdings and products count display
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import PortfolioSummaryCard from "../shared/PortfolioSummaryCard";
import type { PortfolioSummary } from "../types";

// Helper to create mock summary data
function createMockSummary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    total_cost_basis: 1000,
    total_current_value: 1200,
    total_gain_loss: 200,
    total_gain_loss_percent: 20,
    holdings_count: 5,
    unique_products_count: 3,
    ...overrides,
  };
}

describe("PortfolioSummaryCard", () => {
  describe("Basic rendering", () => {
    it("should render the Portfolio Summary heading", () => {
      render(<PortfolioSummaryCard summary={createMockSummary()} />);

      expect(screen.getByText("Portfolio Summary")).toBeInTheDocument();
    });

    it("should render all summary labels", () => {
      render(<PortfolioSummaryCard summary={createMockSummary()} />);

      expect(screen.getByText("Total Value")).toBeInTheDocument();
      expect(screen.getByText("Cost Basis")).toBeInTheDocument();
      expect(screen.getByText("Unrealized G/L")).toBeInTheDocument();
      expect(screen.getByText("ROI")).toBeInTheDocument();
    });

    it("should display holdings count", () => {
      render(<PortfolioSummaryCard summary={createMockSummary({ holdings_count: 10 })} />);

      expect(screen.getByText("10 holdings")).toBeInTheDocument();
    });

    it("should display unique products count", () => {
      render(<PortfolioSummaryCard summary={createMockSummary({ unique_products_count: 7 })} />);

      expect(screen.getByText("7 unique products")).toBeInTheDocument();
    });

    it("should use singular 'holding' for count of 1", () => {
      render(<PortfolioSummaryCard summary={createMockSummary({ holdings_count: 1 })} />);

      expect(screen.getByText("1 holding")).toBeInTheDocument();
    });

    it("should use singular 'product' for count of 1", () => {
      render(<PortfolioSummaryCard summary={createMockSummary({ unique_products_count: 1 })} />);

      expect(screen.getByText("1 unique product")).toBeInTheDocument();
    });
  });

  describe("USD Currency formatting", () => {
    it("should display total value in USD by default", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_current_value: 1500.5 })}
        />
      );

      expect(screen.getByText("$1,500.50")).toBeInTheDocument();
    });

    it("should display cost basis in USD", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_cost_basis: 999.99 })}
        />
      );

      expect(screen.getByText("$999.99")).toBeInTheDocument();
    });

    it("should format large values with commas", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_current_value: 1234567.89 })}
        />
      );

      expect(screen.getByText("$1,234,567.89")).toBeInTheDocument();
    });
  });

  describe("CAD Currency formatting", () => {
    it("should display values in CAD when currency is CAD", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_current_value: 100 })}
          currency="CAD"
          exchangeRate={1.36}
        />
      );

      // 100 * 1.36 = 136
      expect(screen.getByText("C$136.00")).toBeInTheDocument();
    });

    it("should apply custom exchange rate for CAD", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_cost_basis: 1000 })}
          currency="CAD"
          exchangeRate={1.5}
        />
      );

      // 1000 * 1.5 = 1500
      expect(screen.getByText("C$1,500.00")).toBeInTheDocument();
    });
  });

  describe("Positive gain/loss display", () => {
    it("should display positive gain with + prefix", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_gain_loss: 500,
            total_gain_loss_percent: 25,
          })}
        />
      );

      expect(screen.getByText("+$500.00")).toBeInTheDocument();
    });

    it("should display positive ROI with + prefix", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_gain_loss_percent: 33.33 })}
        />
      );

      expect(screen.getByText("+33.33%")).toBeInTheDocument();
    });

    it("should apply green styling for positive gains", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_gain_loss: 100 })}
        />
      );

      // Find the gain/loss value element - it should have green text class
      const gainLossValue = screen.getByText("+$100.00");
      expect(gainLossValue).toHaveClass("text-green-600");
    });
  });

  describe("Negative gain/loss display", () => {
    it("should display negative loss with negative currency format", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_gain_loss: -300,
            total_gain_loss_percent: -15,
          })}
        />
      );

      // The toLocaleString formats negative as $-300.00 or -$300.00 depending on locale
      // Match the actual output format
      expect(screen.getByText("$-300.00")).toBeInTheDocument();
    });

    it("should display negative ROI", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_gain_loss: -100,
            total_gain_loss_percent: -12.5
          })}
        />
      );

      expect(screen.getByText("-12.50%")).toBeInTheDocument();
    });

    it("should apply red styling for negative losses", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_gain_loss: -100,
            total_gain_loss_percent: -10
          })}
        />
      );

      // Find the gain/loss value element - it should have red text class
      const lossValue = screen.getByText("$-100.00");
      expect(lossValue).toHaveClass("text-red-600");
    });
  });

  describe("Zero/break-even display", () => {
    it("should display zero gain/loss with + prefix (treated as positive)", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_gain_loss: 0,
            total_gain_loss_percent: 0,
          })}
        />
      );

      expect(screen.getByText("+$0.00")).toBeInTheDocument();
      expect(screen.getByText("+0.00%")).toBeInTheDocument();
    });

    it("should apply green styling for zero gain (non-negative)", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_gain_loss: 0 })}
        />
      );

      const zeroGain = screen.getByText("+$0.00");
      expect(zeroGain).toHaveClass("text-green-600");
    });
  });

  describe("Edge cases", () => {
    it("should handle zero values for all fields", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({
            total_cost_basis: 0,
            total_current_value: 0,
            total_gain_loss: 0,
            total_gain_loss_percent: 0,
            holdings_count: 0,
            unique_products_count: 0,
          })}
        />
      );

      expect(screen.getByText("0 holdings")).toBeInTheDocument();
      expect(screen.getByText("0 unique products")).toBeInTheDocument();
    });

    it("should handle very small decimal values", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_current_value: 0.01 })}
        />
      );

      expect(screen.getByText("$0.01")).toBeInTheDocument();
    });

    it("should handle very large percentage gains", () => {
      render(
        <PortfolioSummaryCard
          summary={createMockSummary({ total_gain_loss_percent: 999.99 })}
        />
      );

      expect(screen.getByText("+999.99%")).toBeInTheDocument();
    });
  });
});
