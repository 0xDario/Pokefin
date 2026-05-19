"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const EXPLORE_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/market", label: "Market View" },
  { href: "/analytics", label: "Set Analytics" },
  { href: "/compare", label: "Seller Tools" },
  { href: "/box-calculator", label: "Box Calculator" },
];

const ACCOUNT_LINKS = [
  { href: "/auth/login", label: "Sign In" },
  { href: "/auth/signup", label: "Sign Up" },
  { href: "/portfolio", label: "Portfolio" },
];

function PokeballGlyph({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <path d="M1 16 A15 15 0 0 1 31 16 Z" fill="#dc2626" stroke="#0f172a" strokeWidth="1.5" />
      <rect x="1" y="15" width="30" height="2" fill="#0f172a" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="1.8" fill="#0f172a" />
    </svg>
  );
}

export default function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/auth/")) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="mt-8 border-t border-slate-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">
              Explore
            </h3>
            <ul className="space-y-2">
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-600 hover:text-[var(--pf-pokeball)] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">
              Account
            </h3>
            <ul className="space-y-2">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-600 hover:text-[var(--pf-pokeball)] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-2 md:col-span-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">
              About
            </h3>
            <div className="flex items-center gap-2 mb-2">
              <PokeballGlyph className="w-5 h-5" />
              <span className="text-sm font-bold text-slate-900">
                Pok<span className="text-[var(--pf-pokeball)]">é</span>fin
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sealed Pokémon TCG market data — prices refreshed hourly from TCGPlayer.
            </p>
            <Link
              href="https://cardrinktcg.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
            >
              Shop at CardRinkTCG.ca →
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-slate-500">© {year} Pokéfin</p>
          <p className="text-xs text-slate-500">
            Data refreshed hourly from TCGPlayer
          </p>
        </div>
      </div>
    </footer>
  );
}
