import { ReactNode } from "react";

interface ProductGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * Responsive grid container for product cards
 * - Mobile: 1 column
 * - Tablet: 2 columns
 * - Desktop: 3 columns
 */
export default function ProductGrid({
  children,
  className = "",
}: ProductGridProps) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 ${className}`}
    >
      {children}
    </div>
  );
}
