/**
 * Import Center file parsing: CSV (RFC-4180-ish), pasted spreadsheet tables
 * (tab-separated), and Excel .xlsx (first worksheet, via exceljs).
 * Server-side only. Hard limits keep a bad upload from hurting the process:
 * 5 MB / 5,000 data rows / 100 columns.
 */

export const IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 100,
} as const;

export type ParsedTable = {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
};

function toTable(grid: string[][]): ParsedTable {
  // Drop fully-empty lines and comment lines (template guidance rows).
  const cleaned = grid.filter((r) => r.some((c) => c.trim() !== "") && !r[0]?.trim().startsWith("#"));
  if (cleaned.length === 0) return { columns: [], rows: [], totalRows: 0, truncated: false };
  const columns = cleaned[0].map((c, i) => (c.trim() || `Column ${i + 1}`)).slice(0, IMPORT_LIMITS.maxColumns);
  const body = cleaned.slice(1);
  const truncated = body.length > IMPORT_LIMITS.maxRows;
  const rows = body.slice(0, IMPORT_LIMITS.maxRows).map((r) => {
    const row: Record<string, string> = {};
    columns.forEach((col, i) => { row[col] = (r[i] ?? "").trim(); });
    return row;
  });
  return { columns, rows, totalRows: body.length, truncated };
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): ParsedTable {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      grid.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); grid.push(row); }
  return toTable(grid);
}

/** Pasted table: tab-separated (spreadsheet clipboard), falls back to CSV. */
export function parsePaste(text: string): ParsedTable {
  if (text.includes("\t")) {
    const grid = text.split(/\r?\n/).map((line) => line.split("\t"));
    return toTable(grid);
  }
  return parseCsv(text);
}

/** Excel .xlsx — first worksheet. */
export async function parseXlsx(buffer: Buffer): Promise<ParsedTable> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { columns: [], rows: [], totalRows: 0, truncated: false };
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value;
      cells.push(
        v === null || v === undefined ? "" :
        v instanceof Date ? v.toISOString() :
        typeof v === "object" && "text" in v ? String((v as { text: unknown }).text) :
        typeof v === "object" && "result" in v ? String((v as { result: unknown }).result ?? "") :
        String(v),
      );
    }
    grid.push(cells);
  });
  return toTable(grid);
}
