import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const postSchema = z.object({ body: z.string().min(2).max(2000) });

/**
 * Internal platform notes on a customer organization (Section 19). Staff
 * only, never exposed through any customer-facing route, and every note is
 * audited under the platform actor.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN", "CUSTOMER_SUCCESS", "SUPPORT_ENGINEER"], { mutating: true });
  if (error) return error;

  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = postSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const label = `${session.firstName} ${session.lastName} (${session.platformRole})`;
  const note = await db.platformNote.create({
    data: { organizationId: id, authorLabel: label, body: body.data.body },
  });
  await recordAudit({
    organizationId: id,
    actorPlatformUserId: session.userId,
    actorLabel: label,
    action: "platform.note_added",
    entityType: "PlatformNote",
    entityId: note.id,
  });
  return NextResponse.json({ note }, { status: 201 });
}
