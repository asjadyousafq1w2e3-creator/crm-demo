import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { COLUMNS } from "@/lib/deliverable/build";

/**
 * CSV of whatever is selected, in the same column order as the client deliverable - so a slice
 * exported from a list view and the full workbook line up rather than being two shapes.
 */
export async function GET(req: NextRequest) {
  await requirePermission("registry.view");
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",").map(Number).filter(Boolean);
  if (!ids.length) return new NextResponse("nothing selected", { status: 400 });

  const rows = await prisma.pharmacy.findMany({
    where: { id: { in: ids } }, orderBy: [{ state: "asc" }, { city: "asc" }],
  });

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const maps = (p: typeof rows[number]) => {
    const q = [p.canonicalName, p.streetAddress, p.city, p.state, p.zipCode]
      .filter(Boolean).join(", ");
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
  };

  const lines = [COLUMNS.map(esc).join(",")];
  for (const p of rows) {
    lines.push([
      p.canonicalName, p.pharmacyType, p.ownerName ?? p.buyerName ?? p.picName,
      p.phone, p.email, p.website, p.streetAddress, p.city, p.county, p.state, p.zipCode,
      maps(p), p.primaryLicenseNumber, p.licenseStatus, p.numberOfLocations, p.emailSource,
      p.emailVerificationStatus.replace(/_/g, " ").toLowerCase(),
      p.verifiedAt ? p.verifiedAt.toISOString().slice(0, 10) : "",
      [p.notes, p.emailKind === "SHARED" ? "shared inbox" : null].filter(Boolean).join(" · "),
    ].map(esc).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        `attachment; filename="pharmacies-${rows.length}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
