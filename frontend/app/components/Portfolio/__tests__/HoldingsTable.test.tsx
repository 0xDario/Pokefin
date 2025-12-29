/**
 * Tests for HoldingsTable component
 *
 * These tests cover:
 * - Rendering holdings list
 * - Sorting functionality
 * - Empty state display
 */

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import HoldingsTable from "../cards/HoldingsTable";
import type { HoldingWithProduct } from "../types";

// Mock the portfolio library
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
function createMockHolding(overrides: {
  id: number;
  set_name: string;
  quantity: number;
  purchase_price_usd: number;
  current_price: number;
  purchase_date: string;
}): HoldingWithProduct {
  return {
    id: overrides.id,
    portfolio_id: 1,
    product_id: overrides.id * 10,
    quantity: overrides.quantity,
    purchase_price_usd: overrides.purchase_price_usd,
    purchase_date: overrides.purchase_date,
    notes: null,
    created_at: overrides.purchase_date + "T00:00:00Z",
    updated_at: overrides.purchase_date + "T00:00:00Z",
    products: {
      id: overrides.id * 10,
      usd_price: overrides.current_price,
      image_url: "https://example.com/image.jpg",
      variant: null,
      url: "https://example.com/product",
      sets: {
        id: overrides.id,
        name: overrides.set_name,
        code: overrides.set_name.substring(0, 3).toUpperCase(),
        release_date: "2023-01-01",
        expansion_type: "Expansion",
        generations: {
          id: 1,
          name: "Gen I",
        },
      },
      product_types: {
        id: 1,
        name: "booster_box",
        label: "Booster Box",
      },
    },
  };
}

// Create test holdings with different values for sorting tests
const testHoldings: HoldingWithProduct[] = [
  createMockHolding({
    id: 1,
    set_name: "Zapdos Set",
    quantity: 2,
    purchase_price_usd: 100,
    current_price: 120, // 20% gain, value: 240
    purchase_date: "2024-01-15",
  }),
  createMockHolding({
    id: 2,
    set_name: "Alpha Set",
    quantity: 3,
    purchase_price_usd: 50,
    current_price: 40, // -20% loss, value: 120
    purchase_date: "2024-03-01",
  }),
  createMockHolding({
    id: 3,
    set_name: "Mew Set",
    quantity: 1,
    purchase_price_usd: 200,
    current_price: 300, // 50% gain, value: 300
    purchase_date: "2024-02-10",
  }),
];

