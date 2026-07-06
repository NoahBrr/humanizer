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
