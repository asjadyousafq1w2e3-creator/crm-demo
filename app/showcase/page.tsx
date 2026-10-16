import { Landing } from "@/components/showcase/landing";
import { showcaseLinks } from "@/lib/showcase-links";
import "../showcase.css";

export const metadata = { title: { absolute: "Pharmacy First — Medicine wholesale. Pharmacy first." }, description: "Medicine wholesale built around your pharmacy. Explore featured medicines, illustrative stock availability, and the Pharmacy First B2B demo with access to the original CRM." };

export default async function ShowcasePage() {
  return <Landing links={await showcaseLinks()} />;
}
