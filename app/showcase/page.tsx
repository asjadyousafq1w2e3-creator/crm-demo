import { Landing } from "@/components/showcase/landing";
import { showcaseLinks } from "@/lib/showcase-links";
import "../showcase.css";

export const metadata = { title: { absolute: "Pharmacy First — Better connections. Stronger pharmacies." }, description: "A thoughtfully connected workspace for independent pharmacy outreach. Explore the original Pharmacy Outreach CRM, from pharmacy records to campaigns and conversations." };

export default async function ShowcasePage() {
  return <Landing links={await showcaseLinks()} />;
}
