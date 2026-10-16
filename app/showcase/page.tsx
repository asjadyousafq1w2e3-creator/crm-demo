import { Landing } from "@/components/showcase/landing";
import { showcaseLinks } from "@/lib/showcase-links";
import "../showcase.css";

export const metadata = { title: { absolute: "Pharmacy First | Wholesale Medicine Supply for Pharmacies" }, description: "Wholesale medicines and wellness essentials for pharmacy businesses. Browse the Pharmacy First sample catalog, stock overview, and B2B business demo." };

export default async function ShowcasePage() {
  return <Landing links={await showcaseLinks()} />;
}
