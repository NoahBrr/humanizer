import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "DEFERRED"]),
  resolution: z.string().nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "MAINTENANCE", "DISPATCHER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const squawk = await db.squawk.findFirst({ where: { id, aircraft: { organizationId: session.user.organizationId } } });
  if (!squawk) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const updated = await db.squawk.update({
    where: { id },
    data: {
      status: body.data.status,
      resolution: body.data.resolution ?? squawk.resolution,
      resolvedAt: body.data.status === "RESOLVED" ? new Date() : null,
    },
  });

  return NextResponse.json({ squawk: updated });
}
