import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.tcgplayer.com',
      },
      {
        protocol: 'https',
        hostname: 'tcgplayer.com',
      },
      {
        protocol: 'https',
        hostname: 'tyrhvavwvphazpmwluft.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
};

export default nextConfig;
