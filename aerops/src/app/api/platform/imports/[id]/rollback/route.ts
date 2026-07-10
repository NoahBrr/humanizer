import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { rollbackImport } from "@/lib/import/engine";

/**
 * Platform-side rollback of any organization's import job — used by
 * AeroOps staff running customer migrations.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN", "SUPPORT_ENGINEER"], { mutating: true });
  if (error) return error;
  const { id } = await params;

  const job = await db.importJob.findUnique({ where: { id }, include: { organization: { select: { name: true } } } });
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (job.status !== "COMMITTED") return NextResponse.json({ error: "Already rolled back" }, { status: 409 });

  try {
    const result = await rollbackImport(job);
    await recordAudit({
      organizationId: job.organizationId,
      actorPlatformUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
      action: "platform.import.rollback",
      entityType: "ImportJob",
      entityId: job.id,
      newValue: { organization: job.organization.name, dataType: job.dataType, partial: result.partial },
    });
    return NextResponse.json({ ok: true, partial: result.partial });
  } catch (e) {
    console.error("platform import rollback failed", e);
    return NextResponse.json({ error: "Rollback failed — created records may be referenced by newer data." }, { status: 409 });
  }
}
