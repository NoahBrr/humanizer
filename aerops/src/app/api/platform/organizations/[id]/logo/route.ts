import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizePlatform, platformOrgScopeError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { platformRolesWith } from "@/lib/platform-permissions";
import { getStorage } from "@/lib/storage";
import { validateImageUpload, safeLogoKey, MAX_LOGO_BYTES } from "@/lib/upload-validation";

/**
 * Upload/replace (POST) or remove (DELETE) an organization's logo. Platform
 * staff only, gated on `platform.branding.manage`. The file is validated by
 * magic bytes (never its declared MIME or filename), stored under a
 * server-generated key, and the previous object is cleaned up best-effort. Both
 * verbs are audited.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(platformRolesWith("platform.branding.manage"), { mutating: true });
  if (error) return error;

  const { id } = await params;
  const scopeError = platformOrgScopeError(session, id);
  if (scopeError) return scopeError;
  const org = await db.organization.findUnique({ where: { id } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  // Reject oversize on the declared size before buffering the payload into memory.
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: `Logo must be ${MAX_LOGO_BYTES / 1024 / 1024} MB or smaller.` }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniff = validateImageUpload(bytes);
  if (!sniff.ok) return NextResponse.json({ error: sniff.error }, { status: 400 });

  const storage = getStorage();
  const key = safeLogoKey(org.id, sniff.ext);
  await storage.put(key, bytes, sniff.contentType);

  // Best-effort cleanup of the replaced object — a leaked orphan must not fail
  // (or roll back) the branding update the operator asked for.
  if (org.logoObjectKey && org.logoObjectKey !== key) {
    await storage.delete(org.logoObjectKey).catch(() => {});
  }

  const logoUrl = storage.url(key);
  await db.organization.update({ where: { id: org.id }, data: { logoUrl, logoObjectKey: key } });

  await recordAudit({
    organizationId: org.id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action: "platform.org_branding_update",
    entityType: "Organization",
    entityId: org.id,
    oldValue: { logoUrl: org.logoUrl },
    newValue: { logoUrl },
  });

  return NextResponse.json({ logoUrl });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(platformRolesWith("platform.branding.manage"), { mutating: true });
  if (error) return error;

  const { id } = await params;
  const scopeError = platformOrgScopeError(session, id);
  if (scopeError) return scopeError;
  const org = await db.organization.findUnique({ where: { id } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (org.logoObjectKey) {
    await getStorage().delete(org.logoObjectKey).catch(() => {});
  }

  await db.organization.update({ where: { id: org.id }, data: { logoUrl: null, logoObjectKey: null } });

  await recordAudit({
    organizationId: org.id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action: "platform.org_branding_remove",
    entityType: "Organization",
    entityId: org.id,
    oldValue: { logoUrl: org.logoUrl },
    newValue: { logoUrl: null },
  });

  return NextResponse.json({ ok: true });
}
