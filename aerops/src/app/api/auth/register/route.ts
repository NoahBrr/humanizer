import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { validatePassword } from "@/lib/password";
import { createIndividualAccount } from "@/lib/onboarding";

const schema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(1).max(72),
  phone: z.string().max(30).optional(),
});

/**
 * Public sign-up: creates an INDIVIDUAL account (no organization). The user
 * then joins or creates an organization from /welcome. Rate-limited; the
 * password policy is the same one Settings → Security enforces.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`register:${clientIp(req)}`, 5, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many sign-up attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterS) } });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const password = validatePassword(body.data.password);
  if (!password.ok) return NextResponse.json({ error: password.error }, { status: 400 });

  const result = await createIndividualAccount(body.data);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
