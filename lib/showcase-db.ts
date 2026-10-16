/**
 * Read-only sample data for the existing Prisma queries. Original pages/components render
 * unchanged. This module never opens a database connection or stores a visitor's changes.
 */
import { Prisma } from "@prisma/client";
import { SHOWCASE_EMAIL } from "./showcase-mode";

type Row = Record<string, unknown>;
type Query = Record<string, unknown>;
const models = Prisma.dmmf.datamodel.models;
const schema = new Map(models.map(m => [m.name, m]));
const data: Record<string, Row[]> = Object.fromEntries(models.map(m => [m.name, []]));
const now = new Date();
const ago = (days: number, hours = 0) => new Date(now.getTime() - (days * 24 + hours) * 36e5);

function add(model: string, patch: Row): Row {
  const row: Row = {};
  for (const field of schema.get(model)!.fields) {
    if (field.kind === "object") continue;
    const fallback = field.default;
    row[field.name] = field.isList ? []
      : fallback !== undefined && (typeof fallback !== "object" || fallback === null) ? fallback
      : !field.isRequired ? null
      : field.type === "DateTime" ? ago(3)
      : field.type === "Boolean" ? false
      : ["Int", "Float", "Decimal", "BigInt"].includes(field.type) ? 0
      : field.type === "Json" ? null : "";
  }
  Object.assign(row, { id: data[model].length + 1 }, patch);
  for (const field of schema.get(model)!.fields) {
    if (field.type === "String" && row[field.name] instanceof Date)
      row[field.name] = (row[field.name] as Date).toISOString().slice(0, 10);
  }
  data[model].push(row);
  return row;
}

const places = [["Austin", "TX", "78701"], ["Denver", "CO", "80202"], ["Portland", "OR", "97201"], ["Tampa", "FL", "33602"], ["Charlotte", "NC", "28202"], ["Phoenix", "AZ", "85004"]];
const names = ["Maple & Main Pharmacy", "Greenleaf Community Pharmacy", "Oakridge Family Pharmacy", "Harborview Pharmacy", "Cedar Grove Apothecary", "Sunrise Neighborhood Pharmacy", "Willow Creek Pharmacy", "Parkside Wellness Pharmacy", "Village Apothecary", "Palm & Pine Pharmacy", "Bluebird Community Pharmacy", "Desert Bloom Pharmacy", "Northstar Family Pharmacy", "Evergreen Independent Pharmacy", "Riverbend Pharmacy", "Coastal Care Pharmacy", "Magnolia Pharmacy", "Copper Canyon Pharmacy", "Juniper Health Pharmacy", "Mountain View Apothecary", "Fern & Field Pharmacy", "Seabreeze Community Pharmacy", "Dogwood Family Pharmacy", "Saguaro Wellness Pharmacy"];
const contacts = ["Sarah Miller", "James Wilson", "Emily Chen", "Michael Reed", "Olivia Brooks", "Daniel Patel"];

