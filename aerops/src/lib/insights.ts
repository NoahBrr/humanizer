import { db } from "@/lib/db";
import { airworthinessOf } from "@/lib/airworthiness";

/**
 * The AeroOps insight engine. Deterministic rules over the platform's
 * computed functions (airworthiness, readiness, workload, profitability,
 * pipeline) generate recommendations that always carry their reasoning,
 * supporting data, and confidence — the Section-13 contract. The LLM copilot
 * NARRATES and ranks these; it never invents them, and it never acts without
 * a human (see SAFETY: dispatch, maintenance approval, payments, deletion
 * all require explicit human action through the permissioned APIs).
 */
export type Insight = {
  category: "OPERATIONS" | "MAINTENANCE" | "TRAINING" | "FINANCE" | "GROWTH";
  severity: "ACT_NOW" | "THIS_WEEK" | "OPPORTUNITY";
  recommendation: string;
  why: string;
  data: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  href: string;
};

export async function generateInsights(organizationId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000);

  const [fleet, students, invoices, leads, instructors] = await Promise.all([
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: {
        components: true,
        scheduleEvents: { where: { start: { gte: now, lte: in7d }, status: "SCHEDULED" }, select: { id: true } },
      },
    }),
    db.student.findMany({
      where: { user: { organizationId, isActive: true }, status: "ENROLLED" },
      include: {
        user: { select: { firstName: true, lastName: true } },
        checkrides: { where: { status: "SCHEDULED" }, select: { id: true } },
        lessonRecords: { select: { date: true }, orderBy: { date: "desc" }, take: 1 },
      },
    }),
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] }, dueAt: { lt: now } },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } }, lines: true, payments: true },
    }),
    db.lead.findMany({ where: { organizationId, status: { notIn: ["ENROLLED", "LOST"] } } }),
    db.instructor.findMany({
      where: { user: { organizationId, isActive: true } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        scheduleEvents: { where: { start: { gte: now, lte: in7d }, status: "SCHEDULED" }, select: { id: true } },
      },
    }),
  ]);

  // --- Maintenance: margin vs booked demand ---------------------------------
  for (const a of fleet) {
    const aw = airworthinessOf(a, a.components);
    if (aw.state === "MAINTENANCE_OVERDUE" || aw.state === "GROUNDED") {
      insights.push({
        category: "MAINTENANCE",
        severity: "ACT_NOW",
        recommendation: `Get ${a.tailNumber} back on the line`,
        why: aw.detail + " Every grounded day forfeits its booked revenue.",
        data: `${a.scheduleEvents.length} booking(s) in the next 7 days depend on it.`,
        confidence: "HIGH",
        href: `/aircraft/${a.id}`,
      });
    } else if (aw.state === "DUE_SOON" && a.scheduleEvents.length > 0) {
      insights.push({
        category: "MAINTENANCE",
        severity: "THIS_WEEK",
        recommendation: `Slot ${a.tailNumber}'s inspection around its bookings`,
        why: `${aw.detail} Booked flights will consume that margin quickly.`,
        data: `${a.scheduleEvents.length} upcoming booking(s) vs the remaining margin.`,
        confidence: "HIGH",
        href: `/aircraft/${a.id}`,
      });
    }
  }

  // --- Training: ready without a checkride; idle students --------------------
  for (const s of students) {
    const hours = Number(s.totalHours);
    if (hours >= 35 && s.checkrides.length === 0) {
      insights.push({
        category: "TRAINING",
        severity: "THIS_WEEK",
        recommendation: `Book a checkride for ${s.user.firstName} ${s.user.lastName}`,
        why: "Hours requirement is met and no checkride is on the calendar — momentum fades fast at this stage.",
        data: `${hours.toFixed(1)} hrs logged vs ~35 required; 0 checkrides scheduled.`,
        confidence: "MEDIUM",
        href: `/students/${s.id}`,
      });
    }
    const last = s.lessonRecords[0]?.date;
    if (last && now.getTime() - last.getTime() > 21 * 86_400_000) {
      insights.push({
        category: "TRAINING",
        severity: "THIS_WEEK",
        recommendation: `Re-engage ${s.user.firstName} ${s.user.lastName}`,
        why: "Students idle 3+ weeks are the highest dropout risk; a personal call from their CFI usually restarts training.",
        data: `Last lesson ${last.toLocaleDateString("en-US")} — ${Math.floor((now.getTime() - last.getTime()) / 86_400_000)} days ago.`,
        confidence: "MEDIUM",
        href: `/students/${s.id}`,
      });
    }
  }

  // --- Finance: overdue collections ------------------------------------------
  if (invoices.length > 0) {
    const total = invoices.reduce(
      (t, inv) => t + inv.lines.reduce((lt, l) => lt + Number(l.quantity) * Number(l.unitPrice), 0) - inv.payments.reduce((pt, p) => pt + Number(p.amount), 0),
      0,
    );
    insights.push({
      category: "FINANCE",
      severity: "ACT_NOW",
      recommendation: `Chase ${invoices.length} overdue invoice(s)`,
      why: "Collection odds fall roughly by half after 60 days past due.",
      data: `$${total.toFixed(2)} past due across ${new Set(invoices.map((i) => i.studentId)).size} account(s).`,
      confidence: "HIGH",
      href: "/billing",
    });
  }

  // --- Growth: follow-ups due -------------------------------------------------
  const followupsDue = leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= now);
  if (followupsDue.length > 0) {
    insights.push({
      category: "GROWTH",
      severity: "ACT_NOW",
      recommendation: `Call ${followupsDue.length} lead(s) with follow-ups due`,
      why: "Lead conversion drops sharply once a promised follow-up slips.",
      data: followupsDue.slice(0, 3).map((l) => `${l.name} (${l.interest ?? l.source})`).join(", ") + (followupsDue.length > 3 ? "…" : ""),
      confidence: "HIGH",
      href: "/crm",
    });
  }

  // --- Operations: instructor load imbalance ----------------------------------
  if (instructors.length >= 2) {
    const sorted = [...instructors].sort((a, b) => b.scheduleEvents.length - a.scheduleEvents.length);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top.scheduleEvents.length >= bottom.scheduleEvents.length + 4) {
      insights.push({
        category: "OPERATIONS",
        severity: "OPPORTUNITY",
        recommendation: `Rebalance lessons from ${top.user.firstName} ${top.user.lastName} to ${bottom.user.firstName} ${bottom.user.lastName}`,
        why: "Uneven load raises burnout and cancellation risk on the loaded CFI while idle capacity goes unbilled.",
        data: `Next 7 days: ${top.user.lastName} ${top.scheduleEvents.length} lessons vs ${bottom.user.lastName} ${bottom.scheduleEvents.length}.`,
        confidence: "MEDIUM",
        href: "/training",
      });
    }
  }

  const rank = { ACT_NOW: 0, THIS_WEEK: 1, OPPORTUNITY: 2 } as const;
  return insights.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
