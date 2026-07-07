import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { generateOrganization, ORG_TEMPLATES } from "@/lib/demo-generator";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.enum(Object.keys(ORG_TEMPLATES) as [string, ...string[]]).default("small-flight-school"),
  fleetSize: z.number().int().min(1).max(500).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeZone: z.string().max(64).optional(),
  seedData: z.boolean().default(true),
  ownerEmail: z.string().email().optional(),
  ownerFirstName: z.string().max(50).optional(),
  ownerLastName: z.string().max(50).optional(),
  ownerPassword: z.string().min(8).max(72).optional(),
  locations: z.array(z.object({ name: z.string().min(2).max(80), icao: z.string().max(8).optional() })).max(5).optional(),
});

/**
 * Generate a fully-populated, isolated demo organization from a business
 * template (Founder Platform → Demo Data Generator).
 */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"]);
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  try {
    const result = await generateOrganization({
      ...body.data,
      template: body.data.template as keyof typeof ORG_TEMPLATES,
      isDemo: true,
    });
    await recordAudit({
      organizationId: result.orgId,
      actorPlatformUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName}`,
      action: "platform.demo_org.create",
      entityType: "Organization",
      entityId: result.orgId,
      newValue: { name: body.data.name, template: body.data.template, counts: result.counts },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("demo org generation failed", e);
    return NextResponse.json({ error: "Demo organization generation failed. Check server logs." }, { status: 500 });
  }
}