add("AppUser", { id: 1, email: SHOWCASE_EMAIL, name: "Jamie Demo", role: "OWNER", status: "ACTIVE", mustChangePassword: false, passwordHash: "display-only-no-password-hash", lastLoginAt: now });
add("AppUser", { email: "alex@pharmacyfirst.example", name: "Alex Morgan", role: "AGENT", status: "ACTIVE", mustChangePassword: false, passwordHash: "display-only-no-password-hash" });
for (const [key, value] of Object.entries({ "company.name": "Pharmacy First · Sample workspace", "company.address": "100 Example Avenue, Austin, TX 78701 (fictional)", "company.website": "https://pharmacyfirst.example", "company.replyTo": "hello@pharmacyfirst.example", "system.suspended": "false" })) add("AppSetting", { key, value });
add("ImportBatch", { label: "Sample pharmacy network", source: "Fictional demonstration dataset", sourceType: "STATE_BOARD", jurisdiction: "US", status: "OK", datasetDate: ago(12), startedAt: ago(10), completedAt: ago(10), recordsReceived: 28, recordsAccepted: 24, recordsRejected: 2, recordsReviewRequired: 5, duplicatesPrevented: 2, detail: "Fictional records for the public frontend showcase." });
for (let i = 0; i < 2; i++) add("Mailbox", { emailAddress: `${i ? "partnerships" : "hello"}@pharmacyfirst.example`, displayName: i ? "Partnerships" : "Community outreach", provider: "MOCK", domain: "pharmacyfirst.example", status: "CONNECTED", healthStatus: "HEALTHY", rampStage: "ESTABLISHED", dailyLimit: 20, sentToday: 4 + i, sentDate: now.toISOString().slice(0, 10), sendingStartTime: "09:00", sendingEndTime: "16:00", timezone: "America/New_York", connectedAt: ago(10), lastSyncedAt: ago(0, 1) });
names.forEach((name, i) => {
  const [city, state, zipCode] = places[i % places.length];
  const verified = i < 16;
  const status = verified ? "VERIFIED" : i < 21 ? "NEEDS_REVIEW" : "READY_FOR_VERIFICATION";
  const email = `contact${i + 1}@pharmacyfirst.example`;
  const p = add("Pharmacy", { canonicalName: name, normalizedName: name.toLowerCase(), pharmacyType: i % 5 === 0 ? "COMPOUNDING" : "COMMUNITY", streetAddress: `${100+i} Example Lane`, city, state, zipCode, county: "Example County", phone: `+120255501${String(i).padStart(2, "0")}`, email, website: "https://pharmacyfirst.example", ownerName: contacts[i % 6], picName: contacts[i % 6], primaryLicenseNumber: `DEMO-${state}-${1000+i}`, licenseStatus: "ACTIVE", licenseType: "COMMUNITY", npi: `100000${String(i).padStart(4, "0")}`, numberOfLocations: 1, dataStatus: "READY_FOR_VERIFICATION", verificationStatus: status, campaignEligible: verified, ownershipStatus: "INDEPENDENT", operationalStatus: "OPEN", emailVerificationStatus: verified ? "VALID" : "NOT_CHECKED", emailKind: i % 3 ? "SHARED" : "NAMED", emailSource: "Fictional demo dataset", emailCheckedAt: verified ? ago(3) : null, verifiedAt: verified ? ago(2) : null, notes: "Fictional sample pharmacy. This public showcase demonstrates the original CRM interface; no real business is represented.", leadStatus: ["NEW", "CONTACTED", "INTERESTED", "FOLLOW_UP"][i % 4], crmStatus: "NEW", status: "ACTIVE", sourceMissing: false, importBatchId: 1, assignedMailboxId: i % 2 + 1, licenseVerificationStatus: verified ? "CONFIRMED" : "NOT_CHECKED", ownershipVerificationStatus: verified ? "CONFIRMED" : "NOT_CHECKED", operationalVerificationStatus: verified ? "CONFIRMED" : "NOT_CHECKED", pharmacyTypeVerificationStatus: verified ? "CONFIRMED" : "NOT_CHECKED", contactVerificationStatus: verified ? "CONFIRMED" : "NOT_CHECKED" });
  add("PharmacyContact", { pharmacyId: p.id, name: p.ownerName, role: "OWNER", email, phone: p.phone, sourceId: "DEMO", sourceType: "MANUAL", retrievedAt: ago(10), emailStatus: verified ? "VALID" : "NOT_CHECKED", isPrimary: true });
  add("PharmacyIdentifier", { pharmacyId: p.id, kind: "LICENSE", value: p.primaryLicenseNumber, jurisdiction: state, sourceId: "DEMO", recordedAt: ago(10) });
  for (const field of ["canonicalName", "email", "phone", "streetAddress", "ownerName"]) add("FieldProvenance", { pharmacyId: p.id, field, value: p[field], sourceId: "DEMO", sourceType: "MANUAL", authorityRank: 1, isSelected: true, datasetDate: ago(12), retrievedAt: ago(10) });
  for (const dimension of ["LICENSE", "OWNERSHIP", "OPERATIONAL_STATUS", "PHARMACY_TYPE", "CONTACT"]) {
    const task = add("VerificationTask", { pharmacyId: p.id, verificationType: dimension, status: verified ? "COMPLETED" : "NOT_STARTED", priority: i % 3 ? "NORMAL" : "HIGH", trigger: "IMPORT", batchId: 1, completedAt: verified ? ago(2) : null, result: verified ? "CONFIRMED" : null });
    if (verified) add("VerificationResult", { taskId: task.id, pharmacyId: p.id, verificationType: dimension, result: "CONFIRMED", verifiedBy: "Demo operator", verifiedAt: ago(2), evidenceSource: "Fictional demonstration evidence", notes: "Sample status only; no real business has been verified." });
  }
});
for (const [i, name] of ["Independent pharmacy introductions", "Community partnership follow-up", "Welcome to the network"].entries()) {
  add("Campaign", { name, subject: "A new connection for {{pharmacy_name}}", bodyText: "Hi {{owner_name}},\n\nWe’d love to learn more about your community pharmacy and introduce our team.\n\nWould you be open to a short conversation?\n\nThe Pharmacy First team\n\nFictional demo message — never sent.", bodyHtml: "<p>Hello,</p><p>Let’s connect and learn more about your community pharmacy.</p><p>Fictional demo message — never sent.</p>", signature: "Pharmacy First · Demonstration", status: ["RUNNING", "COMPLETED", "DRAFT"][i], timezone: "America/New_York", sendingDays: "1,2,3,4,5", sendingStartTime: "09:00", sendingEndTime: "16:00", dailyLimit: 20, sentToday: 4, sentDate: now.toISOString().slice(0, 10), useAssignedMailbox: false, startedAt: i < 2 ? ago(4) : null, completedAt: i === 1 ? ago(1) : null });
  add("CampaignMailbox", { campaignId: i + 1, mailboxId: 1 });
  add("CampaignStep", { campaignId: i + 1, stepNumber: 1, waitDays: 0, subject: "A little introduction", bodyText: "Hello from Pharmacy First. This is a sample message.", bodyHtml: "<p>A sample introduction.</p>", active: true });
  add("CampaignStep", { campaignId: i + 1, stepNumber: 2, waitDays: 3, subject: "A thoughtful follow-up", bodyText: "Following up on our sample introduction.", bodyHtml: "<p>A sample follow-up.</p>", active: true });
}
for (let i = 0; i < 18; i++) {
  const status = ["SENT", "REPLIED", "QUEUED", "SENT", "SCHEDULED", "PENDING"][i % 6];
  add("CampaignRecipient", { campaignId: i < 12 ? 1 : 2, pharmacyId: i + 1, mailboxId: 1, recipientEmail: data.Pharmacy[i].email, status, idempotencyKey: `demo-${i+1}`, stepNumber: 1, attempts: status === "SENT" || status === "REPLIED" ? 1 : 0, sentAt: status === "SENT" || status === "REPLIED" ? ago(1) : null, repliedAt: status === "REPLIED" ? ago(0, 2) : null, scheduledAt: status === "SCHEDULED" ? ago(-1) : null });
}
const replies = ["Thanks for the introduction. We’d love to hear a little more about your community partnership. Could we find a time next week?", "This sounds interesting. We’re a family-owned pharmacy and community is a big part of what we do. Please share a short overview.", "Hello! Tuesday afternoons work best for a call. Looking forward to getting to know your team.", "Thank you for following up. We’ll review the sample overview and discuss the next steps."];
replies.forEach((text, i) => {
  const p = data.Pharmacy[i];
  add("Conversation", { pharmacyId: p.id, campaignId: 1, recipientId: i + 1, mailboxId: 1, providerThreadId: `demo-thread-${i+1}`, subject: "Re: A new connection for your pharmacy", contactEmail: p.email, unread: i < 2, lastMessageAt: ago(0, i + 1), category: "INTERESTED", categoryReason: "Fictional sample reply", categorySource: "MANUAL", state: "OPEN", assignedToId: 2 });
  add("EmailMessage", { conversationId: i + 1, mailboxId: 1, direction: "INBOUND", providerMessageId: `demo-message-${i+1}`, fromAddress: p.email, toAddress: "hello@pharmacyfirst.example", subject: "Re: A new connection for your pharmacy", bodyText: text, bodyHtml: `<p>${text}</p>`, isBounce: false, receivedAt: ago(0, i + 1) });
});
for (let i = 0; i < 6; i++) add("FollowUp", { pharmacyId: i + 1, conversationId: i < 4 ? i + 1 : null, dueAt: ago(i < 2 ? 1 : -i), status: "PENDING", note: ["Share the partnership overview", "Schedule an introductory call", "Send a short introduction", "Follow up on the proposal", "Review the contact details", "Prepare the welcome message"][i], kind: i % 2 ? "CALL" : "EMAIL", priority: i < 2 ? "HIGH" : "NORMAL", assignedToId: 2, createdBy: "Jamie Demo", snoozeCount: 0 });
add("EmailVerificationBatch", { name: "Sample verification round", status: "APPLIED", scope: {}, provider: "DEMO", total: 16, checkedCount: 16, valid: 16, invalid: 0, risky: 0, catchAll: 0, unknown: 0, createdById: 1, exportedAt: ago(4), appliedAt: ago(3) });
for (let i = 0; i < 16; i++) add("EmailVerificationItem", { batchId: 1, pharmacyId: i + 1, email: data.Pharmacy[i].email, result: "VALID", detail: "Fictional sample result; no verifier was called." });
add("ImportJob", { name: "Sample community pharmacy network", sourceType: "STATE_BOARD", jurisdiction: "US", datasetDate: ago(12), status: "COMMITTED", declaredColumns: ["pharmacy_name", "email", "city", "state"], mapping: { name: "pharmacy_name", email: "email", city: "city", state: "state" }, fileName: "fictional_pharmacy_sample.csv", fileFormat: "CSV", fileBytes: 4800, totalRows: 24, analysis: { accepted: 16, review: 8, excluded: 0, totalRows: 24, withEmail: 24, withPhone: 24, sharedInboxes: 16, duplicates: 0, ruleCounts: {}, byState: { TX: 4, CO: 4, OR: 4, FL: 4, NC: 4, AZ: 4 } }, batchId: 1, createdById: 1, committedAt: ago(10) });
data.Pharmacy.forEach((p, i) => add("ImportRow", { jobId: 1, rowNumber: i + 1, raw: { pharmacy_name: p.canonicalName, email: p.email, city: p.city, state: p.state }, cleaned: { name: p.canonicalName, email: p.email, city: p.city, state: p.state }, decision: i < 16 ? "ACCEPTED" : "REVIEW", reason: "Fictional demonstration record", notes: [], pharmacyId: p.id }));
for (let i = 0; i < 14; i++) add("AuditEvent", { eventType: ["IMPORT_COMPLETED", "VERIFICATION_RECORDED", "CAMPAIGN_CREATED", "FOLLOW_UP_CREATED"][i % 4], pharmacyId: i + 1, actor: "Jamie Demo", actorId: 1, actorRole: "OWNER", detail: "Illustrative sample activity — no live action was performed.", createdAt: ago(i) });
add("SuppressionEntry", { email: "do-not-contact@pharmacyfirst.example", reason: "UNSUBSCRIBED", source: "DEMO", notes: "Fictional sample suppression entry." });
add("EmailTemplate", { name: "A friendly pharmacy introduction", kind: "INTRODUCTION", subject: "A new connection for {{pharmacy_name}}", bodyText: "Hello {{owner_name}},\n\nWe’d love to learn more about your pharmacy.\n\nPharmacy First", bodyHtml: "<p>A sample pharmacy introduction.</p>", purpose: "Fictional sample template", timesUsed: 2, createdBy: "Jamie Demo" });

