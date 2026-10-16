"use client";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Error boundary for the CRM. Its main job is turning a server-side permission refusal into a
 * plain explanation rather than a stack trace - a viewer who crafts a POST should be told no,
 * not shown the internals.
 */
export default function CrmError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  const forbidden = error.message.startsWith("FORBIDDEN");
  const permission = forbidden ? error.message.replace("FORBIDDEN: ", "") : null;
  const unauthenticated = error.message === "UNAUTHENTICATED";

  return (
    <div className="max-w-lg mx-auto py-16 text-center">
      <div className={`badge ${forbidden ? "tone-warn" : "tone-bad"} mb-3`}>
        {forbidden ? "Not permitted" : unauthenticated ? "Signed out" : "Something went wrong"}
      </div>
      <h1 className="text-[18px] font-semibold tracking-tight">
        {forbidden ? "Your role does not allow that action"
          : unauthenticated ? "Your session has ended"
          : "That request could not be completed"}
      </h1>
      <p className="text-[13px] text-muted mt-2 leading-relaxed">
        {forbidden ? (
          <>This action needs the <code className="text-ink">{permission}</code> permission. Ask an
          owner or admin if you need it — the check runs on the server, so nothing was changed.</>
        ) : unauthenticated ? (
          "Sign in again to continue. Sessions last 12 hours, and a suspended account ends immediately."
        ) : (
          "The error has been logged to the server console. Nothing was partially applied — actions either complete or roll back."
        )}
      </p>
      <div className="flex items-center justify-center gap-2 mt-5">
        {unauthenticated
          ? <Link href="/login" className="btn btn-primary">Sign in</Link>
          : <button onClick={reset} className="btn btn-primary">Try again</button>}
        <Link href="/" className="btn">Back to dashboard</Link>
      </div>
    </div>
  );
}
