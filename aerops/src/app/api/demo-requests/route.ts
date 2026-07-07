import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const schema = z.object({
  kind: z.enum(["demo", "contact"]).default("demo"),
  name: z.string().min(2).max(80),
  email: z.string().email(),
  company: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  orgType: z.string().max(60).optional(),
  fleetSize: z.string().max(20).optional(),
  message: z.string().max(2000).optional(),
});

/**
 * Public marketing-site form intake (demo + contact). Data-free response by
 * contract, rate limited; requests surface in the Founder Platform.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`demo-req:${clientIp(req)}`, 5, 3_600_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many submissions. We already have your details — we'll be in touch." }, { status: 429 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Please check the form and try again." }, { status: 400 });

  await db.demoRequest.create({ data: body.data });
  return NextResponse.json({ ok: true }, { status: 201 });
}
