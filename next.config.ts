import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "exceljs"],
  outputFileTracingIncludes: {
    "/api/projects/[id]/export": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
