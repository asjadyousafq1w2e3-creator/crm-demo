import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForAccount } from "@/lib/mail/gmail";
import { encryptToken } from "@/lib/crypto";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** Relative Location: works on whatever origin served the page, and cannot be steered. */
const back = (q: string) =>
  new NextResponse(null, { status: 303,
                           headers: { Location: `/settings/mailboxes?${q}` } });

export async function GET(req: NextRequest) {
  if (!(await getSession()))
    return new NextResponse(null, { status: 303, headers: { Location: "/login" } });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("oauth_state")?.value;
  if (!code) return back("error=no_code");
  if (!state || state !== expected) return back("error=state_mismatch");

  try {
    const account = await exchangeCodeForAccount(code);
    if (account.missingScopes.length) return back("error=missing_scopes");
    const address = account.emailAddress;

    await prisma.mailbox.upsert({
      where: { emailAddress: address },
      update: {
        // Only the refresh token is persisted, and only encrypted.
        encryptedRefreshToken: encryptToken(account.refreshToken),
        providerAccountId: account.providerAccountId ?? null, provider: "gmail",
        status: "CONNECTED", healthStatus: "HEALTHY", lastError: null,
        connectedAt: new Date(),
      },
      create: {
        provider: "gmail", emailAddress: address, displayName: account.displayName ?? null,
        domain: address.split("@")[1] ?? null,
        encryptedRefreshToken: encryptToken(account.refreshToken),
        providerAccountId: account.providerAccountId ?? null,
        status: "CONNECTED", healthStatus: "HEALTHY", rampStage: "NEW",
        dailyLimit: config.limits.defaultMailboxDaily,
        sendingStartTime: config.schedule.start, sendingEndTime: config.schedule.end,
        timezone: config.schedule.timezone, connectedAt: new Date(),
      },
    });
    await prisma.auditEvent.create({
      data: { eventType: "MAILBOX_CONNECTED", actor: "admin", detail: address } });
    const res = back(`connected=${encodeURIComponent(address)}`);
    res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 80))}`);
  }
}
