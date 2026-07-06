/**
 * Work-order state machine (Section 15A). The single source of truth for
 * which lifecycle moves are legal — the API validates against it and the UI
 * offers only what it allows.
 */
export const WO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["ASSIGNED", "CANCELLED"],
  SCHEDULED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["WAITING_PARTS", "IN_PROGRESS", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "AWAITING_INSPECTION", "CANCELLED"],
  AWAITING_INSPECTION: ["APPROVED", "IN_PROGRESS"],
  APPROVED: ["RETURN_TO_SERVICE"],
  RETURN_TO_SERVICE: ["CLOSED"],
};

export function canTransitionWorkOrder(from: string, to: string): boolean {
  return (WO_TRANSITIONS[from] ?? []).includes(to);
}
