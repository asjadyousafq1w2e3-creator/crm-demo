import Link from "next/link";

/** Rendered with a real 403 when a signed-in user reaches something their role does not cover. */
export default function Forbidden() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="badge tone-warn mb-3">403 · Not permitted</div>
        <h1 className="text-[19px] font-semibold tracking-tight">
          Your role does not cover this page
        </h1>
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          The check runs on the server, so nothing was read and nothing was changed. If you need
          access, ask an owner or an admin to adjust your role.
        </p>
        <div className="flex items-center justify-center gap-2 mt-5">
          <Link href="/" className="btn btn-primary">Back to dashboard</Link>
          <Link href="/account" className="btn">See what your role allows</Link>
        </div>
      </div>
    </div>
  );
}
