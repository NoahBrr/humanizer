/**
 * Organization Health Score — six categories, each 0–100 with an explanation,
 * averaged into one number. Same philosophy as checkride readiness: never a
 * number without its reasons. The AI copilot narrates these; it doesn't
 * replace them.
 */
export type HealthCategory = { key: string; label: string; score: number; detail: string };
export type HealthScore = { overall: number; categories: HealthCategory[] };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeHealthScore(input: {
  revenueMonth: number;
  outstandingAR: number;
  overdueInvoices: number;
  totalOpenInvoices: number;
  airworthyAircraft: number;
  totalAircraft: number;
  groundingSquawks: number;
  activeStudents: number;
  idleStudents: number;
  avgReadiness: number;
  activeLeads: number;
  conversionRate: number | null; // 0..1 or null when no closed leads yet
  utilizationPct: number;
}): HealthScore {
  const categories: HealthCategory[] = [
    {
      key: "financial",
      label: "Financial",
      score: clamp(100 - (input.revenueMonth > 0 ? (input.outstandingAR / Math.max(input.revenueMonth, 1)) * 60 : 50)),
      detail: `AR ${Math.round(input.outstandingAR).toLocaleString()} vs ${Math.round(input.revenueMonth).toLocaleString()} monthly revenue`,
    },
    {
      key: "collections",
      label: "Collections",
      score: clamp(100 - (input.totalOpenInvoices > 0 ? (input.overdueInvoices / input.totalOpenInvoices) * 100 : 0)),
      detail: `${input.overdueInvoices} of ${input.totalOpenInvoices} open invoices overdue`,
    },
    {
      key: "operational",
      label: "Operational",
      score: clamp(input.totalAircraft > 0 ? (input.airworthyAircraft / input.totalAircraft) * 100 : 100),
      detail: `${input.airworthyAircraft}/${input.totalAircraft} aircraft airworthy`,
    },
    {
      key: "maintenance",
      label: "Maintenance & Safety",
      score: clamp(100 - input.groundingSquawks * 25),
      detail: input.groundingSquawks === 0 ? "No grounding squawks open" : `${input.groundingSquawks} grounding squawk(s) open`,
    },
    {
      key: "training",
      label: "Training",
      score: clamp(input.activeStudents > 0 ? input.avgReadiness * 0.6 + (1 - input.idleStudents / input.activeStudents) * 40 : 50),
      detail: `avg readiness ${Math.round(input.avgReadiness)} · ${input.idleStudents} of ${input.activeStudents} students idle 21d+`,
    },
    {
      key: "growth",
      label: "Growth",
      score: clamp((input.conversionRate === null ? 0.5 : input.conversionRate) * 60 + Math.min(input.activeLeads, 10) * 4),
      detail: `${input.activeLeads} active leads · ${input.conversionRate === null ? "no closed leads yet" : `${Math.round(input.conversionRate * 100)}% conversion`}`,
    },
  ];

  return { overall: clamp(categories.reduce((t, c) => t + c.score, 0) / categories.length), categories };
}

/**
 * Assemble the health-score inputs from the database and score them. The one
 * shared implementation behind the executive workspace and Mission Control —
 * the input derivations (21-day idle rule, 40-hour readiness proxy, 180
 * hrs/quarter utilization basis) live here so the two surfaces can never
 * drift apart.
 */
export async function computeOrgHealth(organizationId: string): Promise<HealthScore> {
  // Imported lazily so the pure scoring function stays importable anywhere.
  const { db } = await import("@/lib/db");
  const { airworthinessOf } = await import("@/lib/airworthiness");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const since90 = new Date(now.getTime() - 90 * 86_400_000);

  const [payMonth, openInvoices, fleet, leads, students, hours90] = await Promise.all([
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { lines: true, payments: true },
    }),
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: { components: true, squawks: { where: { severity: "GROUNDING", status: { notIn: ["RESOLVED", "CLOSED"] } } } },
    }),
    db.lead.findMany({ where: { organizationId }, select: { status: true } }),
    db.student.findMany({
      where: { user: { organizationId, isActive: true }, status: "ENROLLED" },
      select: { totalHours: true, lessonRecords: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
    }),
    db.dispatch.aggregate({
      where: { aircraft: { organizationId }, status: "CLOSED", closedAt: { gte: since90 } },
      _sum: { flightTime: true },
    }),
  ]);

  const outstandingAR = openInvoices.reduce(
    (t, inv) => t + inv.lines.reduce((lt, l) => lt + Number(l.quantity) * Number(l.unitPrice), 0) - inv.payments.reduce((pt, p) => pt + Number(p.amount), 0),
    0,
  );
  const overdue = openInvoices.filter((i) => i.status === "OVERDUE" || (i.dueAt && i.dueAt < now)).length;
  const airworthy = fleet.filter((a) => airworthinessOf(a, a.components).canDispatch).length;
  const groundingSquawks = fleet.reduce((t, a) => t + a.squawks.length, 0);
  const idleStudents = students.filter((s) => !s.lessonRecords[0] || now.getTime() - s.lessonRecords[0].date.getTime() > 21 * 86_400_000).length;
  const enrolledLeads = leads.filter((l) => l.status === "ENROLLED").length;
  const closedLeads = enrolledLeads + leads.filter((l) => l.status === "LOST").length;
  const totalHours90 = Number(hours90._sum.flightTime ?? 0);

  return computeHealthScore({
    revenueMonth: Number(payMonth._sum.amount ?? 0),
    outstandingAR,
    overdueInvoices: overdue,
    totalOpenInvoices: openInvoices.length,
    airworthyAircraft: airworthy,
    totalAircraft: fleet.length,
    groundingSquawks,
    activeStudents: students.length,
    idleStudents,
    avgReadiness: students.length ? Math.min(100, (students.reduce((t, s) => t + Number(s.totalHours), 0) / students.length / 40) * 100) : 0,
    activeLeads: leads.filter((l) => !["ENROLLED", "LOST"].includes(l.status)).length,
    conversionRate: closedLeads > 0 ? enrolledLeads / closedLeads : null,
    utilizationPct: fleet.length ? (totalHours90 / (fleet.length * 180)) * 100 : 0,
  });
}
