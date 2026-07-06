import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Built-in workflow automations. Each has a key (org can disable), a trigger
 * point in the domain code, and a set of actions. The registry is the seam
 * where the no-code workflow builder lands: user-defined rules compile to
 * the same trigger/action shape.
 */
export const AUTOMATIONS = {
  maintenance_forecast: {
    label: "Maintenance forecast",
    description: "When a flight closes within 5 hours of an inspection limit: notify maintenance and open a work order automatically.",
    trigger: "flight.closed",
  },
  grounding_alerts: {
    label: "Grounding alerts",
    description: "When an aircraft is grounded: notify the organization and flag affected bookings.",
    trigger: "aircraft.grounded",
  },
  waitlist_backfill: {
    label: "Waitlist backfill",
    description: "When a lesson is cancelled: notify that day's waitlisted students so the slot refills.",
    trigger: "schedule.cancelled",
  },
} as const;

export type AutomationKey = keyof typeof AUTOMATIONS;

export async function automationEnabled(organizationId: string, key: AutomationKey) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { disabledAutomations: true } });
  return !org?.disabledAutomations.includes(key);
}

const FORECAST_MARGIN_HOURS = 5;

/**
 * flight.closed → maintenance_forecast
 * Checks every hour-based component on the aircraft; anything inside the
 * margin gets a notification and (if none is already open) a scheduled work
 * order. Runs after the dispatch-close transaction so a failure here can
 * never affect billing.
 */
export async function runMaintenanceForecast(organizationId: string, aircraftId: string) {
  if (!(await automationEnabled(organizationId, "maintenance_forecast"))) return;
  try {
    const aircraft = await db.aircraft.findUnique({ where: { id: aircraftId }, include: { components: true } });
    if (!aircraft) return;
    const hobbs = Number(aircraft.currentHobbs);

    for (const c of aircraft.components) {
      if (c.dueAtHours === null || c.dueAtHours === undefined) continue;
      const left = Number(c.dueAtHours) - hobbs;
      if (left > FORECAST_MARGIN_HOURS) continue;

      const existing = await db.maintenanceOrder.findFirst({
        where: { aircraftId, title: { contains: c.name }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      });
      if (existing) continue;

      await db.maintenanceOrder.create({
        data: {
          aircraftId,
          title: `${c.name} (auto-forecast)`,
          description: `Opened automatically: ${c.name} ${left <= 0 ? `overdue by ${Math.abs(left).toFixed(1)} hrs` : `due in ${left.toFixed(1)} hrs`} at hobbs ${hobbs.toFixed(1)}.`,
          status: "SCHEDULED",
          startDate: new Date(Date.now() + 86_400_000),
        },
      });
      await db.notification.create({
        data: {
          organizationId,
          kind: "MAINTENANCE_DUE",
          title: `${aircraft.tailNumber}: ${c.name} ${left <= 0 ? "overdue" : `due in ${left.toFixed(1)} hrs`}`,
          body: "A work order was opened automatically by the maintenance-forecast automation.",
        },
      });
      logger.info("automation fired", { automation: "maintenance_forecast", aircraftId, component: c.name, left });
    }
  } catch (e) {
    logger.error("automation failed", { automation: "maintenance_forecast", aircraftId, error: String(e) });
  }
}
