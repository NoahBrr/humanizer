import type { Aircraft, MaintenanceOrder, Squawk } from "@prisma/client";
import { airworthinessOf, type Airworthiness } from "@/lib/airworthiness";

/**
 * Fleet Health Score — a 0-100 per-aircraft condition index (Section 15B).
 * Like readiness and the org health score, it is explainable: every deduction
 * is returned as a factor with the data behind it, so a maintenance director
 * can see WHY an aircraft is rated "Attention Needed", not just that it is.
 */
export type FleetHealthRating = "EXCELLENT" | "GOOD" | "MONITOR" | "ATTENTION_NEEDED" | "CRITICAL";

export type FleetHealthFactor = { label: string; impact: number; detail: string };

export type FleetHealth = {
  score: number;
  rating: FleetHealthRating;
  ratingLabel: string;
  airworthiness: Airworthiness;
  factors: FleetHealthFactor[];
};

const RATING_LABELS: Record<FleetHealthRating, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  MONITOR: "Monitor",
  ATTENTION_NEEDED: "Attention Needed",
  CRITICAL: "Critical",
};

const ENGINE_TBO_HOURS = 2000; // typical piston TBO baseline until per-type TBO is modeled
const REPEAT_WINDOW_DAYS = 90;

export function fleetHealthOf(
  aircraft: Pick<Aircraft, "status" | "currentHobbs" | "isSimulator" | "engineTimeSmoh">,
  components: Parameters<typeof airworthinessOf>[1],
  openSquawks: Pick<Squawk, "severity">[],
  recentOrders: Pick<MaintenanceOrder, "startDate" | "status" | "category">[],
): FleetHealth {
  const airworthiness = airworthinessOf(aircraft, components);
  const factors: FleetHealthFactor[] = [];
  let score = 100;

  const deduct = (label: string, impact: number, detail: string) => {
    factors.push({ label, impact: -impact, detail });
    score -= impact;
  };

  // 1. Airworthiness state is the loudest signal.
  if (airworthiness.state === "GROUNDED") deduct("Grounded", 35, airworthiness.detail);
  else if (airworthiness.state === "OUT_OF_SERVICE") deduct("Out of service", 25, airworthiness.detail);
  else if (airworthiness.state === "MAINTENANCE_OVERDUE") deduct("Inspection overdue", 30, airworthiness.detail);
  else if (airworthiness.state === "DUE_SOON") deduct("Inspection due soon", 8, airworthiness.detail);

  // 2. Open squawks, weighted by severity (capped so one noisy aircraft log doesn't zero the score).
  const grounding = openSquawks.filter((s) => s.severity === "GROUNDING").length;
  const major = openSquawks.filter((s) => s.severity === "MAJOR").length;
  const minor = openSquawks.length - grounding - major;
  const squawkImpact = Math.min(30, grounding * 20 + major * 8 + minor * 3);
  if (squawkImpact > 0) {
    deduct(
      "Open squawks",
      squawkImpact,
      [grounding && `${grounding} grounding`, major && `${major} major`, minor && `${minor} minor`].filter(Boolean).join(", ") + " open",
    );
  }

  // 3. Repeat maintenance — more than one unscheduled shop visit in 90 days suggests a recurring problem.
  const windowStart = Date.now() - REPEAT_WINDOW_DAYS * 86_400_000;
  const recent = recentOrders.filter((o) => o.startDate.getTime() >= windowStart && o.status !== "CANCELLED");
  if (recent.length > 1) {
    deduct(
      "Repeat maintenance",
      Math.min(18, (recent.length - 1) * 6),
      `${recent.length} work orders in the last ${REPEAT_WINDOW_DAYS} days${dominantCategory(recent) ? ` (mostly ${dominantCategory(recent)})` : ""}.`,
    );
  }

  // 4. Engine time approaching TBO raises exposure to a major overhaul event.
  const smoh = Number(aircraft.engineTimeSmoh);
  if (!aircraft.isSimulator && smoh >= ENGINE_TBO_HOURS) deduct("Engine past TBO", 20, `${smoh.toFixed(0)} hrs SMOH vs ${ENGINE_TBO_HOURS} hr TBO baseline.`);
  else if (!aircraft.isSimulator && smoh >= ENGINE_TBO_HOURS * 0.85) deduct("Engine nearing TBO", 8, `${smoh.toFixed(0)} hrs SMOH — within 15% of the ${ENGINE_TBO_HOURS} hr TBO baseline.`);

  score = Math.max(0, Math.round(score));
  const rating: FleetHealthRating =
    score >= 90 ? "EXCELLENT" : score >= 75 ? "GOOD" : score >= 60 ? "MONITOR" : score >= 40 ? "ATTENTION_NEEDED" : "CRITICAL";

  return { score, rating, ratingLabel: RATING_LABELS[rating], airworthiness, factors };
}

function dominantCategory(orders: Pick<MaintenanceOrder, "category">[]): string | null {
  const counts = new Map<string, number>();
  for (const o of orders) if (o.category) counts.set(o.category, (counts.get(o.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 1 ? top[0] : null;
}
