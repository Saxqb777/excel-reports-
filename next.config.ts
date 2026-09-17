import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "exceljs"],
  // Keys are picomatch globs against the route path: brackets must be escaped or they read as character classes.
  outputFileTracingIncludes: {
    "/api/projects/\\[id\\]/export": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/projects/*/export": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/og/\\[token\\]": ["./node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-*-normal.woff"],
    "/og/*": ["./node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-*-normal.woff"],
  },
  // Crawlers that build link previews get metadata in <head> before anything streams (Next's default list plus the chat apps in src/proxy.ts).
  htmlLimitedBots: /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|TelegramBot|Snapchat|Pinterest|Viber|Microsoft Teams|MSTeams|Iframely|Embedly|Google-PageRenderer|YahooMailProxy|Outlook/i,
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
