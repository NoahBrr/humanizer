import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

const createSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  timeZone: z.string().default("America/New_York"),
  planId: z.string(),
  location: z.object({
    name: z.string().min(2),
    icao: z.string().max(6).optional(),
    timeZone: z.string().optional(),
  }),
  adminEmail: z.string().email(),
});

/** Create a customer organization: org + first location + seeded system roles + admin invitation. */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN", "CUSTOMER_SUCCESS"]);
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  if (await db.organization.findUnique({ where: { slug: data.slug } })) {
    return NextResponse.json({ error: "That workspace slug is already taken — pick another." }, { status: 409 });
  }
  const plan = await db.subscriptionPlan.findUnique({ where: { id: data.planId } });
  if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });

  const token = randomBytes(24).toString("base64url");
  const org = await db.organization.create({
    data: {
      name: data.name,
      slug: data.slug,
      timeZone: data.timeZone,
      planId: plan.id,
      locations: { create: { name: data.location.name, icao: data.location.icao, timeZone: data.location.timeZone ?? data.timeZone } },
      orgRoles: {
        create: Object.entries(DEFAULT_ROLE_PERMISSIONS)
          .filter(([name]) => name !== "SUPER_ADMIN")
          .map(([name, permissions]) => ({ name, permissions, isSystem: true })),
      },
      invitations: {
        create: {
          email: data.adminEmail.toLowerCase(),
          role: "SCHOOL_ADMIN",
          token,
          invitedBy: `${session.firstName} ${session.lastName} (AeroOps)`,
          expiresAt: new Date(Date.now() + 14 * 86_400_000),
        },
      },
    },
  });

  await recordAudit({
    organizationId: org.id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action: "platform.org_create",
    entityType: "Organization",
    entityId: org.id,
    newValue: { name: org.name, slug: org.slug, plan: plan.name, adminEmail: data.adminEmail },
  });

  return NextResponse.json({ organization: org, inviteUrl: `/invite/${token}` }, { status: 201 });
}
