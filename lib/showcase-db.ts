/**
 * Read-only registry snapshot and sample activity for the existing Prisma queries. Original pages/components render
 * unchanged. This module never opens a database connection or stores a visitor's changes.
 */
import { Prisma } from "@prisma/client";
import { SHOWCASE_EMAIL } from "./showcase-mode";
import registry from "./demo-data/pharmacies.json";

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
    if (field.type === "DateTime" && typeof row[field.name] === "string")
      row[field.name] = new Date(row[field.name] as string);
    if (field.type === "String" && row[field.name] instanceof Date)
      row[field.name] = (row[field.name] as Date).toISOString().slice(0, 10);
  }
  data[model].push(row);
  return row;
}

const pharmacyCount = registry.records.length;
const snapshotDate = new Date(`${registry.snapshotDate}T00:00:00Z`);
const importMapping: Record<string, string> = {
  name: "canonicalName", streetAddress: "streetAddress", city: "city", state: "state",
  zipCode: "zipCode", phone: "phone", email: "email", website: "website",
  ownerName: "ownerName", notes: "notes",
};
const importValues = (pharmacy: Row) => Object.fromEntries(
  Object.values(importMapping).map(field => [field, pharmacy[field]])
);
const byState = registry.records.reduce<Record<string, number>>((counts, pharmacy) => {
  if (pharmacy.state) counts[pharmacy.state] = (counts[pharmacy.state] || 0) + 1;
  return counts;
}, {});
const demoAddress = (index: number) => `sample-${index + 1}@expressdiabetics.example`;

