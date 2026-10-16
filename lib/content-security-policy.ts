/** Shared by the static asset headers and the per-request HTML middleware. */
export function contentSecurityPolicy(production: boolean, nonce?: string): string {
  const scripts = production
    ? `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  return [
    "default-src 'self'", scripts, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
    "form-action 'self'", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
  ].join("; ");
}
