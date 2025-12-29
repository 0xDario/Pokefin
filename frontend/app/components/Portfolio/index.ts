// Main component exports
export { default as PortfolioDashboard } from "./PortfolioDashboard";

// Shared components
export { default as PortfolioSummaryCard } from "./shared/PortfolioSummaryCard";
export { default as PortfolioChart } from "./shared/PortfolioChart";
export { default as AllocationChart } from "./shared/AllocationChart";
export { default as ProductSearchSelect } from "./shared/ProductSearchSelect";

// Card components
export { default as HoldingCard } from "./cards/HoldingCard";
export { default as HoldingsTable } from "./cards/HoldingsTable";
export { default as AddHoldingModal } from "./cards/AddHoldingModal";
export { default as EditHoldingModal } from "./cards/EditHoldingModal";
export { default as ImportHoldingsModal } from "./cards/ImportHoldingsModal";

// Hooks
export { usePortfolioData, useProductSearch } from "./hooks";

// Types
export * from "./types";
