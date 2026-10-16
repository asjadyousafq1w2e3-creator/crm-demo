import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/crypto";
import { suppress } from "@/lib/campaign/suppression";

/**
 * RFC 8058 one-click unsubscribe endpoint. Mail clients POST here directly from the
 * List-Unsubscribe header, with no session and no user interaction, so it must succeed on its
 * own. The token carries the address under an HMAC - no database id is ever exposed.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const email = verifyUnsubscribeToken(token);
  if (!email) return new NextResponse("Invalid unsubscribe link", { status: 400 });
  await suppress(email, "UNSUBSCRIBED", "one-click", "List-Unsubscribe one-click");
  return new NextResponse("Unsubscribed", {
    status: 200, headers: { "Content-Type": "text/plain" } });
}

/** A human following the header link gets the confirmation page instead. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return new NextResponse(null, { status: 303,
                                 headers: { Location: `/unsubscribe/${token}` } });
}
