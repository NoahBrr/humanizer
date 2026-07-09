"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardPaste,
  FileSpreadsheet, FlaskConical, Loader2, Rocket, Upload,
} from "lucide-react";
import {
  IMPORT_SPECS, IMPORT_SOURCES, DUPLICATE_STRATEGIES, suggestMapping,
  type ImportSourceKey, type DuplicateStrategy,
} from "@/lib/import/spec";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Import Center wizard: source → data type → upload/paste → map → test →
 * commit → summary. The parsed rows live in client state; the server
 * validates and writes. A test run exercises the REAL import inside a
 * rolled-back transaction, so its numbers are exactly what commit will do.
 */

type Table = { columns: string[]; rows: Record<string, string>[]; totalRows: number; truncated: boolean; fileName: string | null };
type Report = { totals: { total: number; created: number; updated: number; skipped: number; failed: number }; errors: { row: number; message: string }[] };

const STEPS = ["Source", "Data type", "Upload", "Map columns", "Test", "Done"] as const;

export function ImportWizard({ rememberedMappings }: { rememberedMappings: Record<string, Record<string, string>> }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<ImportSourceKey>("csv");
  const [dataType, setDataType] = useState<string>("");
  const [table, setTable] = useState<Table | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [testReport, setTestReport] = useState<Report | null>(null);
  const [finalReport, setFinalReport] = useState<Report | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const spec = useMemo(() => IMPORT_SPECS.find((s) => s.key === dataType), [dataType]);

  function applyTable(t: Table) {
    setTable(t);
    if (spec) {
      const remembered = rememberedMappings[`${source}:${spec.key}`];
      const suggested = suggestMapping(spec, t.columns, source);
      // Remembered mappings win where their column still exists.
      const merged = { ...suggested };
      for (const [field, col] of Object.entries(remembered ?? {})) {
        if (t.columns.includes(col)) merged[field] = col;
      }
      setMapping(merged);
    }
    setTestReport(null);
    setStep(3);
  }

  async function parseFile(file: File) {
    setBusy("parse");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't read that file.");
      applyTable(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function parsePaste() {
    setBusy("parse");
    setError(null);
    try {
      const res = await fetch("/api/import/parse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't read the pasted table.");
      applyTable(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the pasted table.");
    } finally {
      setBusy(null);
    }
  }

  async function run(dryRun: boolean) {
    if (!spec || !table) return;
    setBusy(dryRun ? "test" : "commit");
    setError(null);
    try {
      const res = await fetch("/api/import/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataType: spec.key, source, fileName: table.fileName, mapping, strategy, dryRun, rows: table.rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Import failed.");
      if (dryRun) {
        setTestReport(data.report);
        setStep(4);
      } else {
        setFinalReport(data.report);
        setJobId(data.jobId);
        setStep(5);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  function downloadFailedRows(report: Report) {
    if (!table) return;
    const failed = new Set(report.errors.map((e) => e.row));
    const reasons = new Map(report.errors.map((e) => [e.row, e.message]));
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const lines = [[...table.columns, "Import error"].map(esc).join(",")];
    table.rows.forEach((r, i) => {
      const rowNo = i + 2;
      if (failed.has(rowNo)) lines.push([...table.columns.map((c) => esc(r[c] ?? "")), esc(reasons.get(rowNo) ?? "")].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "failed-rows.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const requiredUnmapped = spec ? spec.fields.filter((f) => f.required && f.key !== "firstName" && f.key !== "lastName" && !mapping[f.key]) : [];
  const nameMapped = !spec || !spec.fields.some((f) => f.key === "firstName")
    || !!(mapping.firstName && mapping.lastName) || !!mapping.fullName;

  return (
    <Card>
      <CardContent className="p-6">
        {/* Stepper */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {STEPS.map((label, i) => (
            <span key={label} className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              i === step ? "bg-accent text-accent-foreground" : i < step ? "text-foreground" : "text-muted-foreground/50",
            )}>
              {i < step ? <Check className="h-3.5 w-3.5 text-success" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]">{i + 1}</span>}
              {label}
              {i < STEPS.length - 1 && <span className="ml-1 text-muted-foreground/30">›</span>}
            </span>
          ))}
        </div>

        {error && <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}

        {/* Step 0: source */}
        {step === 0 && (
          <div>
            <p className="text-sm font-semibold">Where is this data coming from?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Picking your old system pre-maps its column names. Any CSV/Excel export works either way.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {IMPORT_SOURCES.map((s) => (
                <button key={s.key} onClick={() => { setSource(s.key); setStep(1); }}
                  className={cn("cursor-pointer rounded-lg border p-3 text-left transition-colors", source === s.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.note}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: data type */}
        {step === 1 && (
          <div>
            <p className="text-sm font-semibold">What are you importing?</p>
            {(["People", "Fleet & Ops", "Business"] as const).map((group) => (
              <div key={group} className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {IMPORT_SPECS.filter((s) => s.group === group).map((s) => (
                    <button key={s.key} onClick={() => { setDataType(s.key); setStep(2); }}
                      className={cn("cursor-pointer rounded-lg border p-3 text-left transition-colors", dataType === s.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{s.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 2: upload / paste */}
        {step === 2 && spec && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-brand-royal dark:text-brand-sky" />
              <p className="mt-2 text-sm font-semibold">Upload a file</p>
              <p className="mt-0.5 text-xs text-muted-foreground">.csv or .xlsx · up to 5 MB / 5,000 rows · first row must be headers</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
              <Button className="mt-3" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                {busy === "parse" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose file
              </Button>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Need a starting point? <a className="font-medium text-brand-royal hover:underline dark:text-brand-sky" href={`/api/import/templates/${spec.key}`}>Download the {spec.label} template</a>
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardPaste className="h-4 w-4 text-brand-royal dark:text-brand-sky" /> Or paste a table</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Copy rows (with headers) straight from Excel or Google Sheets and paste below.</p>
              <Textarea className="mt-2 min-h-32 font-mono text-xs" placeholder={"Tail #\tMake\tModel\nN735GG\tCessna\t172S"} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
              <Button variant="outline" size="sm" className="mt-2" onClick={parsePaste} disabled={!!busy || pasteText.trim().length < 3}>
                {busy === "parse" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />} Use pasted data
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: mapping */}
        {step === 3 && spec && table && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Map your columns to AeroOps fields</p>
              <Badge tone="blue">{table.totalRows.toLocaleString()} rows{table.truncated ? " (first 5,000 will import)" : ""}</Badge>
              {table.fileName && <Badge tone="gray">{table.fileName}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We pre-mapped what we recognized{rememberedMappings[`${source}:${spec.key}`] ? " (including your last import's mapping)" : ""}. Fix anything that&apos;s wrong — this mapping is remembered for next time.
            </p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">AeroOps field</th><th className="px-3 py-2">Your column</th><th className="px-3 py-2">Sample from row 2</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.fields.map((f) => (
                    <tr key={f.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium">{f.label}</span>
                        {f.required && <span className="ml-1 text-destructive">*</span>}
                        {(f.note || f.oneOf) && <p className="text-[11px] text-muted-foreground">{f.note ?? `One of: ${f.oneOf!.join(", ")}`}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })} className="h-8 w-52 text-xs">
                          <option value="">— not imported —</option>
                          {table.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {mapping[f.key] ? (table.rows[0]?.[mapping[f.key]] || <em>empty</em>) : <span className="text-muted-foreground/50">e.g. {f.example}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>When a record already exists (matched by {spec.duplicateKeys.map((k) => k.join("+")).join(" or ")})</Label>
                <Select value={strategy} onChange={(e) => setStrategy(e.target.value as DuplicateStrategy)}>
                  {DUPLICATE_STRATEGIES.map((s) => <option key={s.key} value={s.key}>{s.label} — {s.note}</option>)}
                </Select>
              </div>
              <div className="flex items-end justify-end gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4" /> Back</Button>
                <Button onClick={() => run(true)} disabled={!!busy || requiredUnmapped.length > 0 || !nameMapped}>
                  {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Run test import
                </Button>
              </div>
            </div>
            {(requiredUnmapped.length > 0 || !nameMapped) && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                Map required fields first: {[...(!nameMapped ? ["First + Last name (or Full name)"] : []), ...requiredUnmapped.map((f) => f.label)].join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Step 4: test results */}
        {step === 4 && testReport && (
          <div>
            <p className="text-sm font-semibold">Test import results <span className="ml-1 font-normal text-muted-foreground">— nothing was written yet</span></p>
            <ReportSummary report={testReport} />
            {testReport.errors.length > 0 && <ErrorTable report={testReport} onDownload={() => downloadFailedRows(testReport)} />}
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4" /> Fix mappings</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => run(true)} disabled={!!busy}>
                  {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Re-run test
                </Button>
                <Button onClick={() => run(false)} disabled={!!busy || testReport.totals.created + testReport.totals.updated === 0}>
                  {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Import {testReport.totals.created + testReport.totals.updated} rows
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: summary */}
        {step === 5 && finalReport && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="mt-3 text-sm font-semibold">Import complete</p>
            <ReportSummary report={finalReport} />
            {finalReport.errors.length > 0 && <ErrorTable report={finalReport} onDownload={() => downloadFailedRows(finalReport)} />}
            <p className="mt-3 text-xs text-muted-foreground">
              This import is saved in the history below{jobId ? " and can be rolled back" : ""}. Imported people sign in through an invite link from Settings → Team.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => { setStep(1); setTable(null); setTestReport(null); setFinalReport(null); setPasteText(""); }}>
                Import something else <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportSummary({ report }: { report: Report }) {
  const t = report.totals;
  const items = [
    ["Rows", t.total, "gray"], ["Created", t.created, "green"], ["Updated", t.updated, "blue"],
    ["Skipped", t.skipped, "amber"], ["Failed", t.failed, t.failed ? "red" : "gray"],
  ] as const;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
      {items.map(([label, n, tone]) => (
        <span key={label} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
          <span className="font-semibold">{n}</span> <span className="text-muted-foreground">{label}</span>
          <Badge tone={tone as never} className="ml-1.5 hidden" />
        </span>
      ))}
    </div>
  );
}

function ErrorTable({ report, onDownload }: { report: Report; onDownload: () => void }) {
  return (
    <div className="mt-3 text-left">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-destructive">{report.errors.length} row issue(s)</p>
        <Button size="sm" variant="outline" onClick={onDownload}>Download failed rows (CSV)</Button>
      </div>
      <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <tbody>
            {report.errors.slice(0, 200).map((e, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="w-16 px-3 py-1.5 font-mono text-muted-foreground">row {e.row}</td>
                <td className="px-3 py-1.5">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
