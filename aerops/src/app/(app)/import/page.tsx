import { redirect } from "next/navigation";
import { Download, History } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { IMPORT_SPECS } from "@/lib/import/spec";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import { ImportWizard } from "./import-wizard";
import { RollbackButton } from "./import-history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import Center" };

export default async function ImportCenterPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("data.import")) redirect("/dashboard");

  const jobs = await db.importJob.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // Remembered mappings: the latest committed job per (source, dataType).
  const rememberedMappings: Record<string, Record<string, string>> = {};
  for (const job of jobs) {
    const key = `${job.source}:${job.dataType}`;
    if (!rememberedMappings[key]) rememberedMappings[key] = job.mapping as Record<string, string>;
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Import Center"
        description="Migrate from Flight Circle, Flight Schedule Pro, FlightLogger, QuickBooks, spreadsheets, or any CSV — preview, map, test, then commit. Every import is audited and can be rolled back."
      />

      <ImportWizard rememberedMappings={rememberedMappings} />

      {/* Templates */}
      <div className="mt-6">
        <p className="flex items-center gap-2 text-sm font-semibold"><Download className="h-4 w-4 text-brand-royal dark:text-brand-sky" /> Migration templates</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Blank CSVs with required/optional fields, formatting notes, and examples — hand these to your old provider or fill them yourself.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {IMPORT_SPECS.map((s) => (
            <a key={s.key} href={`/api/import/templates/${s.key}`}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand-royal/40">
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="mt-8">
        <p className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-brand-royal dark:text-brand-sky" /> Import history</p>
        {jobs.length === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-card px-4 py-5 text-xs text-muted-foreground">No imports yet — your first import will appear here with its full row-by-row report.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {jobs.map((job) => {
              const t = (job.totals ?? {}) as { total?: number; created?: number; updated?: number; skipped?: number; failed?: number };
              const spec = IMPORT_SPECS.find((s) => s.key === job.dataType);
              return (
                <Card key={job.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {spec?.label ?? job.dataType}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          from {job.source}{job.fileName ? ` · ${job.fileName}` : ""}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {job.createdByLabel} · {formatDateTime(job.createdAt)} ·{" "}
                        {t.created ?? 0} created, {t.updated ?? 0} updated, {t.skipped ?? 0} skipped, {t.failed ?? 0} failed
                      </p>
                    </div>
                    {(t.failed ?? 0) > 0 && <Badge tone="red">{t.failed} failed</Badge>}
                    <StatusBadge status={job.status} />
                    {job.status === "COMMITTED" && <RollbackButton jobId={job.id} />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