function related(model: string, row: Row, key: string) {
  const field = schema.get(model)?.fields.find(f => f.name === key && f.kind === "object");
  if (!field) return null;
  let rows: Row[];
  if (field.relationFromFields?.length) {
    rows = data[field.type].filter(r => field.relationFromFields!.every((from, i) => row[from] !== null && row[from] === r[field.relationToFields![i]]));
  } else {
    const inverse = schema.get(field.type)?.fields.find(f => f.kind === "object" && f.relationName === field.relationName && f.relationFromFields?.length);
    rows = inverse ? data[field.type].filter(r => inverse.relationFromFields!.every((from, i) => r[from] !== null && r[from] === row[inverse.relationToFields![i]])) : [];
  }
  return { model: field.type, many: field.isList, rows };
}
function compare(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object" || expected instanceof Date) return actual instanceof Date && expected instanceof Date ? +actual === +expected : actual === expected;
  const filter = expected as Query;
  const value = filter.mode === "insensitive" && typeof actual === "string" ? actual.toLowerCase() : actual;
  const normal = (v: unknown) => filter.mode === "insensitive" && typeof v === "string" ? v.toLowerCase() : v;
  return Object.entries(filter).every(([op, v]) => {
    if (op === "mode") return true;
    if (op === "equals") return compare(value, normal(v));
    if (op === "not") return !compare(value, normal(v));
    if (op === "in" || op === "notIn") return (v as unknown[]).some(x => compare(value, normal(x))) === (op === "in");
    if (["contains", "startsWith", "endsWith"].includes(op)) return typeof value === "string" && (op === "contains" ? value.includes(String(normal(v))) : op === "startsWith" ? value.startsWith(String(normal(v))) : value.endsWith(String(normal(v))));
    if (actual == null) return false;
    const a = actual instanceof Date ? +actual : actual as number;
    const b = v instanceof Date ? +v : v as number;
    if (op === "gte") return a >= b;
    if (op === "gt") return a > b;
    if (op === "lte") return a <= b;
    if (op === "lt") return a < b;
    return false;
  });
}
function matches(model: string, row: Row, where: Query = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (["AND", "OR", "NOT"].includes(key)) {
      const list = Array.isArray(value) ? value : [value];
      return key === "OR" ? list.some(w => matches(model, row, w)) : key === "NOT" ? list.every(w => !matches(model, row, w)) : list.every(w => matches(model, row, w));
    }
    const rel = related(model, row, key);
    if (rel) {
      if (value === null) return rel.rows.length === 0;
      const f = value as Query;
      if ("some" in f) return rel.rows.some(r => matches(rel.model, r, f.some as Query));
      if ("none" in f) return !rel.rows.some(r => matches(rel.model, r, f.none as Query));
      if ("every" in f) return rel.rows.every(r => matches(rel.model, r, f.every as Query));
      if ("isNot" in f) return f.isNot === null ? rel.rows.length > 0 : !rel.rows.some(r => matches(rel.model, r, f.isNot as Query));
      return rel.rows.some(r => matches(rel.model, r, (f.is || f) as Query));
    }
    if (!(key in row) && typeof value === "object" && value) return matches(model, row, value as Query);
    return compare(row[key], value);
  });
}
function ordered(rows: Row[], orderBy?: unknown): Row[] {
  if (!orderBy) return rows;
  const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Query[];
  return [...rows].sort((a, b) => {
    for (const order of orders) for (const [key, direction] of Object.entries(order)) {
      const av = a[key] instanceof Date ? +(a[key] as Date) : a[key];
      const bv = b[key] instanceof Date ? +(b[key] as Date) : b[key];
      const dir = typeof direction === "object" && direction ? (direction as Query).sort : direction;
      const diff = av === bv ? 0 : av == null ? 1 : bv == null ? -1 : av < bv ? -1 : 1;
      if (diff) return diff * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}
function query(model: string, args: Query = {}, source = data[model]): Row[] {
  let rows = ordered(source.filter(r => matches(model, r, args.where as Query)), args.orderBy);
  if (args.distinct) {
    const keys = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
    const seen = new Set();
    rows = rows.filter(r => { const key = JSON.stringify(keys.map(k => r[String(k)])); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return rows.slice(Number(args.skip || 0), args.take === undefined ? undefined : Number(args.skip || 0) + Number(args.take));
}
function project(model: string, row: Row, args: Query = {}, depth = 0): Row {
  const select = args.select as Query | undefined;
  const include = args.include as Query | undefined;
  const out: Row = select ? {} : { ...row };
  for (const [key, option] of Object.entries(select || include || {})) {
    if (!option) continue;
    if (key === "_count") {
      const fields = option === true ? Object.fromEntries(schema.get(model)!.fields.filter(f => f.kind === "object" && f.isList).map(f => [f.name, true])) : (option as Query).select as Query;
      out._count = Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => {
        const rel = related(model, row, k);
        return [k, rel ? query(rel.model, typeof v === "object" ? v as Query : {}, rel.rows).length : 0];
      }));
      continue;
    }
    const rel = related(model, row, key);
    if (rel && depth < 8) {
      const spec = option === true ? {} : option as Query;
      const list = query(rel.model, spec, rel.rows).map(r => project(rel.model, r, spec, depth + 1));
      out[key] = rel.many ? list : list[0] || null;
    } else if (!rel) out[key] = row[key];
  }
  return out;
}
function aggregate(rows: Row[], args: Query): Row {
  const result: Row = {};
  for (const op of ["_count", "_sum", "_avg", "_min", "_max"]) {
    const fields = args[op];
    if (!fields) continue;
    if (op === "_count" && fields === true) { result[op] = rows.length; continue; }
    result[op] = Object.fromEntries(Object.keys(fields as Query).map(key => {
      const values = rows.map(r => r[key]).filter(v => v !== null && v !== undefined);
      const sum = values.reduce<number>((n, v) => n + Number(v), 0);
      return [key, op === "_count" ? key === "_all" ? rows.length : values.length : op === "_sum" ? sum : op === "_avg" ? values.length ? sum / values.length : null : values.length ? [...values].sort((a,b) => a! < b! ? -1 : 1)[op === "_min" ? 0 : values.length - 1] : null];
    }));
  }
  return result;
}
export function createShowcaseClient() {
  const client: Record<string, unknown> = {};
  for (const model of models) {
    client[model.name[0].toLowerCase() + model.name.slice(1)] = {
      findMany: async (args: Query = {}) => query(model.name, args).map(r => project(model.name, r, args)),
      findFirst: async (args: Query = {}) => { const row = query(model.name, args)[0]; return row ? project(model.name, row, args) : null; },
      findUnique: async (args: Query = {}) => { const row = query(model.name, args)[0]; return row ? project(model.name, row, args) : null; },
      count: async (args: Query = {}) => query(model.name, args).length,
      aggregate: async (args: Query = {}) => aggregate(query(model.name, args), args),
      groupBy: async (args: Query) => {
        const groups = new Map<string, Row[]>();
        const by = args.by as string[];
        for (const row of query(model.name, { where: args.where })) { const key = JSON.stringify(by.map(k => row[k])); groups.set(key, [...(groups.get(key) || []), row]); }
        const rows = [...groups.values()].map(group => ({ ...Object.fromEntries(by.map(k => [k, group[0][k]])), ...aggregate(group, args) }));
        return ordered(rows, args.orderBy).slice(0, args.take === undefined ? undefined : Number(args.take));
      },
      ...Object.fromEntries(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].map(method => [method, async () => { throw new Error("Display-only demo: saving and live operations are disabled."); }])),
    };
  }
  client.$queryRaw = async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("audit_event")) return Array.from({ length: 14 }, (_, i) => ({ day: ago(i).toISOString().slice(0, 10), n: BigInt(i % 4 + 1) }));
    if (/SELECT\s+1\b/i.test(sql)) return [{ "?column?": 1 }];
    throw new Error("Display-only demo: SQL operations are disabled.");
  };
  client.$connect = async () => undefined;
  client.$disconnect = async () => undefined;
  return client;
}
