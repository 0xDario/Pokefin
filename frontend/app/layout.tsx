import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ...existing code...
export const metadata: Metadata = {
  title: "Pokémon Sealed Product Price Tracker",
  description:
    "Get up-to-date Pokémon sealed product prices, refreshed hourly from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
  openGraph: {
    title: "Pokémon Sealed Product Price Tracker",
    description:
      "Get up-to-date Pokémon sealed product prices, refreshed hourly from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
    // Optionally add image and url:
    // images: ["https://yourdomain.com/og-image.png"],
    url: "https://pokefin.vercel.app",
  },
};
// ...existing code...

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
        {children}
      </body>
    </html>
  );
}
