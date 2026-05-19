"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PromoVariant = "header" | "banner" | "card" | "footer";

interface CardRinkPromoProps {
  variant: PromoVariant;
}

const BANNER_DISMISS_KEY = "cardrink-promo-banner-dismissed";

function PokeballGlyph({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <path
        d="M1 16 A15 15 0 0 1 31 16 Z"
        fill="#dc2626"
        stroke="#0f172a"
        strokeWidth="1.5"
      />
      <rect x="1" y="15" width="30" height="2" fill="#0f172a" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="1.8" fill="#0f172a" />
    </svg>
  );
}

export default function CardRinkPromo({ variant }: CardRinkPromoProps) {
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (variant !== "banner") return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(BANNER_DISMISS_KEY) === "1") {
      setBannerDismissed(true);
    }
  }, [variant]);

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(BANNER_DISMISS_KEY, "1");
    }
  };

  // Header variant — slim announcement bar
  if (variant === "header") {
    return (
      <div className="bg-gradient-to-r from-[var(--pf-pokeball)] to-[var(--pf-pokeball-strong)] text-white py-2.5 px-6 mb-6 rounded-lg shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-sm font-medium text-center sm:text-left flex items-center gap-2">
            <PokeballGlyph className="w-4 h-4" />
            Looking for sealed products, singles, or slabs?
          </p>
          <Link
            href="https://cardrinktcg.ca"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-[var(--pf-pokeball)] hover:bg-slate-50 px-5 py-1.5 rounded-md font-semibold text-sm transition-colors whitespace-nowrap shadow-sm"
          >
            Shop CardRinkTCG.ca →
          </Link>
        </div>
      </div>
    );
  }

  // Banner variant — prominent placement near the catalog
  if (variant === "banner") {
    if (bannerDismissed) return null;
    return (
      <div className="relative my-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm overflow-hidden">
        {/* Accent stripe — Pokéball red rail */}
        <div
          className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[var(--pf-pokeball)] to-[var(--pf-pokeball-strong)]"
          aria-hidden
        />
        <button
          type="button"
          onClick={handleDismissBanner}
          aria-label="Dismiss promotion"
          className="absolute top-2 right-2 p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)]"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>

        <div className="flex flex-col md:flex-row items-center gap-5 pl-3">
          <div className="flex-shrink-0">
            <PokeballGlyph className="w-14 h-14" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-lg font-bold text-slate-900">
              Ready to buy Pokémon cards?
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Shop sealed products, singles, and graded slabs at{" "}
              <span className="font-semibold text-slate-900">CardRinkTCG.ca</span>.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center md:justify-start mt-2 text-xs text-slate-500">
              <span>Sealed Boxes</span>
              <span aria-hidden>·</span>
              <span>Singles</span>
              <span aria-hidden>·</span>
              <span>Graded Slabs</span>
            </div>
          </div>
          <div className="flex-shrink-0">
            <Link
              href="https://cardrinktcg.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors shadow-sm whitespace-nowrap"
            >
              Visit Store →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Card variant — tiny inline link
  if (variant === "card") {
    return (
      <div className="mt-2 pt-2 border-t border-slate-200">
        <Link
          href="https://cardrinktcg.ca"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)] transition-colors inline-flex items-center gap-1"
        >
          Shop at CardRinkTCG.ca →
        </Link>
      </div>
    );
  }

  // Footer variant — site footer-style block
  if (variant === "footer") {
    return (
      <footer className="mt-12 pt-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col items-center text-center gap-3 mb-6">
              <PokeballGlyph className="w-10 h-10" />
              <h2 className="text-2xl font-bold text-slate-900">
                Ready to start collecting?
              </h2>
              <p className="text-slate-600 max-w-xl">
                Visit <span className="font-semibold text-slate-900">CardRinkTCG.ca</span>{" "}
                for Pokémon sealed products, singles, and graded slabs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
              {[
                { label: "Sealed Products", sub: "Booster boxes, ETBs, bundles & more" },
                { label: "Single Cards", sub: "Find the exact cards you need" },
                { label: "Graded Slabs", sub: "PSA, CGC, BGS certified cards" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center"
                >
                  <h3 className="font-semibold text-slate-900">{item.label}</h3>
                  <p className="text-xs text-slate-500 mt-1">{item.sub}</p>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Link
                href="https://cardrinktcg.ca"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-sm"
              >
                Shop CardRinkTCG.ca →
              </Link>
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
              Powered by pokefin.ca — Track prices, shop smart.
            </p>
          </div>
        </div>
      </footer>
    );
  }

  return null;
}
