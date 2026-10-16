import { prisma } from "../db";

/**
 * Suppression is GLOBAL. Once an address is here no campaign may send to it - not a new
 * campaign, not a re-import, not a manual selection, not a different contact row that happens
 * to carry the same address.
 */
export async function suppress(email: string, reason: string, source?: string, notes?: string) {
  const addr = email.trim().toLowerCase();
  const entry = await prisma.suppressionEntry.upsert({
    where: { email: addr }, update: {},
    create: { email: addr, reason, source, notes },
  });
  // Block every queued recipient carrying this address, across all campaigns.
  await prisma.campaignRecipient.updateMany({
    where: {
      recipientEmail: { equals: addr, mode: "insensitive" },
      status: { in: ["PENDING", "QUEUED", "SCHEDULED"] },
    },
    data: { status: reason === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : "BLOCKED",
            blockReason: `suppressed (${reason})` },
  });
  const pharmacies = await prisma.pharmacy.findMany({
    where: { email: { equals: addr, mode: "insensitive" } }, select: { id: true } });
  if (pharmacies.length) {
    await prisma.pharmacy.updateMany({
      where: { id: { in: pharmacies.map((p) => p.id) } },
      data: { leadStatus: reason === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : "BOUNCED" },
    });
  }
  await prisma.auditEvent.create({
    data: { eventType: reason === "UNSUBSCRIBED" ? "CONTACT_UNSUBSCRIBED" : "EMAIL_BOUNCED",
            actor: source ?? "system", detail: addr },
  });
  return entry;
}

export async function isSuppressed(email: string) {
  return !!(await prisma.suppressionEntry.findUnique({
    where: { email: email.trim().toLowerCase() } }));
}
