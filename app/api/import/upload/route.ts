import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { isSameOrigin } from "@/lib/config";
import { actorOf } from "@/lib/audit";
import { attachFile, MAX_UPLOAD_BYTES } from "@/lib/import/service";

/**
 * File upload. A route handler rather than a server action because server actions cap request
 * bodies well below the size a state roster reaches, and silently truncating an import would be
 * the worst possible failure here.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // The session cookie is SameSite=Lax, so a cross-site POST arrives without it and fails the
  // permission check anyway. This makes that second, and explicit.
  if (!isSameOrigin(req.headers))
    return new NextResponse("cross-origin request refused", { status: 403 });
  const session = await requirePermission("verification.manage");

  const form = await req.formData();
  const jobId = Number(form.get("jobId"));
  const file = form.get("file");

  const back = (params: string) =>
    new NextResponse(null, { status: 303,
                             headers: { Location: `/data/import/${jobId}?${params}` } });

  if (!Number.isFinite(jobId)) return back("error=no+import+selected");
  if (!(file instanceof File) || file.size === 0) return back("error=choose+a+file");
  if (file.size > MAX_UPLOAD_BYTES)
    return back(`error=${encodeURIComponent(
      `the file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MB`)}`);

  const buffer = Buffer.from(await file.arrayBuffer());
  const r = await attachFile(jobId, file.name, buffer, actorOf(session));
  if (!r.ok) return back(`error=${encodeURIComponent(r.reason)}`);
  return back("uploaded=1");
}
