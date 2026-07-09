import type { Permission } from "@/lib/permissions";

/**
 * Which dashboard sections a viewer may see, derived from PERMISSIONS (never
 * role names). The dashboard page builds a section's node only when its flag is
 * true, so a viewer never receives data they can't access — a Student Pilot
 * gets no finance node, a Finance Manager gets no ops board. Kept here as a
 * pure function so the gating is a single source of truth and unit-testable.
 * Student Pilots get a dedicated my-training workspace (handled in the page).
 */
export function dashboardCapabilities(perms: ReadonlySet<Permission>) {
  return {
    canSchedule: perms.has("schedule.view"),
    canMaintenance: perms.has("maintenance.view"),
    canStudents: perms.has("students.view") || perms.has("students.manage"),
    canFinance: perms.has("billing.view"),
    canFleet: perms.has("aircraft.view"),
  };
}
