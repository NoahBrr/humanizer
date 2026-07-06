import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const publicSchema = z.object({
  org: z.string().min(2), // organization slug — forms are embeddable per-org
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().max(30).nullish(),
  interest: z.string().max(120).nullish(),
  source: z.string().max(40).default("website"),
  notes: z.string().max(500).nullish(),
});

/** PUBLIC endpoint behind rate limiting: website forms create CRM leads. */
export async function POST(req: Request) {
  const limited = rateLimit(`lead:${clientIp(req)}`, 5, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const body = publicSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Please check the form and try again." }, { status: 400 });

  const org = await db.organization.findUnique({ where: { slug: body.data.org }, select: { id: true, status: true } });
  if (!org || org.status !== "ACTIVE") return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  const lead = await db.lead.create({
    data: {
      organizationId: org.id,
      name: body.data.name,
      email: body.data.email.toLowerCase(),
      phone: body.data.phone ?? null,
      interest: body.data.interest ?? null,
      source: body.data.source,
      notes: body.data.notes ?? null,
      nextFollowUp: new Date(Date.now() + 86_400_000),
    },
  });
  await db.notification.create({
    data: {
      organizationId: org.id,
      kind: "GENERAL",
      title: `New lead: ${lead.name}`,
      body: `${lead.interest ?? "General inquiry"} · via ${lead.source} — follow up within 24h.`,
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string(),
  status: z.enum(["NEW", "CONTACTED", "DISCOVERY_SCHEDULED", "DISCOVERY_COMPLETED", "APPLICATION", "ENROLLED", "LOST"]).optional(),
  convert: z.boolean().default(false),
  notes: z.string().max(1000).nullish(),
  nextFollowUp: z.string().datetime().nullish(),
});

/** Staff: advance pipeline stage or convert a lead into a student invitation. */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("students.manage", { mutating: true });
  if (error) return error;

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const lead = await db.lead.findFirst({ where: { id: body.data.id, organizationId: session.organizationId } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let inviteUrl: string | undefined;
  if (body.data.convert) {
    // Conversion reuses the invitation machinery — the lead becomes an
    // invited student and enrollment completes through the normal accept flow.
    if (await db.user.findUnique({ where: { email: lead.email } })) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
    const token = randomBytes(24).toString("base64url");
    await db.invitation.create({
      data: {
        organizationId: session.organizationId,
        email: lead.email,
        role: "STUDENT",
        token,
        invitedBy: `${session.firstName} ${session.lastName} (CRM)`,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });
    inviteUrl = `/invite/${token}`;
  }

  const updated = await db.lead.update({
    where: { id: lead.id },
    data: {
      status: body.data.convert ? "ENROLLED" : body.data.status ?? lead.status,
      convertedAt: body.data.convert ? new Date() : lead.convertedAt,
      notes: body.data.notes !== undefined ? body.data.notes : lead.notes,
      nextFollowUp: body.data.nextFollowUp !== undefined ? (body.data.nextFollowUp ? new Date(body.data.nextFollowUp) : null) : lead.nextFollowUp,
    },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: body.data.convert ? "crm.lead_converted" : "crm.lead_updated",
    entityType: "Lead",
    entityId: lead.id,
    oldValue: { status: lead.status },
    newValue: { status: updated.status },
  });

  return NextResponse.json({ lead: updated, inviteUrl });
}
