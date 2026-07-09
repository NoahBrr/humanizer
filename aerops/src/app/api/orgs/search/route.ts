import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { searchOrganizations } from "@/lib/onboarding";

/**
 * Organization directory search for signed-in individual accounts looking
 * for their company/operator (by name, code/slug, airport ICAO, or city).
 * Session-gated self-service: callers need no org permissions because they
 * have no org yet; results expose only public directory fields.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchOrganizations(q);
  return NextResponse.json({
    results: results.map((o) => ({
      id: o.id,
      name: o.name,
      code: o.slug,
      brandColor: o.brandColor,
      businessProfiles: o.businessProfiles,
      locations: o.locations,
      members: o._count.users,
      aircraft: o._count.aircraft,
    })),
  });
}
