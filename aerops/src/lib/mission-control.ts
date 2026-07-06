import { db } from "@/lib/db";
import { fleetHealthOf } from "@/lib/fleet-health";
import { generateInsights, type Insight } from "@/lib/insights";
import type { ModuleKey } from "@/lib/features";
import type { MaintenanceStatus } from "@prisma/client";

/**
 * Mission Control snapshot (Section 16A). One server-side pass over the
 * operational picture, shaped for a room-readable wall display and streamed
 * to clients over SSE. Sections are business-profile / module / permission
 * aware: a gated section comes back null and simply doesn't render, so a
 * flying club, an FBO, and a Part 141 school each see their own wall.
 */
export type MissionControlSnapshot = {
  at: string;
  organization: string;
  statusBar: {
    weather: string;
    aircraftAvailable: number;
    aircraftFlying: number;
    aircraftGrounded: number;
    flightsToday: number;
    unreadAlerts: number;
  };
  ops: {
    active: OpsFlight[];
    upcoming: OpsFlight[];
    completed: number;
    cancelled: number;
  } | null;
  fleet: { tail: string; model: string; status: string; score: number; rating: string; hobbs: number }[];
  maintenance: { backlog: number; inShop: number; lowStock: { partNumber: string; quantity: number; minQuantity: number }[]; awaitingInspection: number } | null;
  training: { enrolled: number; checkrides: { student: string; rating: string; date: string; status: string }[] } | null;
  finance: { overdueTotal: number; paymentsMtd: number; openInvoices: number } | null;
  alerts: { id: string; title: string; body: string | null; kind: string; createdAt: string; critical: boolean; unread: boolean }[];
  insights: Insight[];
};

export type OpsFlight = {
  id: string;
  start: string;
  end: string;
  status: string;
  tail: string | null;
  student: string | null;
  instructor: string | null;
  type: string;
};

const CRITICAL_KINDS = new Set(["AIRCRAFT_GROUNDED", "WEATHER_CANCELLATION", "MAINTENANCE_DUE"]);
const ACTIVE_WO: MaintenanceStatus[] = ["OPEN", "SCHEDULED", "ASSIGNED", "WAITING_PARTS", "IN_PROGRESS", "AWAITING_INSPECTION", "APPROVED", "RETURN_TO_SERVICE"];

