import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.notification.updateMany({
    where: { organizationId: session.user.organizationId, isRead: false, OR: [{ userId: null }, { userId: session.user.id }] },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
