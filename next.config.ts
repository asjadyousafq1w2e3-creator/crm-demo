import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "./lib/content-security-policy";

/**
 * Response headers applied to every route.
 *
 * The CSP is deliberately strict: this application loads no third-party script, no third-party
 * font (both are self-hosted) and embeds no external frame, so nothing here needs loosening for
 * ordinary use. 'unsafe-inline' for styles is the one concession - Next injects inline style
 * attributes for its own layout, and nonce-ing those is not worth the complexity here.
 */
// Middleware adds a fresh nonce to HTML responses so Next's inline runtime can hydrate.
const csp = contentSecurityPolicy(process.env.NODE_ENV === "production");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/**
 * HSTS, deliberately scoped to this host only.
 *
 * "includeSubDomains" is absent on purpose. The CRM is one subdomain of a company domain that
 * will later carry a public website, and possibly app. and api. hosts built by other people on
 * other platforms. A directive this host sends cannot bind its parent, but it does bind every
 * future *.crm host, and the CRM gains nothing from that. Preload is likewise not requested:
 * it is a one-way door for the whole domain and is the client's decision, not ours.
 *
 * Sent only in production. A development server is plain HTTP, and pinning localhost to HTTPS
 * in a browser is an afternoon lost to a problem that looks like a broken application.
 */
const hsts = process.env.NODE_ENV === "production"
  ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]
  : [];

/**
 * Origins allowed to submit a server action.
 *
 * Next compares the request's Origin against its Host and rejects a mismatch - which is how it
 * blocks cross-site action calls, and also how it breaks the moment a reverse proxy forwards a
 * Host the application does not recognise. Naming the public host here makes the deployment work
 * behind a proxy without weakening the check: an origin still has to be this one.
 */
const allowedOrigins = (() => {
  const origins = new Set<string>();
  try { origins.add(new URL(process.env.APP_URL ?? "http://localhost:3000").host); } catch { }
  return [...origins].filter(Boolean);
})();

const nextConfig: NextConfig = {
  // Keep the client demo's production bundle separate from the local development build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // These server libraries are large; load their native packages instead of compiling them.
  serverExternalPackages: ["googleapis", "exceljs"],
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  /**
   * Where file tracing starts when building the standalone bundle.
   *
   * Left to itself, Next walks up looking for a lockfile and had been settling on the developer's
   * home directory, because a stray package-lock.json happened to be sitting there. That makes
   * the build depend on what else is on the machine: the same commit traces a different tree on
   * a laptop and on the deploy server, and the standalone output can end up missing a dependency
   * that was only found by accident. Pinning it to this directory makes the build the same
   * everywhere.
   */
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  poweredByHeader: false,            // no need to advertise the framework
  // Lets a page answer 403/401 properly instead of throwing a 500 at someone who simply
  // lacks a permission. Enables forbidden() / unauthorized() and app/forbidden.tsx.
  experimental: {
    authInterrupts: true,
    // See allowedOrigins above - required for server actions behind a reverse proxy.
    serverActions: { allowedOrigins },
  },
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders, ...hsts] }];
  },
};

export default nextConfig;
