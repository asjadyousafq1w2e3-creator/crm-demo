import { Landing } from "@/components/showcase/landing";
import { showcaseLinks } from "@/lib/showcase-links";
import localFont from "next/font/local";
import "../showcase.css";

// Load this typography only for the public site; the original CRM keeps Inter.
const display = localFont({ src: "../../public/fonts/manrope-latin.woff2", variable: "--font-pf-display", display: "swap", weight: "200 800" });
const body = localFont({ src: "../../public/fonts/source-sans-3-latin.woff2", variable: "--font-pf-body", display: "swap", weight: "200 900" });

export const metadata = { title: { absolute: "expressdiabetics | Wholesale Medicine Supply for Pharmacies" }, description: "Wholesale medicines and wellness essentials for pharmacy businesses. Browse the expressdiabetics sample catalog, stock overview, and B2B business demo." };

export default async function ShowcasePage() {
  return <div className={`${display.variable} ${body.variable}`}><Landing links={await showcaseLinks()} /></div>;
}
