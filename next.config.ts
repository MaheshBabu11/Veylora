import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-unrar-js"],
  // Security & Performance Headers
  poweredByHeader: false,

  allowedDevOrigins: ['192.168.1.37'],

  // Optimization settings
  compress: true,
  reactStrictMode: true,
  
  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    unoptimized: false,
  },
  
  // Build optimization
  productionBrowserSourceMaps: false,
  
  // Turbopack configuration for Next.js 16
  turbopack: {
    resolveAlias: {
      "@": "./src",
    },
  },

  // Environment
  env: {
    NEXT_PUBLIC_VERSION: "0.1.0-alpha",
  },

  async rewrites() {
    return [
      { source: "/library", destination: "/main/library" },
      { source: "/series/:id", destination: "/main/series/:id" },
      { source: "/recently-added", destination: "/main/recently-added" },
      { source: "/continue-reading", destination: "/main/continue-reading" },
      { source: "/history", destination: "/main/history" },
      { source: "/collections", destination: "/main/collections" },
      { source: "/favorites", destination: "/main/favorites" },
      { source: "/categories", destination: "/main/categories" },
      { source: "/authors", destination: "/main/authors" },
      { source: "/settings", destination: "/main/settings" },
    ];
  },
};

export default nextConfig;
