import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import Header from "./components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        </AuthProvider>
      </body>
    </html>
  );
}
