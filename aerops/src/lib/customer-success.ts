import { db } from "@/lib/db";

/**
 * Customer Success engine (Section 19) — AeroOps' own health read on each
 * customer organization, for platform staff only. Same explainability
 * contract as every customer-facing engine: the risk rating always arrives
 * with its factors and a concrete recommended outreach, so a CSM knows what
 * to do, not just who to worry about.
 */
export type OnboardingStep = { label: string; done: boolean };

export type CustomerSuccess = {
  onboarding: { steps: OnboardingStep[]; pct: number };
  activity: { logins14d: number; bookings7d: number; lastActionAt: string | null };
  adoption: { label: string; active: boolean }[];
  risk: "HEALTHY" | "WATCH" | "AT_RISK";
  riskFactors: string[];
  outreach: string[];
};

export async function computeCustomerSuccess(organizationId: string): Promise<CustomerSuccess> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 86_400_000);
  const d14 = new Date(now - 14 * 86_400_000);

  const [org, users, locations, aircraft, bookingsTotal, bookings7d, invoices, logins14d, lastAudit, workOrders, scenes, apiKeys] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { businessProfiles: true, createdAt: true } }),
    db.user.count({ where: { organizationId, deletedAt: null } }),
    db.location.count({ where: { organizationId, isActive: true } }),
    db.aircraft.count({ where: { organizationId } }),
    db.scheduleEvent.count({ where: { organizationId } }),
    db.scheduleEvent.count({ where: { organizationId, start: { gte: d7 } } }),
    db.invoice.count({ where: { organizationId } }),
    db.loginEvent.count({ where: { organizationId, createdAt: { gte: d14 }, success: true } }),
    db.auditLog.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.maintenanceOrder.count({ where: { aircraft: { organizationId } } }),
    db.missionControlScene.count({ where: { organizationId } }),
    db.apiKey.count({ where: { organizationId, revokedAt: null } }),
  ]);

  const steps: OnboardingStep[] = [
    { label: "Business profiles configured", done: (org?.businessProfiles.length ?? 0) > 0 },
    { label: "Location created", done: locations > 0 },
    { label: "Team on board (2+ users)", done: users >= 2 },
    { label: "Fleet added", done: aircraft > 0 },
    { label: "First booking scheduled", done: bookingsTotal > 0 },
    { label: "Billing live (first invoice)", done: invoices > 0 },
  ];
  const pct = Math.round((steps.filter((s) => s.done).length / steps.length) * 100);

  const adoption = [
    { label: "Scheduling", active: bookingsTotal > 0 },
    { label: "Maintenance", active: workOrders > 0 },
    { label: "Billing", active: invoices > 0 },
    { label: "Mission Control scenes", active: scenes > 0 },
    { label: "Developer API", active: apiKeys > 0 },
  ];

  const ageDays = org ? (now - org.createdAt.getTime()) / 86_400_000 : 0;
  const riskFactors: string[] = [];
  const outreach: string[] = [];

  if (logins14d === 0) {
    riskFactors.push("No successful sign-ins in 14 days.");
    outreach.push("Call the owner — the account has gone quiet. Offer a working session.");
  }
  if (bookings7d === 0 && bookingsTotal > 0) {
    riskFactors.push("Scheduling was in use but no bookings in the last 7 days.");
    outreach.push("Ask whether operations moved elsewhere — win-back window is short.");
  }
  if (pct < 50 && ageDays > 14) {
    riskFactors.push(`Onboarding stalled at ${pct}% after ${Math.round(ageDays)} days.`);
    outreach.push("Offer a guided onboarding: import data and finish setup with them live.");
  }
  const inactiveModules = adoption.filter((a) => !a.active).length;
  if (inactiveModules >= 3 && ageDays > 30) {
    riskFactors.push(`${inactiveModules} of ${adoption.length} core capabilities unused after ${Math.round(ageDays)} days.`);
    outreach.push("Book a feature walkthrough — low adoption predicts churn at renewal.");
  }
  if (riskFactors.length === 0) outreach.push("Healthy — a quarterly check-in and an expansion conversation are appropriate.");

  const risk: CustomerSuccess["risk"] = logins14d === 0 ? "AT_RISK" : riskFactors.length > 0 ? "WATCH" : "HEALTHY";

  return {
    onboarding: { steps, pct },
    activity: { logins14d, bookings7d, lastActionAt: lastAudit?.createdAt.toISOString() ?? null },
    adoption,
    risk,
    riskFactors,
    outreach,
  };
}