add("AppUser", { id: 1, email: SHOWCASE_EMAIL, name: "Jamie Demo", role: "OWNER", status: "ACTIVE", mustChangePassword: false, passwordHash: "display-only-no-password-hash", lastLoginAt: now });
add("AppUser", { email: "alex@expressdiabetics.example", name: "Alex Morgan", role: "AGENT", status: "ACTIVE", mustChangePassword: false, passwordHash: "display-only-no-password-hash" });
for (const [key, value] of Object.entries({ "company.name": "expressdiabetics", "company.address": "100 Example Avenue, Austin, TX 78701 (fictional)", "company.website": "https://expressdiabetics.example", "company.replyTo": "hello@expressdiabetics.example", "system.suspended": "false" })) add("AppSetting", { key, value });
add("ImportBatch", { label: "Original pharmacy registry", source: "Original CRM snapshot", sourceType: "MANUAL", jurisdiction: "US", status: "OK", datasetDate: ago(1), startedAt: ago(1), completedAt: ago(1), recordsReceived: pharmacyCount, recordsAccepted: pharmacyCount, recordsRejected: 0, recordsReviewRequired: 0, duplicatesPrevented: 0 });
for (let i = 0; i < 2; i++) add("Mailbox", { emailAddress: `${i ? "partnerships" : "hello"}@expressdiabetics.example`, displayName: i ? "Partnerships" : "Community outreach", provider: "MOCK", domain: "expressdiabetics.example", status: "CONNECTED", healthStatus: "HEALTHY", rampStage: "ESTABLISHED", dailyLimit: 20, sentToday: 4 + i, sentDate: now.toISOString().slice(0, 10), sendingStartTime: "09:00", sendingEndTime: "16:00", timezone: "America/New_York", connectedAt: ago(10), lastSyncedAt: ago(0, 1) });
registry.records.forEach((pharmacy) => {
  // Business records are published with the owner's approval. Demo IDs are local;
  // real user accounts, mailbox credentials and operational history are not imported.
  const { contacts, identifiers, ...record } = pharmacy;
  const p = add("Pharmacy", { ...record, importBatchId: 1 });
  for (const contact of contacts) add("PharmacyContact", { ...contact, pharmacyId: p.id });
  for (const identifier of identifiers) add("PharmacyIdentifier", { ...identifier, pharmacyId: p.id });
  for (const field of ["canonicalName", "streetAddress", "city", "state", "zipCode", "phone", "email", "website", "ownerName", "picName", "buyerName", "primaryLicenseNumber", "npi", "ncpdpId"]) {
    if (p[field]) add("FieldProvenance", { pharmacyId: p.id, field, value: p[field], sourceId: "ORIGINAL_CRM", sourceType: "MANUAL", authorityRank: 1, isSelected: true, datasetDate: snapshotDate, retrievedAt: snapshotDate });
  }
  for (const [dimension, field] of Object.entries({ LICENSE: "licenseVerificationStatus", OWNERSHIP: "ownershipVerificationStatus", OPERATIONAL_STATUS: "operationalVerificationStatus", PHARMACY_TYPE: "pharmacyTypeVerificationStatus", CONTACT: "contactVerificationStatus" })) {
    add("VerificationTask", { pharmacyId: p.id, verificationType: dimension, status: p[field], priority: "NORMAL", trigger: "IMPORT", batchId: 1 });
  }
});
for (const [i, name] of ["Independent pharmacy introductions", "Community partnership follow-up", "Welcome to the network"].entries()) {
  add("Campaign", { name, subject: "A new connection for {{pharmacy_name}}", bodyText: "Hi {{owner_name}},\n\nWe’d love to learn more about your community pharmacy and introduce our team.\n\nWould you be open to a short conversation?\n\nThe expressdiabetics team\n\nFictional demo message — never sent.", bodyHtml: "<p>Hello,</p><p>Let’s connect and learn more about your community pharmacy.</p><p>Fictional demo message — never sent.</p>", signature: "expressdiabetics · Demonstration", status: ["RUNNING", "COMPLETED", "DRAFT"][i], timezone: "America/New_York", sendingDays: "1,2,3,4,5", sendingStartTime: "09:00", sendingEndTime: "16:00", dailyLimit: 20, sentToday: 4, sentDate: now.toISOString().slice(0, 10), useAssignedMailbox: false, startedAt: i < 2 ? ago(4) : null, completedAt: i === 1 ? ago(1) : null });
  add("CampaignMailbox", { campaignId: i + 1, mailboxId: 1 });
  add("CampaignStep", { campaignId: i + 1, stepNumber: 1, waitDays: 0, subject: "A little introduction", bodyText: "Hello from expressdiabetics. This is a sample message.", bodyHtml: "<p>A sample introduction.</p>", active: true });
  add("CampaignStep", { campaignId: i + 1, stepNumber: 2, waitDays: 3, subject: "A thoughtful follow-up", bodyText: "Following up on our sample introduction.", bodyHtml: "<p>A sample follow-up.</p>", active: true });
}
for (let i = 0; i < 18; i++) {
  const status = ["SENT", "REPLIED", "QUEUED", "SENT", "SCHEDULED", "PENDING"][i % 6];
  add("CampaignRecipient", { campaignId: i < 12 ? 1 : 2, pharmacyId: i + 1, mailboxId: 1, recipientEmail: demoAddress(i), status, idempotencyKey: `demo-${i+1}`, stepNumber: 1, attempts: status === "SENT" || status === "REPLIED" ? 1 : 0, sentAt: status === "SENT" || status === "REPLIED" ? ago(1) : null, repliedAt: status === "REPLIED" ? ago(0, 2) : null, scheduledAt: status === "SCHEDULED" ? ago(-1) : null });
}
const replies = ["Thanks for the introduction. We’d love to hear a little more about your community partnership. Could we find a time next week?", "This sounds interesting. We’re a family-owned pharmacy and community is a big part of what we do. Please share a short overview.", "Hello! Tuesday afternoons work best for a call. Looking forward to getting to know your team.", "Thank you for following up. We’ll review the sample overview and discuss the next steps."];
replies.forEach((text, i) => {
  const p = data.Pharmacy[i];
  add("Conversation", { pharmacyId: p.id, campaignId: 1, recipientId: i + 1, mailboxId: 1, providerThreadId: `demo-thread-${i+1}`, subject: "Re: A new connection for your pharmacy", contactEmail: demoAddress(i), unread: i < 2, lastMessageAt: ago(0, i + 1), category: "INTERESTED", categoryReason: "Fictional sample reply", categorySource: "MANUAL", state: "OPEN", assignedToId: 2 });
  add("EmailMessage", { conversationId: i + 1, mailboxId: 1, direction: "INBOUND", providerMessageId: `demo-message-${i+1}`, fromAddress: demoAddress(i), toAddress: "hello@expressdiabetics.example", subject: "Re: A new connection for your pharmacy", bodyText: text, bodyHtml: `<p>${text}</p>`, isBounce: false, receivedAt: ago(0, i + 1) });
});
for (let i = 0; i < 6; i++) add("FollowUp", { pharmacyId: i + 1, conversationId: i < 4 ? i + 1 : null, dueAt: ago(i < 2 ? 1 : -i), status: "PENDING", note: ["Share the partnership overview", "Schedule an introductory call", "Send a short introduction", "Follow up on the proposal", "Review the contact details", "Prepare the welcome message"][i], kind: i % 2 ? "CALL" : "EMAIL", priority: i < 2 ? "HIGH" : "NORMAL", assignedToId: 2, createdBy: "Jamie Demo", snoozeCount: 0 });
add("EmailVerificationBatch", { name: "Verification round", status: "EXPORTED", scope: {}, provider: "DEMO", total: 0, checkedCount: 0, valid: 0, invalid: 0, risky: 0, catchAll: 0, unknown: 0, createdById: 1, exportedAt: ago(1) });
add("ImportJob", { name: "Original pharmacy registry", sourceType: "MANUAL", jurisdiction: "US", datasetDate: snapshotDate, status: "COMMITTED", declaredColumns: Object.values(importMapping), mapping: importMapping, fileName: "original_pharmacies.json", fileFormat: "JSON", fileBytes: Buffer.byteLength(JSON.stringify(registry)), totalRows: pharmacyCount, analysis: { accepted: pharmacyCount, review: 0, excluded: 0, totalRows: pharmacyCount, withEmail: registry.records.filter(p => p.email).length, withPhone: registry.records.filter(p => p.phone).length, sharedInboxes: registry.records.filter(p => p.emailKind === "SHARED").length, duplicates: 0, ruleCounts: {}, byState }, batchId: 1, createdById: 1, committedAt: snapshotDate });
data.Pharmacy.forEach((p, i) => add("ImportRow", { jobId: 1, rowNumber: i + 1, raw: importValues(p), cleaned: { ...importValues(p), name: p.canonicalName }, decision: "ACCEPTED", notes: [], pharmacyId: p.id }));
const sampleActivityDays = [0, 0, 0, 1, 1, 2, 3, 3, 5, 5, 5, 7, 9, 12];
for (let i = 0; i < 14; i++) add("AuditEvent", { eventType: ["IMPORT_COMPLETED", "VERIFICATION_RECORDED", "CAMPAIGN_CREATED", "FOLLOW_UP_CREATED"][i % 4], pharmacyId: i + 1, actor: "Jamie Demo", actorId: 1, actorRole: "OWNER", detail: null, createdAt: ago(sampleActivityDays[i]) });
add("SuppressionEntry", { email: "do-not-contact@expressdiabetics.example", reason: "UNSUBSCRIBED", source: "DEMO", notes: "Fictional sample suppression entry." });
add("EmailTemplate", { name: "A friendly pharmacy introduction", kind: "INTRODUCTION", subject: "A new connection for {{pharmacy_name}}", bodyText: "Hello {{owner_name}},\n\nWe’d love to learn more about your pharmacy.\n\nexpressdiabetics", bodyHtml: "<p>A sample pharmacy introduction.</p>", purpose: "Fictional sample template", timesUsed: 2, createdBy: "Jamie Demo" });

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
  client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    if (sql.includes("audit_event")) {
      const since = values.find(value => value instanceof Date) as Date | undefined;
      const counts = new Map<string, bigint>();
      for (const event of data.AuditEvent) {
        const createdAt = event.createdAt as Date;
        if (since && createdAt < since) continue;
        const day = createdAt.toISOString().slice(0, 10);
        counts.set(day, (counts.get(day) || BigInt(0)) + BigInt(1));
      }
      return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n }));
    }
    if (/SELECT\s+1\b/i.test(sql)) return [{ "?column?": 1 }];
    throw new Error("Display-only demo: SQL operations are disabled.");
  };
  client.$connect = async () => undefined;
  client.$disconnect = async () => undefined;
  return client;
}
