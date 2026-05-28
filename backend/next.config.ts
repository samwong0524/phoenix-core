import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  webpack: (config) => {
    // Prevent webpack from watching uploaded files — new files in public/uploads/
    // trigger a full page reload (white flash) when the agent processes images.
    const newPatterns = [
      "public/uploads",
      ".next",
      "node_modules",
    ];
    // Extract existing string patterns, filter out RegExp and other types.
    const existing = config.watchOptions?.ignored;
    const existingPatterns: string[] = [];
    if (typeof existing === "string") existingPatterns.push(existing);
    else if (Array.isArray(existing)) {
      for (const p of existing) {
        if (typeof p === "string" && p.length > 0) existingPatterns.push(p);
      }
    }
    // Must replace the whole watchOptions object — individual properties are frozen.
    config.watchOptions = {
      poll: config.watchOptions?.poll,
      aggregateTimeout: config.watchOptions?.aggregateTimeout,
      ignored: [...new Set([...existingPatterns, ...newPatterns])],
    };
    return config;
  },
};

export default nextConfig;
