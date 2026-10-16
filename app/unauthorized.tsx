import Link from "next/link";

/** Rendered with a real 401 when there is no live session. */
export default function Unauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="badge tone-neutral mb-3">401 · Signed out</div>
        <h1 className="text-[19px] font-semibold tracking-tight">Your session has ended</h1>
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          Sessions last 12 hours, and a suspended account stops working immediately. Sign in again
          to continue.
        </p>
        <Link href="/login" className="btn btn-primary mt-5">Sign in</Link>
      </div>
    </div>
  );
}
