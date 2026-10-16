/**
 * Only ever redirect to a path inside this application.
 *
 * The sign-in form carries a "next" parameter so an interrupted request resumes after login.
 * Taken at face value, that is an open redirect: a link to /login?next=https://example.com would
 * bounce someone off-site straight after they authenticate, which is a convincing way to harvest
 * a password on a lookalike page.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // Reject absolute URLs, protocol-relative URLs, and anything not rooted at "/".
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value)) return fallback;              // header splitting
  try {
    // Resolving against a dummy origin normalises "/a/../../b" and rejects embedded schemes.
    const url = new URL(value, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
