import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { isCrmShowcase } from "@/lib/showcase-mode";

// Both self-hosted: no Google Fonts request at runtime, and the app works offline.
const inter = localFont({ src: "../public/fonts/inter-latin.woff2", variable: "--font-inter", display: "swap", weight: "100 900" });
// Subset to the ~60 glyphs this UI uses - 5 KB instead of the 3.8 MB variable family.
const symbols = localFont({
  src: "../public/fonts/material-symbols.woff2",
  variable: "--font-symbols", display: "block", weight: "400",
});

export const metadata: Metadata = {
  title: { default: isCrmShowcase() ? "expressdiabetics CRM" : "Pharmacy Outreach CRM", template: isCrmShowcase() ? "%s · expressdiabetics" : "%s · Pharmacy Outreach CRM" },
  description: "Verified pharmacy master registry and outreach",
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8ff" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
  ],
};

/**
 * Root layout holds the document only. The CRM chrome lives in the (crm) route group so the
 * public pages - login and unsubscribe - render without a navigation sidebar they must not show.
 *
 * The theme cookie is read here and written onto <html> before anything paints, so a chosen
 * theme never flashes the other one on load. "system" writes no attribute and lets the CSS
 * media query decide.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  const attr = theme === "light" || theme === "dark" ? theme : theme === "system" ? undefined : "light";

  return (
    <html lang="en" data-theme={attr} suppressHydrationWarning
      className={`${inter.variable} ${symbols.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
