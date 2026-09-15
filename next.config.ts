import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "exceljs"],
  // Keys are picomatch globs against the route path: brackets must be escaped or they read as character classes.
  outputFileTracingIncludes: {
    "/api/projects/\\[id\\]/export": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/projects/*/export": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
