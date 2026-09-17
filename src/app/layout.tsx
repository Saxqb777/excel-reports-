import type { Metadata } from "next";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reports and analytics",
  description: "Executive dashboards from Excel.",
};

const themeScript = `(function(){try{var p=location.pathname.split('/');var scope=(p[1]==='p'||p[1]==='s')&&p[2]?p[2]:null;var t=(scope&&localStorage.getItem('meridian-theme:'+scope))||localStorage.getItem('meridian-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
