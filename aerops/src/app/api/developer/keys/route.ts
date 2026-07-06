import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const createSchema = z.object({
  name: z.string().min(2).max(60),
  scopes: z.array(z.string()).min(1),
  readOnly: z.boolean().default(true),
});

/** Create a scoped API key. The full key is returned exactly once. */
export async function POST(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const scopes = body.data.scopes.filter((s) => (ALL_PERMISSIONS as string[]).includes(s));
  if (scopes.length === 0) return NextResponse.json({ error: "Pick at least one valid scope." }, { status: 400 });

  const key = `aero_${randomBytes(28).toString("base64url")}`;
  const created = await db.apiKey.create({
    data: {
      organizationId: session.organizationId,
      name: body.data.name,
      keyHash: createHash("sha256").update(key).digest("hex"),
      prefix: key.slice(0, 12),
      scopes,
      readOnly: body.data.readOnly,
      createdBy: `${session.firstName} ${session.lastName}`,
    },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "developer.api_key_created",
    entityType: "ApiKey",
    entityId: created.id,
    newValue: { name: created.name, scopes, readOnly: created.readOnly },
  });
  return NextResponse.json({ key, id: created.id, prefix: created.prefix }, { status: 201 });
}

/** Revoke a key. */
export async function DELETE(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;
  const { id } = z.object({ id: z.string() }).parse(await req.json());
  const key = await db.apiKey.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "developer.api_key_revoked",
    entityType: "ApiKey",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
