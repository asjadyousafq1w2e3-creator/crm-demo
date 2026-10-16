/**
 * File reading. Delimited text is parsed here rather than by a dependency: the rules that matter
 * (quoted fields, embedded newlines, doubled quotes, a BOM, CRLF) are few and worth owning, and a
 * parser that silently mangles a row is worse than no parser.
 *
 * Spreadsheets go through exceljs, because .xlsx is a zip of XML and hand-rolling that would be
 * a different kind of decision.
 */
import ExcelJS from "exceljs";

export type ParsedFile = { headers: string[]; rows: Record<string, string>[] };
export type FileFormat = "csv" | "tsv" | "psv" | "xlsx";

export function formatFor(fileName: string): FileFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "psv" || ext === "txt") return "psv";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  return null;
}

const DELIMITERS: Record<Exclude<FileFormat, "xlsx">, string> = {
  csv: ",", tsv: "\t", psv: "|",
};

/** Splits delimited text into rows of raw cells. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip a UTF-8 BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" is one literal quote
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"' && field === "") { quoted = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;                              // CRLF and lone CR both end a line
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  // A trailing newline leaves one empty row; so do blank lines inside the file.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * A delimiter guess, for when the extension lies - ".txt" is used for pipe-delimited, tab-delimited
 * and comma-delimited files by different boards. Decided on the header line alone.
 */
export function sniffDelimiter(text: string): string {
  const line = text.slice(0, 8000).split(/\r?\n/)[0] ?? "";
  const counts = [",", "\t", "|", ";"].map((d) => [d, line.split(d).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

function toRecords(grid: string[][]): ParsedFile {
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h, i) => h.trim() || `column_${i + 1}`);
  const rows = grid.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = (cells[i] ?? "").trim(); });
    return rec;
  });
  return { headers, rows };
}

export async function parseFile(
  buffer: Buffer, format: FileFormat, declaredDelimiter?: string,
): Promise<ParsedFile> {
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };

    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      // eachCell skips gaps, so read positionally to keep columns aligned with the header.
      for (let i = 1; i <= sheet.columnCount; i++) cells.push(cellText(r.getCell(i).value));
      grid.push(cells);
    });
    return toRecords(grid);
  }

  const text = buffer.toString("utf8");
  const delimiter = declaredDelimiter ?? (format === "psv" ? sniffDelimiter(text) : DELIMITERS[format]);
  return toRecords(parseDelimited(text, delimiter));
}

/** Excel cells can be text, numbers, dates, formulas or rich text. All of it becomes a string. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if ("text" in v) return String(v.text ?? "").trim();
    if ("result" in v) return String(v.result ?? "").trim();      // formula
    if ("richText" in v && Array.isArray(v.richText))
      return v.richText.map((p) => (p as { text: string }).text).join("").trim();
    if ("hyperlink" in v) return String(v.hyperlink ?? "").trim();
    return "";
  }
  return String(value).trim();
}