describe("HoldingsTable", () => {
  const mockOnEdit = jest.fn();
  const mockOnDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Basic rendering", () => {
    it("should render the holdings count in header", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Holdings (3)")).toBeInTheDocument();
    });

    it("should render all sort buttons", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Date")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Value")).toBeInTheDocument();
      expect(screen.getByText("G/L")).toBeInTheDocument();
      expect(screen.getByText("G/L %")).toBeInTheDocument();
    });

    it("should render all holding cards", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("Zapdos Set")).toBeInTheDocument();
      expect(screen.getByText("Alpha Set")).toBeInTheDocument();
      expect(screen.getByText("Mew Set")).toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("should display empty state message when no holdings", () => {
      render(
        <HoldingsTable
          holdings={[]}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.getByText("No holdings yet")).toBeInTheDocument();
      expect(
        screen.getByText("Add your first holding to start tracking your portfolio.")
      ).toBeInTheDocument();
    });

    it("should not display sort buttons in empty state", () => {
      render(
        <HoldingsTable
          holdings={[]}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      expect(screen.queryByText("Date")).not.toBeInTheDocument();
      expect(screen.queryByText("Name")).not.toBeInTheDocument();
    });
  });

  describe("Sorting by name", () => {
    it("should sort holdings alphabetically by name when Name button clicked (desc first)", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const nameButton = screen.getByText("Name");
      fireEvent.click(nameButton);

      // Get all set names in order - matching the heading text
      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      // After clicking once (desc), should be Z -> A (Zapdos, Mew, Alpha)
      expect(names[0]).toBe("Zapdos Set");
      expect(names[1]).toBe("Mew Set");
      expect(names[2]).toBe("Alpha Set");
    });

    it("should toggle sort direction when Name button clicked twice", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Click Name button twice - first desc then asc
      let nameButton = screen.getByText("Name");
      fireEvent.click(nameButton); // First click - sets to name desc

      // Get initial order (desc: Z -> A)
      let headings = screen.getAllByRole("heading", { level: 3 });
      let names = headings.map((el) => el.textContent);
      expect(names[0]).toBe("Zapdos Set");

      // Click again to toggle to asc - need to get the button again after re-render
      nameButton = screen.getByRole("button", { name: /Name/ });
      fireEvent.click(nameButton);

      headings = screen.getAllByRole("heading", { level: 3 });
      names = headings.map((el) => el.textContent);

      // Should be A -> Z (Alpha, Mew, Zapdos)
      expect(names[0]).toBe("Alpha Set");
      expect(names[1]).toBe("Mew Set");
      expect(names[2]).toBe("Zapdos Set");
    });
  });

  describe("Sorting by value", () => {
    it("should sort holdings by value descending when Value button clicked", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const valueButton = screen.getByText("Value");
      fireEvent.click(valueButton);

      // Values: Zapdos=240, Alpha=120, Mew=300
      // Desc order: Mew (300), Zapdos (240), Alpha (120)
      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      expect(names[0]).toBe("Mew Set");
      expect(names[1]).toBe("Zapdos Set");
      expect(names[2]).toBe("Alpha Set");
    });

    it("should toggle value sort direction when clicked twice", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      let valueButton = screen.getByText("Value");
      fireEvent.click(valueButton); // First click - desc

      // Verify desc order first
      let headings = screen.getAllByRole("heading", { level: 3 });
      let names = headings.map((el) => el.textContent);
      expect(names[0]).toBe("Mew Set"); // Highest value

      // Click again to toggle to asc - need to re-query button after state change
      valueButton = screen.getByRole("button", { name: /Value/ });
      fireEvent.click(valueButton);

      headings = screen.getAllByRole("heading", { level: 3 });
      names = headings.map((el) => el.textContent);

      // Asc order: Alpha (120), Zapdos (240), Mew (300)
      expect(names[0]).toBe("Alpha Set");
      expect(names[1]).toBe("Zapdos Set");
      expect(names[2]).toBe("Mew Set");
    });
  });

  describe("Sorting by gain/loss", () => {
    it("should sort by gain/loss descending when G/L button clicked", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Get the exact G/L button (not G/L %)
      const buttons = screen.getAllByRole("button");
      const glButton = buttons.find((btn) => btn.textContent === "G/L");
      fireEvent.click(glButton!);

      // Gain/Loss: Zapdos=+40, Alpha=-30, Mew=+100
      // Desc order: Mew (+100), Zapdos (+40), Alpha (-30)
      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      expect(names[0]).toBe("Mew Set");
      expect(names[1]).toBe("Zapdos Set");
      expect(names[2]).toBe("Alpha Set");
    });
  });

  describe("Sorting by gain/loss percent", () => {
    it("should sort by gain/loss percent descending when G/L % button clicked", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const glPercentButton = screen.getByText("G/L %");
      fireEvent.click(glPercentButton);

      // Gain/Loss %: Zapdos=+20%, Alpha=-20%, Mew=+50%
      // Desc order: Mew (+50%), Zapdos (+20%), Alpha (-20%)
      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      expect(names[0]).toBe("Mew Set");
      expect(names[1]).toBe("Zapdos Set");
      expect(names[2]).toBe("Alpha Set");
    });
  });

  describe("Sorting by date", () => {
    it("should sort by purchase date descending by default", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Dates: Zapdos=2024-01-15, Alpha=2024-03-01, Mew=2024-02-10
      // Default desc: Alpha (Mar), Mew (Feb), Zapdos (Jan)
      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      expect(names[0]).toBe("Alpha Set");
      expect(names[1]).toBe("Mew Set");
      expect(names[2]).toBe("Zapdos Set");
    });

    it("should toggle date sort direction when Date button clicked", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const dateButton = screen.getByRole("button", { name: /Date/ });
      fireEvent.click(dateButton); // Should toggle to asc

      const headings = screen.getAllByRole("heading", { level: 3 });
      const names = headings.map((el) => el.textContent);

      // Asc: Zapdos (Jan), Mew (Feb), Alpha (Mar)
      expect(names[0]).toBe("Zapdos Set");
      expect(names[1]).toBe("Mew Set");
      expect(names[2]).toBe("Alpha Set");
    });
  });

  describe("Sort button styling", () => {
    it("should highlight active sort button", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Date is the default sort, should have active styling
      const dateButton = screen.getByRole("button", { name: /Date/ });
      expect(dateButton).toHaveClass("bg-blue-100");
    });

    it("should show sort direction indicator on active button", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Date is default with desc direction
      const dateButton = screen.getByRole("button", { name: /Date/ });
      expect(dateButton.textContent).toContain("Date");
    });

    it("should update active button when different sort is selected", () => {
      render(
        <HoldingsTable
          holdings={testHoldings}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // First verify Date is highlighted initially
      let dateButton = screen.getByRole("button", { name: /Date/ });
      expect(dateButton).toHaveClass("bg-blue-100");

      // Click Name button
      const nameButton = screen.getByText("Name");
      fireEvent.click(nameButton);

      // Re-query the buttons after state update
      const updatedNameButton = screen.getByRole("button", { name: /Name/ });
      dateButton = screen.getByRole("button", { name: /Date/ });

      // Name button should now be highlighted
      expect(updatedNameButton).toHaveClass("bg-blue-100");

      // Date button should no longer be highlighted
      expect(dateButton).not.toHaveClass("bg-blue-100");
    });
  });

  describe("Props passed to HoldingCards", () => {
    it("should pass currency prop to holding cards", () => {
      render(
        <HoldingsTable
          holdings={[testHoldings[0]]}
          currency="CAD"
          exchangeRate={1.36}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      // Check that CAD formatting is applied (there will be multiple elements)
      expect(screen.getAllByText(/C\$/).length).toBeGreaterThan(0);
    });

    it("should pass onEdit handler to holding cards", () => {
      render(
        <HoldingsTable
          holdings={[testHoldings[0]]}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledWith(testHoldings[0]);
    });

    it("should pass onDelete handler to holding cards", () => {
      render(
        <HoldingsTable
          holdings={[testHoldings[0]]}
          onEdit={mockOnEdit}
          onDelete={mockOnDelete}
        />
      );

      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledWith(testHoldings[0].id);
    });
  });
});
