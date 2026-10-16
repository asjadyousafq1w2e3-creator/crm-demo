import { headers } from "next/headers";
import { isCrmShowcase, SHOWCASE_EMAIL, SHOWCASE_PASSWORD } from "./showcase-mode";

/** Both domains share one Vercel project. Local and preview deployments use /crm. */
export async function showcaseLinks() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const hostname = host.split(":")[0].toLowerCase();
  const isCrm = hostname.startsWith("crm.") || hostname === process.env.CRM_HOST?.toLowerCase();
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" ? "http" : "https";
  const crm = (process.env.NEXT_PUBLIC_CRM_URL || (isCrm ? `${protocol}://${host}` : "/crm")).replace(/\/$/, "");
  const home = process.env.NEXT_PUBLIC_SITE_URL || (isCrm ? `${protocol}://${host.replace(/^crm\./i, "")}` : "/");
  return {
    crm,
    login: crm === "/crm" ? "/login?next=%2Fcrm" : `${crm}/login`,
    home,
    demoEmail: isCrmShowcase() ? SHOWCASE_EMAIL : process.env.NEXT_PUBLIC_DEMO_EMAIL || "",
    demoPassword: isCrmShowcase() ? SHOWCASE_PASSWORD : process.env.NEXT_PUBLIC_DEMO_PASSWORD || "",
  };
}

export async function crmHomePath() {
  const host = ((await headers()).get("host") || "").split(":")[0].toLowerCase();
  return host.startsWith("crm.") || host === process.env.CRM_HOST?.toLowerCase() ? "/" : "/crm";
}
