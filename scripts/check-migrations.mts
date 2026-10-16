/**
 * Refuses a deploy whose migrations would destroy data.
 *
 * `prisma migrate deploy` applies whatever is in the migrations folder without asking. That is
 * the right behaviour for a deploy tool and the wrong behaviour for a registry the client has
 * paid to verify: a DROP COLUMN written during a refactor months ago will run against production
 * on the next release, silently, and the evidence of what was lost goes with it.
 *
 * So this reads the SQL before anything runs and stops on the statements that cannot be undone.
 * It is intentionally blunt. A migration that genuinely needs to drop something can say so - see
 * the escape hatch at the bottom - which makes dropping data a decision somebody wrote down
 * rather than a side effect of a schema edit.
 *
 *   npm run check:migrations
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "prisma/migrations";

/** Statements that lose data that cannot be recovered by re-running anything. */
const DESTRUCTIVE: { pattern: RegExp; what: string }[] = [
  { pattern: /\bDROP\s+TABLE\b/i,                  what: "drops a table" },
  { pattern: /\bDROP\s+COLUMN\b/i,                 what: "drops a column" },
  { pattern: /\bTRUNCATE\b/i,                      what: "empties a table" },
  { pattern: /\bDELETE\s+FROM\b/i,                 what: "deletes rows" },
  { pattern: /\bDROP\s+DATABASE\b/i,               what: "drops the database" },
  { pattern: /\bDROP\s+SCHEMA\b/i,                 what: "drops a schema" },
  // Not data loss, but it fails outright when existing rows hold a null, taking the deploy with
  // it - which on a live system is its own kind of damage.
  { pattern: /\bSET\s+NOT\s+NULL\b/i,              what: "makes a column NOT NULL, which fails if any existing row is null" },
];

/** A migration may opt out by saying why, on one line, in its own file. */
const ALLOW = /--\s*allow-destructive:\s*(.+)/i;

let problems = 0;
let checked = 0;

for (const name of readdirSync(DIR).sort()) {
  const file = join(DIR, name, "migration.sql");
  let sql: string;
  try { sql = readFileSync(file, "utf8"); } catch { continue; }
  checked++;

  const waiver = ALLOW.exec(sql);

  for (const { pattern, what } of DESTRUCTIVE) {
    if (!pattern.test(sql)) continue;
    if (waiver) {
      console.log(`  allowed  ${name}\n           ${what} — "${waiver[1].trim()}"`);
      continue;
    }
    console.error(`  REFUSED  ${name}\n           ${what}`);
    problems++;
  }
}

console.log(`\n${checked} migration${checked === 1 ? "" : "s"} checked.`);

if (problems) {
  console.error(
    `\n${problems} destructive statement${problems === 1 ? "" : "s"} found.\n\n` +
    "If the loss is intended, say so in the migration file:\n" +
    "  -- allow-destructive: <why this is safe, and what was done about the data>\n\n" +
    "If it is not, fix the migration before deploying. The registry holds verification\n" +
    "results the client paid for per address; they cannot be recovered by re-running anything.");
  process.exit(1);
}

console.log("Nothing destructive. Safe to run prisma migrate deploy.");
