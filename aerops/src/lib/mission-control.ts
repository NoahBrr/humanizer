import { db } from "@/lib/db";
import { fleetHealthOf } from "@/lib/fleet-health";
import { generateInsights, type Insight } from "@/lib/insights";
import { computeOrgHealth, type HealthScore } from "@/lib/health-score";
import { buildOperationalForecast, type OperationalForecast } from "@/lib/forecast";
import type { ModuleKey } from "@/lib/features";
import type { MaintenanceStatus } from "@prisma/client";
import { airportWeather, icaoOf, weatherSummary, type AirportWeather } from "@/lib/weather";
export type { AirportWeather } from "@/lib/weather";

/**
 * Mission Control snapshot (Sections 16A/16B). One server-side pass over the
 * operational picture, shaped for a room-readable wall display and streamed
 * to clients over SSE. Every widget renders from this single snapshot — no
 * widget polls the database independently (the Section 16B contract).
 * Sections are business-profile / module / permission aware: a gated section
 * comes back null and simply doesn't render, so a flying club, an FBO, and a
 * Part 141 school each see their own wall.
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
  kpi: {
    flightsToday: number;
    completedToday: number;
    enrolledStudents: number;
    airworthy: number;
    totalAircraft: number;
    openSquawks: number;
    newLeads7d: number;
    /** null when the viewer lacks billing.view */
    revenueToday: number | null;
    revenueMtd: number | null;
  };
  ops: {
    active: OpsFlight[];
    upcoming: OpsFlight[];
    completed: number;
    cancelled: number;
  } | null;
  fleet: FleetCard[];
  weather: AirportWeather[];
  maintenance: { backlog: number; inShop: number; lowStock: { partNumber: string; quantity: number; minQuantity: number }[]; awaitingInspection: number } | null;
  training: { enrolled: number; checkrides: { student: string; rating: string; date: string; status: string }[] } | null;
  cfi: { instructors: { name: string; cfiDays: number | null; medicalDays: number | null; hours7d: number }[] } | null;
  crm: { newLeads7d: number; followUpsDue: number; pipelineValue: number; openLeads: number } | null;
  finance: { overdueTotal: number; paymentsMtd: number; paymentsToday: number; openInvoices: number } | null;
  /** Organization health score with explained categories — null without reports.view */
  health: HealthScore | null;
  /** Tomorrow's operational forecast with predicted conflicts */
  forecast: OperationalForecast;
  /** Today's operational actions from the immutable audit trail */
  timeline: { at: string; actor: string; action: string; entityType: string }[];
  alerts: WallAlert[];
  insights: Insight[];
};

export type AlertPriority = "EMERGENCY" | "CRITICAL" | "HIGH" | "ATTENTION" | "INFO";

export type WallAlert = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  createdAt: string;
  priority: AlertPriority;
  critical: boolean;
  unread: boolean;
};

