import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { redeemInviteLink } from "@/lib/onboarding";

const schema = z.object({ token: z.string().min(8) });

/**
 * Redeem a shareable invite link. Session-gated self-service: the caller is
 * an INDIVIDUAL account joining an org (auto-approve links attach them
 * immediately; approval links file a join request). The engine enforces
 * expiry, max uses, and revocation.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.kind !== "individual") {
    return NextResponse.json({ error: "You already belong to an organization." }, { status: 400 });
  }
  const limited = rateLimit(`invite-redeem:${clientIp(req)}`, 10, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const result = await redeemInviteLink(body.data.token, session.userId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
