import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { specOf, IMPORT_SOURCES } from "@/lib/import/spec";
import { runImport } from "@/lib/import/engine";
import { IMPORT_LIMITS } from "@/lib/import/parse";

const schema = z.object({
  dataType: z.string().min(1),
  source: z.enum(IMPORT_SOURCES.map((s) => s.key) as [string, ...string[]]),
  fileName: z.string().max(200).nullish(),
  mapping: z.record(z.string(), z.string()),
  strategy: z.enum(["skip", "update", "create"]),
  dryRun: z.boolean(),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(IMPORT_LIMITS.maxRows),
});

/**
 * Execute an import — dry run (validation + duplicate report, no writes
 * survive) or commit (writes + ImportJob history row + audit entry).
 */
export async function POST(req: Request) {
  const { session, error } = await authorize("data.import", { mutating: true });
  if (error) return error;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const spec = specOf(body.data.dataType);
  if (!spec) return NextResponse.json({ error: "Unknown data type" }, { status: 400 });

  try {
    const report = await runImport({
      organizationId: session.organizationId,
      spec,
      rows: body.data.rows,
      mapping: body.data.mapping,
      strategy: body.data.strategy as "skip" | "update" | "create",
      dryRun: body.data.dryRun,
    });

    let jobId: string | null = null;
    if (!body.data.dryRun) {
      const job = await db.importJob.create({
        data: {
          organizationId: session.organizationId,
          createdByLabel: `${session.firstName} ${session.lastName}`,
          createdById: session.userId,
          source: body.data.source,
          dataType: spec.key,
          fileName: body.data.fileName ?? null,
          mapping: body.data.mapping,
          options: { strategy: body.data.strategy },
          totals: report.totals,
          rowErrors: report.errors as unknown as Prisma.InputJsonValue,
          createdRecords: report.createdRecords,
        },
      });
      jobId = job.id;
      await recordAudit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        actorLabel: `${session.firstName} ${session.lastName}`,
        action: "import.commit",
        entityType: "ImportJob",
        entityId: job.id,
        newValue: { dataType: spec.key, source: body.data.source, ...report.totals },
      });
    }

    return NextResponse.json({ ok: true, report, jobId });
  } catch (e) {
    console.error("import run failed", e);
    return NextResponse.json({ error: "Import failed before any rows were written. Check the file and try again." }, { status: 500 });
  }
}
