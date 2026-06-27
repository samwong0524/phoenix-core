import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  outputFileTracingRoot: __dirname,
  webpack: (config) => {
    // Prevent webpack from watching uploaded files that trigger a full page reload
    const newPatterns = [
      "public/uploads",
      ".next",
      "node_modules",
    ];
    const existing = config.watchOptions?.ignored;
    const existingPatterns: string[] = [];
    if (typeof existing === "string") existingPatterns.push(existing);
    else if (Array.isArray(existing)) {
      for (const p of existing) {
        if (typeof p === "string" && p.length > 0) existingPatterns.push(p);
      }
    }
    config.watchOptions = {
      poll: config.watchOptions?.poll,
      aggregateTimeout: config.watchOptions?.aggregateTimeout,
      ignored: [...new Set([...existingPatterns, ...newPatterns])],
    };
    return config;
  },
};

export default nextConfig;
