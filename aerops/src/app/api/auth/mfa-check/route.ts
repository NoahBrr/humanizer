import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * Sign-in pre-flight: after validating the password, tells the client whether
 * an MFA code is required. Never reveals whether the account exists on a bad
 * password, and is rate-limited like the login endpoint itself.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`mfa-check:${clientIp(req)}`, 10, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterS) } });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const email = body.data.email.toLowerCase();

  const user = await db.user.findUnique({ where: { email }, select: { passwordHash: true, mfaEnabled: true, isActive: true, deletedAt: true } });
  const platformUser = user ? null : await db.platformUser.findUnique({ where: { email }, select: { passwordHash: true, mfaEnabled: true, isActive: true } });
  const account = user ?? platformUser;

  if (!account || !("isActive" in account && account.isActive) || (user && user.deletedAt)) {
    return NextResponse.json({ ok: false });
  }
  if (!(await bcrypt.compare(body.data.password, account.passwordHash))) {
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true, mfaRequired: account.mfaEnabled });
}
