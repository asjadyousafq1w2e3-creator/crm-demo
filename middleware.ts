import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./lib/content-security-policy";
import { isCrmShowcase } from "./lib/showcase-mode";

/**
 * Gate every CRM route behind a session. The cookie's signature is verified inside the app
 * (Node crypto is unavailable in the edge runtime); this layer only checks presence, which is
 * enough to redirect. Pages and actions still call requireSession().
 */
// A health check that needs a session is useless to a load balancer, so it is public - see the
// route for what it does and does not disclose.
const PUBLIC = ["/login", "/unsubscribe", "/api/unsubscribe", "/api/auth", "/api/health",
                "/_next", "/favicon.ico"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const production = process.env.NODE_ENV === "production";
  const nonce = production ? btoa(crypto.randomUUID()) : undefined;
  const csp = contentSecurityPolicy(production, nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  if (nonce) requestHeaders.set("x-nonce", nonce);
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  // Next's internal URL can use the loopback host behind a proxy; domain routing must use
  // the public Host header that Vercel forwards.
  const hostname = (req.headers.get("host") || req.nextUrl.host).split(":")[0].toLowerCase();
  const crmHost = hostname.startsWith("crm.") || hostname === process.env.CRM_HOST?.toLowerCase();
  const rewrite = (destination: string) => {
    const url = req.nextUrl.clone();
    url.pathname = destination;
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  if (isCrmShowcase()) {
    const read = req.method === "GET" || req.method === "HEAD";
    const demoAuth = pathname === "/api/auth/login" || pathname === "/api/auth/logout";
    if (pathname === "/api/health" && read)
      return NextResponse.json({ ok: true, mode: "display-only", database: "not required", sending: "disabled" });
    const sampleExport = read && ["/api/registry/export", "/api/deliverable"].includes(pathname);
    if ((!read || pathname.startsWith("/api/")) && !demoAuth && !sampleExport)
      return NextResponse.json({ error: "Display-only demo. Saving, sending, uploads, and live integrations are disabled." }, { status: 403 });
  }
  // Add the public website in front of the existing CRM. The physical /crm route reuses the
  // original dashboard; avoiding a rewrite back to / prevents re-entering the landing rewrite.
  if (pathname === "/" && !crmHost && ["GET", "HEAD"].includes(req.method))
    return rewrite("/showcase");
  if (pathname === "/showcase" || pathname === "/favicon.svg" || pathname.startsWith("/fonts/")) return next();
  if (pathname === "/crm/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", crmHost ? "/" : "/crm");
    return NextResponse.redirect(url);
  }
  if (PUBLIC.some((p) => pathname.startsWith(p))) return next();
  if (!isCrmShowcase() && !req.cookies.get("pharmacy_session")) {
    // Next's internal request URL can use the loopback origin behind a reverse proxy.
    // Production redirects must use the configured public origin, never that internal host.
    const base = production && process.env.APP_URL ? process.env.APP_URL : req.url;
    const url = new URL("/login", base);
    url.searchParams.set("next", pathname);
    const response = NextResponse.redirect(url);
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }
  return next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
