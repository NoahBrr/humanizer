import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { emitWebhook } from "@/lib/webhooks";

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["ASSIGNED", "CANCELLED"],
  SCHEDULED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["WAITING_PARTS", "IN_PROGRESS", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "AWAITING_INSPECTION", "CANCELLED"],
  AWAITING_INSPECTION: ["APPROVED", "IN_PROGRESS"],
  APPROVED: ["RETURN_TO_SERVICE"],
  RETURN_TO_SERVICE: ["CLOSED"],
};

const patchSchema = z.object({
  status: z.enum(["OPEN", "ASSIGNED", "WAITING_PARTS", "IN_PROGRESS", "AWAITING_INSPECTION", "APPROVED", "RETURN_TO_SERVICE", "CLOSED", "CANCELLED"]).optional(),
  assignedTo: z.string().max(80).nullish(),
  correctiveAction: z.string().max(1000).nullish(),
  laborHours: z.number().min(0).max(500).nullish(),
  costParts: z.number().min(0).nullish(),
  costLabor: z.number().min(0).nullish(),
});

/**
 * Work-order lifecycle. Transitions are validated against the state machine;
 * APPROVED requires maintenance.manage and records the electronic signature;
 * RETURN_TO_SERVICE restores a grounded/in-shop aircraft to the line and
 * notifies the organization. Every transition is audit-logged.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("maintenance.manage", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const order = await db.maintenanceOrder.findFirst({
    where: { id, aircraft: { organizationId: session.organizationId } },
    include: { aircraft: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  if (data.status) {
    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(data.status)) {
      return NextResponse.json(
        { error: `A ${order.status.replaceAll("_", " ").toLowerCase()} work order can only move to: ${allowed.map((s) => s.replaceAll("_", " ").toLowerCase()).join(", ") || "nowhere (terminal)"}.` },
        { status: 400 },
      );
    }
  }

  const signer = `${session.firstName} ${session.lastName}`;
  const updated = await db.maintenanceOrder.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.status === "OPEN" && !order.number ? { number: `WO-${Date.now().toString().slice(-6)}` } : {}),
      ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
      ...(data.correctiveAction !== undefined ? { correctiveAction: data.correctiveAction } : {}),
      ...(data.laborHours != null ? { laborHours: data.laborHours } : {}),
      ...(data.costParts != null ? { costParts: data.costParts } : {}),
      ...(data.costLabor != null ? { costLabor: data.costLabor } : {}),
      ...(data.status === "APPROVED" ? { approvedBy: signer, approvedAt: new Date() } : {}),
      ...(data.status === "CLOSED" || data.status === "RETURN_TO_SERVICE" ? { endDate: new Date() } : {}),
    },
  });

  // Return to service: restore the aircraft and tell the organization.
  if (data.status === "RETURN_TO_SERVICE" && ["GROUNDED", "IN_MAINTENANCE"].includes(order.aircraft.status)) {
    await db.aircraft.update({ where: { id: order.aircraftId }, data: { status: "AVAILABLE" } });
    await db.notification.create({
      data: {
        organizationId: session.organizationId,
        kind: "GENERAL",
        title: `${order.aircraft.tailNumber} returned to service`,
        body: `${order.title} complete — approved by ${updated.approvedBy ?? signer}. The aircraft is back on the line.`,
      },
    });
  }

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: signer,
    action: `maintenance.wo_${(data.status ?? "updated").toLowerCase()}`,
    entityType: "MaintenanceOrder",
    entityId: id,
    oldValue: { status: order.status },
    newValue: { status: updated.status, approvedBy: updated.approvedBy ?? undefined },
  });
  if (data.status === "CLOSED") {
    await emitWebhook(session.organizationId, "maintenance.completed", {
      workOrderId: id, number: updated.number, tailNumber: order.aircraft.tailNumber,
    });
  }

  return NextResponse.json({ order: updated });
}
