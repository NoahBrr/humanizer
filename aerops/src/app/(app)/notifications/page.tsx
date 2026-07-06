import { Bell, Wrench, CloudRain, DollarSign, CalendarClock, FileWarning, PlaneLanding, AlertTriangle } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { MarkAllRead } from "./mark-all-read";
import type { NotificationKind } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const KIND_META: Record<NotificationKind, { icon: React.ElementType; color: string }> = {
  UPCOMING_FLIGHT: { icon: CalendarClock, color: "text-blue-500" },
  MAINTENANCE_DUE: { icon: Wrench, color: "text-amber-500" },
  DOCUMENT_EXPIRING: { icon: FileWarning, color: "text-amber-500" },
  BALANCE_DUE: { icon: DollarSign, color: "text-red-500" },
  SCHEDULE_CHANGE: { icon: CalendarClock, color: "text-violet-500" },
  WEATHER_CANCELLATION: { icon: CloudRain, color: "text-cyan-500" },
  AIRCRAFT_GROUNDED: { icon: AlertTriangle, color: "text-red-500" },
  INSTRUCTOR_UNAVAILABLE: { icon: Bell, color: "text-amber-500" },
  SQUAWK_REPORTED: { icon: PlaneLanding, color: "text-amber-500" },
  GENERAL: { icon: Bell, color: "text-muted-foreground" },
};

export default async function NotificationsPage() {
  const session = await auth();
  const notifications = await db.notification.findMany({
    where: { organizationId: session!.user.organizationId, OR: [{ userId: null }, { userId: session!.user.id }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="animate-fade-up mx-auto max-w-2xl">
      <PageHeader title="Notifications" description="Email, SMS, and push channels are configured per user in Settings.">
        <MarkAllRead />
      </PageHeader>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {notifications.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {notifications.map((n) => {
            const meta = KIND_META[n.kind];
            return (
              <div key={n.id} className={`flex gap-3 px-5 py-3.5 ${n.isRead ? "opacity-60" : ""}`}>
                <meta.icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                  </div>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                </div>
                {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
