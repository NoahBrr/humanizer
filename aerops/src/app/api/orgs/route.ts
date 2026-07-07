import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { isProfileKey } from "@/lib/business-profiles";
import { createOrganizationForUser } from "@/lib/onboarding";

const schema = z.object({
  name: z.string().min(2).max(80),
  businessProfiles: z.array(z.string()).min(1).max(10),
  location: z.object({ name: z.string().min(2).max(80), icao: z.string().max(8).optional() }),
  timeZone: z.string().max(64).optional(),
  phone: z.string().max(30).optional(),
  inviteEmails: z.array(z.string().email()).max(20).optional(),
});

/**
 * Self-serve organization creation from onboarding. Session-gated
 * self-service: the caller is an INDIVIDUAL account (no org, so no org
 * permissions exist yet); they become the organization owner. The engine
 * refuses callers who already belong to an organization, and the creation
 * is audited.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.kind !== "individual") {
    return NextResponse.json({ error: "You already belong to an organization." }, { status: 400 });
  }
  const limited = rateLimit(`org-create:${clientIp(req)}`, 3, 3_600_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many organizations created recently." }, { status: 429 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const profiles = body.data.businessProfiles.filter(isProfileKey);
  if (!profiles.length) return NextResponse.json({ error: "Pick at least one business activity." }, { status: 400 });

  const result = await createOrganizationForUser(session.userId, { ...body.data, businessProfiles: profiles });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, orgId: result.org.id, name: result.org.name }, { status: 201 });
}
