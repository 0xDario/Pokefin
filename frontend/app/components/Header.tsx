"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";

const NAV_LINKS = [
  { href: "/prices", label: "Prices" },
  { href: "/market", label: "Market View" },
  { href: "/analytics", label: "Set Analytics" },
  { href: "/compare", label: "Seller Tools" },
  { href: "/box-calculator", label: "Box Calculator" },
];

function PokeballMark({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="pf-pokeball-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <path
        d="M1 16 A15 15 0 0 1 31 16 Z"
        fill="url(#pf-pokeball-top)"
        stroke="#0f172a"
        strokeWidth="1.5"
      />
      <rect x="1" y="15" width="30" height="2" fill="#0f172a" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="1.8" fill="#0f172a" />
    </svg>
  );
}

export default function Header() {
  const { user, profile, loading, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    router.push("/");
  };

  const displayName = profile?.username || user?.email?.split("@")[0] || "User";

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <PokeballMark className="w-7 h-7 transition-transform group-hover:rotate-12" />
              <span className="text-xl font-extrabold tracking-tight text-slate-900">
                Pok<span className="text-[var(--pf-pokeball)]">é</span>fin
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? "text-[var(--pf-pokeball)]"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {link.label}
                    {active && (
                      <span className="absolute left-3 right-3 -bottom-[1px] h-0.5 bg-[var(--pf-pokeball)] rounded-full" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center">
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
            ) : user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeball)] focus:ring-offset-2 rounded-full px-1.5 py-1.5"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--pf-pokeball)] to-[var(--pf-pokeball-strong)] flex items-center justify-center text-white font-bold shadow-sm">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span>{displayName}</span>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                      dropdownOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-lg ring-1 ring-slate-200 py-1 z-50">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>
                    </div>
                    <div className="py-1">
                      <Link
                        href="/portfolio"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        My Portfolio
                      </Link>
                      <Link
                        href="/account"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Account Settings
                      </Link>
                    </div>
                    <div className="border-t border-slate-100 py-1">
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-[var(--pf-pokeball)] hover:bg-rose-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/auth/login"
                  className="text-sm font-semibold text-slate-700 hover:text-slate-900 px-3 py-2"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  className="text-sm font-semibold bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-slate-700 hover:text-slate-900 focus:outline-none p-2"
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          className="md:hidden border-t border-slate-200 bg-white shadow-lg absolute w-full left-0 z-40"
          ref={mobileMenuRef}
        >
          <div className="pt-2 pb-3 space-y-1 px-4">
            {NAV_LINKS.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2 rounded-md text-base font-semibold ${
                    active
                      ? "bg-rose-50 text-[var(--pf-pokeball)]"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="pt-4 pb-4 border-t border-slate-200 px-4">
            {loading ? (
              <div className="flex items-center px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
                <div className="ml-3 h-4 w-24 bg-slate-200 rounded animate-pulse" />
              </div>
            ) : user ? (
              <div className="space-y-1">
                <div className="flex items-center px-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--pf-pokeball)] to-[var(--pf-pokeball-strong)] flex items-center justify-center text-white font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="ml-3">
                    <div className="text-base font-semibold text-slate-900">{displayName}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{user.email}</div>
                  </div>
                </div>
                <Link
                  href="/portfolio"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-semibold text-slate-700 hover:bg-slate-50"
                >
                  My Portfolio
                </Link>
                <Link
                  href="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Account Settings
                </Link>
                <button
                  onClick={handleSignOut}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-semibold text-[var(--pf-pokeball)] hover:bg-rose-50"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 px-3">
                <Link
                  href="/auth/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center px-4 py-2 border border-slate-300 rounded-md text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center px-4 py-2 rounded-md text-sm font-semibold text-white bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)]"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
