import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// preload: false - next/font would otherwise emit a high-priority <link
// rel="preload"> for the mono subset on EVERY route, but only a handful of
// components (e.g. GroupHeader on / and /prices) render monospace glyphs.
// The family is still available through --font-geist-mono; the browser fetches
// it on demand when a rule that uses it actually matches an element.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Pokémon Sealed Product Price Tracker",
  description:
    "Get up-to-date Pokémon sealed product prices, refreshed hourly from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
  openGraph: {
    title: "Pokémon Sealed Product Price Tracker",
    description:
      "Get up-to-date Pokémon sealed product prices, refreshed hourly from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
    url: "https://pokefin.ca",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <Header />
          {children}
          <Footer />
        </AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
