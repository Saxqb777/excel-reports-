import { NextResponse, type NextRequest } from "next/server";

/**
 * Link-preview crawlers (WhatsApp, Teams, iMessage, Slack, LinkedIn, Telegram…) give up on slow, heavy pages. They are
 * rewritten to /preview, a tiny page that carries only the title, description and card image, so previews always appear.
 * Real browsers never see it.
 */
const PREVIEW_BOTS = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|SkypeUriPreview|Applebot|Snapchat|Pinterest|Viber|Microsoft Teams|MSTeams|Iframely|Embedly|redditbot|bitlybot|Google-PageRenderer|YahooMailProxy|Outlook/i;

export function proxy(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (!PREVIEW_BOTS.test(ua)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  const url = req.nextUrl.clone();
  if (pathname === "/") { url.pathname = "/preview"; return NextResponse.rewrite(url); }
  const m = pathname.match(/^\/s\/([^/]+)\/?$/);
  if (m) { url.pathname = `/preview/${m[1]}`; return NextResponse.rewrite(url); }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/s/:token"] };
