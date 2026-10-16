import { NextResponse, type NextRequest } from "next/server";
import { bulkAction } from "@/lib/registry/actions";
import { isSameOrigin } from "@/lib/config";

/**
 * Bulk actions post here rather than calling a server action directly, so the selection can be
 * submitted from an ordinary form and a refusal lands back on the list with its reason.
 */
export async function POST(req: NextRequest) {
  // Suppressing or excluding a selection is destructive enough to be worth refusing outright
  // when the request did not come from this application, rather than relying only on the
  // SameSite cookie to have withheld the session.
  if (!isSameOrigin(req.headers))
    return new NextResponse("cross-origin request refused", { status: 403 });
  const form = await req.formData();
  // bulkAction redirects on every path, which is how it returns.
  await bulkAction(form);
}
