"use client";

import { useEffect, useState } from "react";

interface ResponsiveState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * Hook to detect screen size and provide responsive breakpoint booleans
 *
 * Breakpoints:
 * - Mobile: < 768px
 * - Tablet: 768px - 1023px
 * - Desktop: >= 1024px
 *
 * @returns {ResponsiveState} Object with isMobile, isTablet, isDesktop booleans
 */
export function useResponsive(): ResponsiveState {
  const [size, setSize] = useState<ResponsiveState>({
    isMobile: false,
    isTablet: false,
    isDesktop: false,
  });

  useEffect(() => {
    const updateSize = () => {
      const width = window.innerWidth;
      setSize({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
      });
    };

    // Set initial size
    updateSize();

    // Add event listener
    window.addEventListener("resize", updateSize);

    // Cleanup
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return size;
}
