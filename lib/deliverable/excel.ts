/**
 * Workbook and CSV writers for the deliverable.
 *
 * Excel gets the eight tabs in one file; Google Sheets gets one CSV per tab in a folder, because
 * Sheets imports a CSV per tab and a multi-tab upload is the same thing zipped.
 */
import ExcelJS from "exceljs";
import type { Deliverable, FinalReport, Sheet } from "./build";

const HEADER_FILL = "FF00685F";   // the application's primary, so the file looks like the system

export async function toWorkbook(d: Deliverable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Verified Pharmacy Outreach CRM";
  wb.created = new Date();

  for (const sheet of d.sheets) addSheet(wb, sheet);
  addReport(wb, d.summary);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSheet(wb: ExcelJS.Workbook, sheet: Sheet) {
  // Excel tab names cannot exceed 31 characters or contain : \ / ? * [ ]
  const ws = wb.addWorksheet(sheet.name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31));
  ws.addRow([...sheet.columns]);

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle" };
  header.height = 22;

  for (const row of sheet.rows) ws.addRow(row);

  sheet.columns.forEach((name, i) => {
    const longest = sheet.rows.reduce(
      (max, r) => Math.max(max, String(r[i] ?? "").length), name.length);
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 46);
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (sheet.rows.length)
    ws.autoFilter = { from: { row: 1, column: 1 },
                      to: { row: 1, column: sheet.columns.length } };
}

/**
 * The final report the brief asks for, as its own tab. Written as label/value rows rather than a
 * table so the caveats can be read as sentences.
 */
function addReport(wb: ExcelJS.Workbook, r: FinalReport) {
  const ws = wb.addWorksheet("Final Report");
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 76;

  const heading = (text: string) => {
    const row = ws.addRow([text, ""]);
    row.font = { bold: true, size: 12, color: { argb: "FF00685F" } };
    row.height = 22;
  };
  const line = (label: string, value: string | number) => {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  };

  heading("Verified Independent Pharmacies — Final Report");
  line("Verification date", r.generatedAt);
  ws.addRow([]);

  heading("Totals");
  line("Total independent pharmacies found", r.totalIndependentPharmacies);
  line("Total valid emails", r.totalValidEmails);
  line("Emails not yet verified", r.emailsNotYetVerified);
  line("Total pharmacies without emails", r.totalWithoutEmail);
  line("Total chains and institutions removed", r.totalChainsRemoved);
  line("Total closed businesses removed", r.totalClosedRemoved);
  line("Total duplicates removed", r.totalDuplicatesRemoved);
  line("Total active licences verified", r.totalActiveLicensesVerified);
  line("States covered", `${r.statesCovered.length} — ${r.statesCovered.join(", ")}`);
  ws.addRow([]);

  heading("Tools used");
  for (const t of r.toolsUsed) ws.addRow(["", t]).getCell(2).alignment = { wrapText: true };
  ws.addRow([]);

  heading("What this file does not claim");
  for (const c of r.caveats) {
    const row = ws.addRow(["", c]);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.height = 30;
  }
}

const esc = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(sheet: Sheet): string {
  return [sheet.columns.map(esc).join(","), ...sheet.rows.map((r) => r.map(esc).join(","))]
    .join("\n");
}
