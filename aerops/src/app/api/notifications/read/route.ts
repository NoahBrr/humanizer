import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";

export async function POST() {
  const { session, error } = await authorize("notifications.view", { mutating: true });
  if (error) return error;

  await db.notification.updateMany({
    where: { organizationId: session.organizationId, isRead: false, OR: [{ userId: null }, { userId: session.userId }] },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
