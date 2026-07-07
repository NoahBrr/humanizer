import Link from "next/link";
import { Database, DatabaseZap } from "lucide-react";
import { db } from "@/lib/db";
import { IMPORT_SPECS } from "@/lib/import/spec";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { PlatformRollbackButton } from "./rollback-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import Jobs" };

/**
 * Platform view of every import job across all tenants — for customer
 * migrations run by AeroOps staff. Staff run imports inside a customer
 * workspace via impersonation (the Import Center there), build demo
 * organizations with the Demo Data Generator, and monitor/roll back here.
 */
export default async function PlatformImportsPage() {
  const jobs = await db.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { organization: { select: { name: true } } },
  });

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import Jobs</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every data import across all organizations. To run a customer migration: impersonate the workspace and use its
          Import Center; to build demo tenants, use the <Link href="/platform/demo-data" className="font-medium text-brand-sky hover:underline">Demo Data Generator</Link>.
        </p>
      </div>

      {jobs.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
          <Database className="h-7 w-7 opacity-40" /> No import jobs yet.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const t = (job.totals ?? {}) as { created?: number; updated?: number; skipped?: number; failed?: number };
            const spec = IMPORT_SPECS.find((s) => s.key === job.dataType);
            return (
              <Card key={job.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <DatabaseZap className="h-4 w-4 shrink-0 text-brand-sky" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {job.organization.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {spec?.label ?? job.dataType} · from {job.source}{job.fileName ? ` · ${job.fileName}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {job.createdByLabel} · {formatDateTime(job.createdAt)} · {t.created ?? 0} created, {t.updated ?? 0} updated, {t.skipped ?? 0} skipped, {t.failed ?? 0} failed
                    </p>
                  </div>
                  {(t.failed ?? 0) > 0 && <Badge tone="red">{t.failed} failed</Badge>}
                  <StatusBadge status={job.status} />
                  {job.status === "COMMITTED" && <PlatformRollbackButton jobId={job.id} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
