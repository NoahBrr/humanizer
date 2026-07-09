import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * Parts inventory ledger (Section 15B). Stock is never edited directly —
 * every change is a typed InventoryMovement, so the on-hand quantity is
 * always explainable as the sum of its history. Direction is derived from
 * the movement type server-side; crossing below minimum stock raises a
 * low-stock notification for the maintenance team.
 */
const OUTBOUND = new Set(["INSTALL", "SCRAP", "WARRANTY", "LOST", "DAMAGED"]);
const INBOUND = new Set(["RECEIVE", "RETURN", "REMOVE"]); // REMOVE = pulled off an aircraft back into stock

const postSchema = z.object({
  partId: z.string(),
  type: z.enum(["RECEIVE", "TRANSFER", "INSTALL", "REMOVE", "RETURN", "SCRAP", "WARRANTY", "ADJUSTMENT", "LOST", "DAMAGED", "AUDIT"]),
  // RECEIVE/INSTALL/etc. take a positive count; ADJUSTMENT is signed; AUDIT is the absolute counted quantity.
  quantity: z.number().int().min(-10_000).max(10_000),
  workOrderId: z.string().nullish(),
  aircraftId: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

export async function GET() {
  const { session, error } = await authorize("maintenance.view");
  if (error) return error;

  const parts = await db.part.findMany({
    where: { organizationId: session.organizationId },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { partNumber: "asc" },
  });
  return NextResponse.json({
    parts: parts.map((p) => ({ ...p, lowStock: p.quantity < p.minQuantity })),
  });
}

export async function POST(req: Request) {
  const { session, error } = await authorize("maintenance.manage", { mutating: true });
  if (error) return error;

  const body = postSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  const part = await db.part.findFirst({ where: { id: data.partId, organizationId: session.organizationId } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  let signed: number;
  if (data.type === "AUDIT") signed = data.quantity - part.quantity; // counted quantity becomes truth
  else if (data.type === "ADJUSTMENT" || data.type === "TRANSFER") signed = data.quantity;
  else if (OUTBOUND.has(data.type)) signed = -Math.abs(data.quantity);
  else if (INBOUND.has(data.type)) signed = Math.abs(data.quantity);
  else signed = data.quantity;

  const newQuantity = part.quantity + signed;
  if (newQuantity < 0) {
    return NextResponse.json(
      { error: `Only ${part.quantity} × ${part.partNumber} on hand — cannot ${data.type.toLowerCase()} ${Math.abs(signed)}.` },
      { status: 400 },
    );
  }

  const actor = `${session.firstName} ${session.lastName}`;
  const [, movement] = await db.$transaction([
    db.part.update({ where: { id: part.id }, data: { quantity: newQuantity } }),
    db.inventoryMovement.create({
      data: {
        partId: part.id,
        type: data.type,
        quantity: signed,
        workOrderId: data.workOrderId ?? null,
        aircraftId: data.aircraftId ?? null,
        notes: data.notes ?? null,
        performedBy: actor,
      },
    }),
  ]);

  // Low-stock alert fires when the balance crosses below minimum — not on every movement.
  if (newQuantity < part.minQuantity && part.quantity >= part.minQuantity) {
    await db.notification.create({
      data: {
        organizationId: session.organizationId,
        kind: "GENERAL",
        title: `Low stock: ${part.partNumber}`,
        body: `${part.description} is down to ${newQuantity} (minimum ${part.minQuantity}). Reorder before the next work order stalls in Waiting Parts.`,
      },
    });
  }

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: actor,
    action: "inventory.movement",
    entityType: "Part",
    entityId: part.id,
    oldValue: { quantity: part.quantity },
    newValue: { quantity: newQuantity, type: data.type, moved: signed },
  });

  return NextResponse.json({ movement, quantity: newQuantity, lowStock: newQuantity < part.minQuantity });
}
