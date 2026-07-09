import { NextResponse } from "next/server";
import { authorize } from "@/lib/session";
import { parseCsv, parsePaste, parseXlsx, IMPORT_LIMITS } from "@/lib/import/parse";

/**
 * Parse an uploaded file (CSV/XLSX, multipart) or pasted table (JSON
 * {text}) into columns + rows for the Import Center preview. Nothing is
 * stored — the client holds the parsed rows through the wizard.
 */
export async function POST(req: Request) {
  const { error } = await authorize("data.import");
  if (error) return error;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > IMPORT_LIMITS.maxBytes) {
      return NextResponse.json({ error: `File is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB — split it and import in batches.` }, { status: 413 });
    }
    const name = file.name.toLowerCase();
    try {
      const table = name.endsWith(".xlsx") || name.endsWith(".xls")
        ? await parseXlsx(Buffer.from(await file.arrayBuffer()))
        : parseCsv(await file.text());
      if (!table.columns.length) return NextResponse.json({ error: "Couldn't find a header row in that file." }, { status: 400 });
      return NextResponse.json({ ...table, fileName: file.name });
    } catch (e) {
      console.error("import parse failed", e);
      return NextResponse.json({ error: "Couldn't read that file. Export it as CSV and try again." }, { status: 400 });
    }
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (text.length > IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: "Pasted data is too large." }, { status: 413 });
  if (text.trim().length < 3) return NextResponse.json({ error: "Paste a table including its header row." }, { status: 400 });
  const table = parsePaste(text);
  if (!table.columns.length) return NextResponse.json({ error: "Couldn't find a header row in the pasted data." }, { status: 400 });
  return NextResponse.json({ ...table, fileName: null });
}
