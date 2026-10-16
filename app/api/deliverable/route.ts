import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { buildDeliverable } from "@/lib/deliverable/build";
import { toCsv, toWorkbook } from "@/lib/deliverable/excel";
import { prisma } from "@/lib/db";

/**
 * Produces the client's file. Excel by default; `format=csv&tab=N` hands back one tab for Sheets.
 */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  await requirePermission("registry.view");
  const url = new URL(req.url);
  const states = url.searchParams.getAll("state").filter(Boolean);
  const sampleSize = Number(url.searchParams.get("sample")) || undefined;

  const deliverable = await buildDeliverable({ states, sampleSize });

  // Duplicates prevented comes from import accounting, not from the records themselves.
  const batches = await prisma.importBatch.aggregate({ _sum: { duplicatesPrevented: true } });
  deliverable.summary.totalDuplicatesRemoved = batches._sum.duplicatesPrevented ?? 0;

  const stamp = new Date().toISOString().slice(0, 10);
  const label = sampleSize ? `sample-${sampleSize}` : states.length ? states.join("-") : "all-states";

  if (url.searchParams.get("format") === "csv") {
    const index = Number(url.searchParams.get("tab") ?? 0);
    const sheet = deliverable.sheets[index];
    if (!sheet) return new NextResponse("no such tab", { status: 400 });
    return new NextResponse(toCsv(sheet), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="${sheet.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp}.csv"`,
      },
    });
  }

  const buffer = await toWorkbook(deliverable);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="verified-independent-pharmacies-${label}-${stamp}.xlsx"`,
    },
  });
}
