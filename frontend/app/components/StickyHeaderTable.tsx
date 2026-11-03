"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Horizontal-scroll wrapper for wide data tables that keeps the <thead>
 * pinned just below the sticky site header while the page scrolls.
 *
 * CSS `position: sticky` can't do this here: the wrapper must be
 * `overflow-x: auto` for wide tables, which makes it the sticky containing
 * scroller and traps the header inside it. Instead we translate the header
 * cells down by however far the table top has scrolled past the site header,
 * clamped so the header never leaves the table.
 */
export default function StickyHeaderTable({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let frame = 0;
    let lastShift = -1;

    const update = () => {
      frame = 0;
      const table = wrapper.querySelector("table");
      const thead = table?.tHead;
      if (!table || !thead) return;

      const siteHeader = document.querySelector<HTMLElement>("[data-site-header]");
      const offset = siteHeader ? siteHeader.getBoundingClientRect().bottom : 0;
      const rect = table.getBoundingClientRect();
      const maxShift = Math.max(0, rect.height - thead.offsetHeight);
      const shift = Math.round(Math.min(Math.max(offset - rect.top, 0), maxShift));
      if (shift === lastShift) return;
      lastShift = shift;

      const transform = shift > 0 ? `translate3d(0, ${shift}px, 0)` : "";
      thead.querySelectorAll<HTMLTableCellElement>("th").forEach((th) => {
        th.style.transform = transform;
      });
      thead.toggleAttribute("data-stuck", shift > 0);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Header cells can be re-created (column toggles, sorting); force a re-apply.
    const reapply = () => {
      lastShift = -1;
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", reapply);
    const resizeObserver = new ResizeObserver(reapply);
    resizeObserver.observe(wrapper);
    const mutationObserver = new MutationObserver(reapply);
    mutationObserver.observe(wrapper, { childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", reapply);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} className={`pf-sticky-table overflow-x-auto ${className}`}>
      {children}
    </div>
  );
}
