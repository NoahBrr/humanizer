import type { Aircraft, AircraftComponent } from "@prisma/client";

/**
 * Computed airworthiness — the single answer to "can this aircraft fly?"
 * Derived from operational status plus inspection/component margins, and
 * enforced at dispatch release (not just displayed).
 */
export type Airworthiness =
  | { state: "GROUNDED"; label: "Grounded"; canDispatch: false; detail: string }
  | { state: "OUT_OF_SERVICE"; label: "Out of Service"; canDispatch: false; detail: string }
  | { state: "MAINTENANCE_OVERDUE"; label: "Maintenance Overdue"; canDispatch: false; detail: string }
  | { state: "DUE_SOON"; label: "Maintenance Due Soon"; canDispatch: true; detail: string }
  | { state: "AIRWORTHY"; label: "Airworthy"; canDispatch: true; detail: string };

const HOURS_WARNING = 10;
const DAYS_WARNING = 14;

export function airworthinessOf(
  aircraft: Pick<Aircraft, "status" | "currentHobbs" | "isSimulator">,
  components: Pick<AircraftComponent, "name" | "dueAtHours" | "dueAtDate">[],
): Airworthiness {
  if (aircraft.status === "GROUNDED") return { state: "GROUNDED", label: "Grounded", canDispatch: false, detail: "Grounded by maintenance." };
  if (aircraft.status === "IN_MAINTENANCE") return { state: "OUT_OF_SERVICE", label: "Out of Service", canDispatch: false, detail: "In the shop." };
  if (aircraft.status === "RETIRED") return { state: "OUT_OF_SERVICE", label: "Out of Service", canDispatch: false, detail: "Retired from the fleet." };
  if (aircraft.isSimulator) return { state: "AIRWORTHY", label: "Airworthy", canDispatch: true, detail: "Simulator — no inspections tracked." };

  const hobbs = Number(aircraft.currentHobbs);
  const now = Date.now();
  let dueSoon: string | null = null;

  for (const c of components) {
    if (c.dueAtHours !== null && c.dueAtHours !== undefined) {
      const left = Number(c.dueAtHours) - hobbs;
      if (left <= 0) return { state: "MAINTENANCE_OVERDUE", label: "Maintenance Overdue", canDispatch: false, detail: `${c.name} overdue by ${Math.abs(left).toFixed(1)} hrs.` };
      if (left <= HOURS_WARNING) dueSoon ??= `${c.name} due in ${left.toFixed(1)} hrs.`;
    }
    if (c.dueAtDate) {
      const daysLeft = Math.ceil((c.dueAtDate.getTime() - now) / 86_400_000);
      if (daysLeft <= 0) return { state: "MAINTENANCE_OVERDUE", label: "Maintenance Overdue", canDispatch: false, detail: `${c.name} expired ${Math.abs(daysLeft)} days ago.` };
      if (daysLeft <= DAYS_WARNING) dueSoon ??= `${c.name} due in ${daysLeft} days.`;
    }
  }

  if (dueSoon) return { state: "DUE_SOON", label: "Maintenance Due Soon", canDispatch: true, detail: dueSoon };
  return { state: "AIRWORTHY", label: "Airworthy", canDispatch: true, detail: "All inspections within limits." };
}
