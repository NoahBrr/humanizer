import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "DEFERRED"]),
  resolution: z.string().nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("maintenance.manage", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const squawk = await db.squawk.findFirst({ where: { id, aircraft: { organizationId: session.organizationId } } });
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