export async function buildMissionControlSnapshot(opts: {
  organizationId: string;
  modules: Set<ModuleKey>;
  businessProfiles: string[];
  canSeeFinance: boolean;
}): Promise<MissionControlSnapshot> {
  const { organizationId } = opts;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isTrainingOrg = opts.businessProfiles.some((p) => p === "part_61" || p === "part_141");
  const hasMaintenance = opts.modules.has("maintenance");
  const hasBilling = opts.modules.has("billing");

  const [org, aircraft, events, notifications, insights] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: {
        aircraftType: { select: { model: true } },
        components: true,
        squawks: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, select: { severity: true } },
        maintenance: { where: { startDate: { gte: new Date(now.getTime() - 90 * 86_400_000) } }, select: { startDate: true, status: true, category: true } },
      },
      orderBy: { tailNumber: "asc" },
    }),
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: dayStart, lte: dayEnd } },
      include: {
        aircraft: { select: { tailNumber: true } },
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        lessonType: { select: { name: true } },
      },
      orderBy: { start: "asc" },
    }),
    db.notification.findMany({
      where: { organizationId, userId: null },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    generateInsights(organizationId),
  ]);

  const [maintenance, training, finance] = await Promise.all([
    hasMaintenance ? maintenanceSection(organizationId) : Promise.resolve(null),
    isTrainingOrg ? trainingSection(organizationId, now) : Promise.resolve(null),
    opts.canSeeFinance && hasBilling ? financeSection(organizationId, monthStart) : Promise.resolve(null),
  ]);

  const fleet = aircraft.map((a) => {
    const health = fleetHealthOf(a, a.components, a.squawks, a.maintenance);
    return { tail: a.tailNumber, model: a.aircraftType.model, status: a.status, score: health.score, rating: health.rating, hobbs: Number(a.currentHobbs) };
  });

  const toOps = (e: (typeof events)[number]): OpsFlight => ({
    id: e.id,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    status: e.status,
    tail: e.aircraft?.tailNumber ?? null,
    student: e.student ? `${e.student.user.firstName} ${e.student.user.lastName}` : null,
    instructor: e.instructor ? `${e.instructor.user.firstName} ${e.instructor.user.lastName}` : null,
    type: e.lessonType?.name ?? e.type.replaceAll("_", " ").toLowerCase(),
  });

  const active = events.filter((e) => ["DISPATCHED", "IN_FLIGHT"].includes(e.status)).map(toOps);
  const upcoming = events.filter((e) => e.status === "SCHEDULED" && e.end >= now).map(toOps).slice(0, 8);

  return {
    at: now.toISOString(),
    organization: org?.name ?? "",
    statusBar: {
      weather: "VFR · 310° 8kt · 10SM · SCT045 · 22°C",
      aircraftAvailable: aircraft.filter((a) => a.status === "AVAILABLE").length,
      aircraftFlying: active.length,
      aircraftGrounded: aircraft.filter((a) => ["GROUNDED", "IN_MAINTENANCE"].includes(a.status)).length,
      flightsToday: events.filter((e) => !["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)).length,
      unreadAlerts: notifications.filter((n) => !n.isRead).length,
    },
    ops: opts.modules.has("scheduling")
      ? {
          active,
          upcoming,
          completed: events.filter((e) => e.status === "COMPLETED").length,
          cancelled: events.filter((e) => ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)).length,
        }
      : null,
    fleet,
    maintenance,
    training,
    finance,
    alerts: notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      kind: n.kind,
      createdAt: n.createdAt.toISOString(),
      critical: CRITICAL_KINDS.has(n.kind) || n.title.startsWith("Low stock"),
      unread: !n.isRead,
    })),
    insights: insights.slice(0, 4),
  };
}

async function maintenanceSection(organizationId: string) {
  const [orders, parts, inShop] = await Promise.all([
    db.maintenanceOrder.findMany({ where: { aircraft: { organizationId }, status: { in: ACTIVE_WO } }, select: { status: true } }),
    db.part.findMany({ where: { organizationId }, select: { partNumber: true, quantity: true, minQuantity: true } }),
    db.aircraft.count({ where: { organizationId, status: { in: ["GROUNDED", "IN_MAINTENANCE"] } } }),
  ]);
  return {
    backlog: orders.length,
    inShop,
    awaitingInspection: orders.filter((o) => o.status === "AWAITING_INSPECTION").length,
    lowStock: parts.filter((p) => p.quantity < p.minQuantity),
  };
}

async function trainingSection(organizationId: string, now: Date) {
  const [enrolled, checkrides] = await Promise.all([
    db.student.count({ where: { user: { organizationId, isActive: true }, status: "ENROLLED" } }),
    db.checkride.findMany({
      where: { student: { user: { organizationId } }, date: { gte: now, lte: new Date(now.getTime() + 14 * 86_400_000) } },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { date: "asc" },
      take: 6,
    }),
  ]);
  return {
    enrolled,
    checkrides: checkrides.map((c) => ({
      student: `${c.student.user.firstName} ${c.student.user.lastName}`,
      rating: c.rating.replaceAll("_", " "),
      date: c.date.toISOString(),
      status: c.status,
    })),
  };
}

async function financeSection(organizationId: string, monthStart: Date) {
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { lines: true, payments: true },
    }),
    db.payment.findMany({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, select: { amount: true } }),
  ]);
  const now = Date.now();
  const overdueTotal = invoices
    .filter((i) => i.dueAt && i.dueAt.getTime() < now)
    .reduce((t, i) => {
      const billed = i.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
      const paid = i.payments.reduce((s, p) => s + Number(p.amount), 0);
      return t + Math.max(0, billed - paid);
    }, 0);
  return {
    overdueTotal,
    paymentsMtd: payments.reduce((t, p) => t + Number(p.amount), 0),
    openInvoices: invoices.length,
  };
}
