/**
 * Canonical operational status colors (Section 3 design system). These NEVER
 * change anywhere in the application:
 *
 *   Scheduled → blue        Released/Dispatched → purple
 *   In Flight → green       Completed → gray
 *   Cancelled → red         Maintenance → orange
 *   Grounded → dark red
 *
 * `tone` feeds the Badge component; `hex` feeds SVG/calendar surfaces where
 * CSS classes can't reach. Both light- and dark-mode hexes keep ≥3:1 contrast
 * against their surface.
 */
export type StatusTone = "blue" | "purple" | "green" | "gray" | "red" | "darkred" | "orange" | "amber" | "cyan" | "black";

const STATUS_TONE: Record<string, StatusTone> = {
  // Scheduling / dispatch lifecycle
  SCHEDULED: "blue",
  PENDING: "amber",
  DISPATCHED: "purple",
  RELEASED: "purple",
  IN_FLIGHT: "green",
  COMPLETED: "gray",
  CLOSED: "gray",
  CANCELLED: "red",
  NO_SHOW: "black",
  WEATHER_CANCELLED: "cyan",
  // Aircraft
  AVAILABLE: "green",
  RESERVED: "amber",
  IN_MAINTENANCE: "orange",
  IN_PROGRESS: "orange",
  GROUNDED: "darkred",
  RETIRED: "gray",
  // Squawks
  OPEN: "blue",
  ASSIGNED: "purple",
  WAITING_PARTS: "amber",
  TESTING: "cyan",
  AWAITING_INSPECTION: "amber",
  APPROVED: "green",
  MORE_INFO: "cyan",
  REJECTED: "red",
  RETURN_TO_SERVICE: "green",
  AOG: "darkred",
  EMERGENCY: "darkred",
  CRITICAL: "red",
  HIGH: "orange",
  NORMAL: "blue",
  LOW: "gray",
  RESOLVED: "green",
  DEFERRED: "amber",
  GROUNDING: "darkred",
  MAJOR: "orange",
  MINOR: "gray",
  // Billing
  PAID: "green",
  PARTIALLY_PAID: "amber",
  OVERDUE: "red",
  DRAFT: "gray",
  VOID: "gray",
  // Training / org
  PASSED: "green",
  FAILED: "red",
  DISCONTINUED: "gray",
  EXCELLENT: "green",
  GOOD: "blue",
  MONITOR: "amber",
  ATTENTION_NEEDED: "orange",
  SATISFACTORY: "blue",
  NEEDS_IMPROVEMENT: "amber",
  INCOMPLETE: "gray",
  AIRWORTHY: "green",
  MAINTENANCE_OVERDUE: "red",
  DUE_SOON: "amber",
  OUT_OF_SERVICE: "gray",
  ACTIVE: "green",
  SUSPENDED: "red",
  DELETED: "gray",
};

export function statusToneOf(status: string): StatusTone {
  return STATUS_TONE[status] ?? "gray";
}

/** Solid fills for calendar blocks / SVG marks, per theme. */
export const STATUS_HEX: Record<StatusTone, { light: string; dark: string }> = {
  blue: { light: "#2563eb", dark: "#3b82f6" },
  purple: { light: "#7c3aed", dark: "#8b5cf6" },
  green: { light: "#059669", dark: "#10b981" },
  gray: { light: "#6b7280", dark: "#6b7280" },
  red: { light: "#dc2626", dark: "#ef4444" },
  darkred: { light: "#7f1d1d", dark: "#991b1b" },
  orange: { light: "#ea580c", dark: "#f97316" },
  amber: { light: "#d97706", dark: "#f59e0b" },
  cyan: { light: "#0891b2", dark: "#06b6d4" },
  black: { light: "#1f2937", dark: "#111827" },
};

export function statusHex(status: string, mode: "light" | "dark" = "light") {
  return STATUS_HEX[statusToneOf(status)][mode];
}
