import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { authUrl } from "@/lib/mail/gmail";
import { config } from "@/lib/config";
import { getSession } from "@/lib/auth";

export async function GET() {
  if (!(await getSession()))
    return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  if (!config.google.clientId)
    return new NextResponse(null, { status: 303,
      headers: { Location: "/settings/mailboxes?error=oauth_not_configured" } });
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("oauth_state", state, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 600,
  });
  return res;
}
