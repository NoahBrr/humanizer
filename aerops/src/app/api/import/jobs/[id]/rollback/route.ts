import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { rollbackImport } from "@/lib/import/engine";

/** Roll back a committed import: deletes the records the job CREATED. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("data.import", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const job = await db.importJob.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (job.status !== "COMMITTED") return NextResponse.json({ error: "This import has already been rolled back." }, { status: 409 });

  try {
    const result = await rollbackImport(job);
    await recordAudit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName}`,
      action: "import.rollback",
      entityType: "ImportJob",
      entityId: job.id,
      newValue: { dataType: job.dataType, partial: result.partial },
    });
    return NextResponse.json({ ok: true, partial: result.partial });
  } catch (e) {
    console.error("import rollback failed", e);
    return NextResponse.json({ error: "Rollback failed — records created by this import may be referenced by newer data (e.g. imported people who now have bookings). Remove those references and retry." }, { status: 409 });
  }
}