export type FleetCard = {
  tail: string;
  model: string;
  status: string;
  score: number;
  rating: string;
  hobbs: number;
  tach: number;
  openSquawks: number;
  /** hours until the tightest hour-based inspection, null if none tracked */
  hoursToInspection: number | null;
  /** next SCHEDULED flight today, e.g. "14:00 · T. Nguyen" */
  nextFlight: string | null;
  todayFlights: number;
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

const ACTIVE_WO: MaintenanceStatus[] = ["OPEN", "SCHEDULED", "ASSIGNED", "WAITING_PARTS", "IN_PROGRESS", "AWAITING_INSPECTION", "APPROVED", "RETURN_TO_SERVICE"];

/**
 * Section 16C prioritization: every alert is classified so the wall can
 * surface what matters without anyone searching for it. EMERGENCY is
 * reserved for incident/emergency operations (future incident command).
 */
const PRIORITY_RANK: Record<AlertPriority, number> = { EMERGENCY: 0, CRITICAL: 1, HIGH: 2, ATTENTION: 3, INFO: 4 };

function classifyAlert(kind: string, title: string): AlertPriority {
  if (kind === "AIRCRAFT_GROUNDED") return "CRITICAL";
  if (kind === "WEATHER_CANCELLATION" || kind === "MAINTENANCE_DUE" || title.startsWith("Low stock")) return "HIGH";
  if (kind === "BALANCE_DUE" || kind === "SQUAWK_REPORTED" || kind === "DOCUMENT_EXPIRING" || kind === "INSTRUCTOR_UNAVAILABLE") return "ATTENTION";
  return "INFO";
}

const TIMELINE_PREFIXES = ["schedule.", "dispatch.", "maintenance.", "inventory.", "aircraft.", "squawk", "lead", "mission_control."];

export type SnapshotOptions = {
  organizationId: string;
  modules: Set<ModuleKey>;
  businessProfiles: string[];
  canSeeFinance: boolean;
  canSeeCrm: boolean;
  canSeeCfi: boolean;
  canSeeHealth: boolean;
};

export async function buildMissionControlSnapshot(opts: SnapshotOptions): Promise<MissionControlSnapshot> {
  const { organizationId } = opts;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const isTrainingOrg = opts.businessProfiles.some((p) => p === "part_61" || p === "part_141");
  const hasMaintenance = opts.modules.has("maintenance");
  const hasBilling = opts.modules.has("billing");

  const [org, aircraft, events, notifications, insights, locations, enrolledStudents, leadStats] = await Promise.all([
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
    db.location.findMany({ where: { organizationId, isActive: true }, select: { icao: true, name: true }, orderBy: { name: "asc" } }),
    db.student.count({ where: { user: { organizationId, isActive: true }, status: "ENROLLED" } }),
    db.lead.findMany({
      where: { organizationId, status: { notIn: ["ENROLLED", "LOST"] } },
      select: { estValue: true, nextFollowUp: true, createdAt: true },
    }),
  ]);

  const [maintenance, training, finance, cfi, health, forecast, auditRows] = await Promise.all([
    hasMaintenance ? maintenanceSection(organizationId) : Promise.resolve(null),
    isTrainingOrg ? trainingSection(organizationId, now) : Promise.resolve(null),
    opts.canSeeFinance && hasBilling ? financeSection(organizationId, monthStart, dayStart) : Promise.resolve(null),
    opts.canSeeCfi && isTrainingOrg ? cfiSection(organizationId, now) : Promise.resolve(null),
    opts.canSeeHealth ? computeOrgHealth(organizationId) : Promise.resolve(null),
    buildOperationalForecast(organizationId),
    db.auditLog.findMany({
      where: { organizationId, createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { createdAt: true, actorLabel: true, action: true, entityType: true },
    }),
  ]);

  const timeline = auditRows
    .filter((r) => TIMELINE_PREFIXES.some((p) => r.action.startsWith(p)) || (opts.canSeeFinance && r.action.startsWith("billing.")))
    .slice(0, 12)
    .map((r) => ({ at: r.createdAt.toISOString(), actor: r.actorLabel, action: r.action, entityType: r.entityType ?? "" }));

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

  const fleet: FleetCard[] = aircraft.map((a) => {
    const health = fleetHealthOf(a, a.components, a.squawks, a.maintenance);
    const hobbs = Number(a.currentHobbs);
    const hourMargins = a.components
      .filter((c) => c.dueAtHours !== null && c.dueAtHours !== undefined)
      .map((c) => Number(c.dueAtHours) - hobbs);
    const todays = events.filter((e) => e.aircraft?.tailNumber === a.tailNumber && !["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status));
    const next = todays.find((e) => e.status === "SCHEDULED" && e.end >= now);
    return {
      tail: a.tailNumber,
      model: a.aircraftType.model,
      status: a.status,
      score: health.score,
      rating: health.rating,
      hobbs,
      tach: Number(a.currentTach),
      openSquawks: a.squawks.length,
      hoursToInspection: hourMargins.length ? Math.min(...hourMargins) : null,
      nextFlight: next
        ? `${next.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${next.student ? `${next.student.user.firstName[0]}. ${next.student.user.lastName}` : "Open"}`
        : null,
      todayFlights: todays.length,
    };
  });

  const flightsToday = events.filter((e) => !["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)).length;
  const completedToday = events.filter((e) => e.status === "COMPLETED").length;

  return {
    at: now.toISOString(),
    organization: org?.name ?? "",
    statusBar: {
      weather: locations.length
        ? (() => { const w = airportWeather(icaoOf(locations[0]), locations[0].name, now); return `${w.category} · ${icaoOf(locations[0])} ${weatherSummary(w)}`; })()
        : "No location configured",
      aircraftAvailable: aircraft.filter((a) => a.status === "AVAILABLE").length,
      aircraftFlying: active.length,
      aircraftGrounded: aircraft.filter((a) => ["GROUNDED", "IN_MAINTENANCE"].includes(a.status)).length,
      flightsToday,
      unreadAlerts: notifications.filter((n) => !n.isRead).length,
    },
    kpi: {
      flightsToday,
      completedToday,
      enrolledStudents,
      airworthy: fleet.filter((f) => !["GROUNDED", "IN_MAINTENANCE", "RETIRED"].includes(f.status)).length,
      totalAircraft: fleet.length,
      openSquawks: fleet.reduce((t, f) => t + f.openSquawks, 0),
      newLeads7d: leadStats.filter((l) => l.createdAt >= weekAgo).length,
      revenueToday: finance ? finance.paymentsToday : null,
      revenueMtd: finance ? finance.paymentsMtd : null,
    },
    ops: opts.modules.has("scheduling")
      ? {
          active,
          upcoming,
          completed: completedToday,
          cancelled: events.filter((e) => ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)).length,
        }
      : null,
    fleet,
    weather: locations.map((l) => airportWeather(icaoOf(l), l.name, now)),
    maintenance,
    training,
    cfi,
    crm: opts.canSeeCrm
      ? {
          newLeads7d: leadStats.filter((l) => l.createdAt >= weekAgo).length,
          followUpsDue: leadStats.filter((l) => l.nextFollowUp && l.nextFollowUp <= now).length,
          pipelineValue: leadStats.reduce((t, l) => t + Number(l.estValue ?? 0), 0),
          openLeads: leadStats.length,
        }
      : null,
    finance,
    health,
    forecast,
    timeline,
    alerts: notifications
      .map((n) => {
        const priority = classifyAlert(n.kind, n.title);
        return {
          id: n.id,
          title: n.title,
          body: n.body,
          kind: n.kind,
          createdAt: n.createdAt.toISOString(),
          priority,
          critical: PRIORITY_RANK[priority] <= PRIORITY_RANK.HIGH,
          unread: !n.isRead,
        };
      })
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt)),
    insights: insights.slice(0, 4),
  };
}

/**
 * Deterministic demo weather, stable per airport per hour. This is the seam
 * where live METAR/TAF feeds (Aviation Weather API) connect in production —
 * the shape and risk flags are what Mission Control consumes either way.
 */

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

async function cfiSection(organizationId: string, now: Date) {
  const instructors = await db.instructor.findMany({
    where: { user: { organizationId, isActive: true } },
    include: {
      user: { select: { firstName: true, lastName: true } },
      scheduleEvents: {
        where: { start: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) }, status: "SCHEDULED" },
        select: { start: true, end: true },
      },
    },
  });
  const days = (d: Date | null) => (d ? Math.ceil((d.getTime() - now.getTime()) / 86_400_000) : null);
  return {
    instructors: instructors.map((i) => ({
      name: `${i.user.firstName} ${i.user.lastName}`,
      cfiDays: days(i.cfiExpiration),
      medicalDays: days(i.medicalExpiration),
      hours7d: i.scheduleEvents.reduce((t, e) => t + (e.end.getTime() - e.start.getTime()) / 3_600_000, 0),
    })),
  };
}

async function financeSection(organizationId: string, monthStart: Date, dayStart: Date) {
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { lines: true, payments: true },
    }),
    db.payment.findMany({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, select: { amount: true, paidAt: true } }),
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
    paymentsToday: payments.filter((p) => p.paidAt >= dayStart).reduce((t, p) => t + Number(p.amount), 0),
    openInvoices: invoices.length,
  };
}
