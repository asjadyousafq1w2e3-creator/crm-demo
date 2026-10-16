import { verifyUnsubscribeToken } from "@/lib/crypto";
import { suppress, isSuppressed } from "@/lib/campaign/suppression";
import { config } from "@/lib/config";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe confirmation. Reached without a session. The address lives inside a signed
 * token - the URL never carries a database id, and an unsigned or tampered token is refused.
 */
export default async function Unsubscribe({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const email = verifyUnsubscribeToken(token);

  async function confirm() {
    "use server";
    const addr = verifyUnsubscribeToken(token);
    if (!addr) return;
    await suppress(addr, "UNSUBSCRIBED", "unsubscribe page", "confirmed on the web form");
    redirect(`/unsubscribe/${token}?done=1`);
  }

  const already = email ? await isSuppressed(email) : false;
  const masked = email ? email.replace(/^(.).*?(@)/, "$1•••$2") : "";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-6 max-w-md w-full space-y-3">
        <div className="text-[15px] font-semibold">
          {config.company.name || "Pharmacy Outreach"}
        </div>

        {!email ? (
          <>
            <p className="text-[13px] text-bad">This unsubscribe link is not valid.</p>
            <p className="text-[12px] text-muted">
              It may have been altered in transit. Reply to the original email and the address will
              be removed manually.
            </p>
          </>
        ) : done || already ? (
          <>
            <p className="text-[13px]">
              <span className="font-medium">{masked}</span> has been unsubscribed.
            </p>
            <p className="text-[12px] text-muted">
              The address is on the permanent suppression list. No further email will be sent to it
              from any campaign, and re-importing the record will not undo this.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px]">
              Unsubscribe <span className="font-medium">{masked}</span> from all future email?
            </p>
            <p className="text-[12px] text-muted">
              This is permanent and applies across every campaign.
            </p>
            <form action={confirm}>
              <button className="btn btn-primary">Confirm unsubscribe</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
