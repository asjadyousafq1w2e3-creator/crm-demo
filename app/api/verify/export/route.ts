import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { exportBatchCsv } from "@/lib/verify/service";

/** Hands the batch to whatever verifier the operator uses. A file, not an integration. */
export async function GET(req: NextRequest) {
  await requirePermission("verification.manage");
  const id = Number(new URL(req.url).searchParams.get("batch"));
  if (!Number.isFinite(id)) return new NextResponse("no batch", { status: 400 });

  const csv = await exportBatchCsv(id);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="email-verification-batch-${id}.csv"`,
    },
  });
}
