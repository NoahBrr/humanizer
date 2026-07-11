import { db } from "@/lib/db";
import { hashToken, generateToken } from "@/lib/tokens";

/**
 * Responsible payer domain (doc 11). A payer is a real login (User) linked to
 * one or more students via StudentPayerRelationship — NOT an org membership, so
 * payers reach only a dedicated /payer surface and see ONLY the students and
 * invoices they are authorized for. This module owns payer-scope resolution
 * (the access boundary) and default-payer resolution. No money moves here.
 */

export type PayerScope = {
  /** ResponsiblePayer ids the acting user owns (ACTIVE), across orgs. */
  payerIds: string[];
  /** Student ids whose WHOLE financial history the user may view (ACTIVE
   *  relationships with fullFinancialVisibility). Bill-to reviews — those billed
   *  to this payer — are matched separately by payerId and never depend on this. */
  viewableStudentIds: string[];
  /** Student ids the user may manage payment methods for. */
  manageableStudentIds: string[];
  /** True if the user is a payer for at least one active relationship. */
  isPayer: boolean;
};

/**
 * Resolve what a signed-in user may access AS A PAYER. Derives entirely from
 * their own ACTIVE ResponsiblePayer rows and ACTIVE relationships — never from a
 * client-supplied org or student id, so a missing filter fails closed to
 * nothing, not to a tenant.
 */
type PayerRow = {
  id: string;
  relationships: { studentId: string; fullFinancialVisibility: boolean; canManagePaymentMethods: boolean }[];
};

/**
 * Pure scope derivation (contract-tested). viewableStudentIds is built ONLY
 * from relationships with fullFinancialVisibility — a payer's default view is
 * their OWN bill-to reviews (matched separately by payerId), NEVER a linked
 * student's whole financial history unless explicitly granted (doc 11 §3.9).
 */
export function payerScopeFromRelationships(payers: PayerRow[]): PayerScope {
  const payerIds = payers.map((p) => p.id);
  const viewable = new Set<string>();
  const manageable = new Set<string>();
  for (const p of payers) {
    for (const r of p.relationships) {
      if (r.fullFinancialVisibility) viewable.add(r.studentId);
      if (r.canManagePaymentMethods) manageable.add(r.studentId);
    }
  }
  return { payerIds, viewableStudentIds: [...viewable], manageableStudentIds: [...manageable], isPayer: payerIds.length > 0 };
}

export async function resolvePayerScope(userId: string): Promise<PayerScope> {
  const payers = await db.responsiblePayer.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      relationships: {
        where: { status: "ACTIVE" },
        select: { studentId: true, fullFinancialVisibility: true, canManagePaymentMethods: true },
      },
    },
  });
  return payerScopeFromRelationships(payers);
}

/** A Prisma `where` fragment limiting invoices/reviews to a payer's scope. */
export function payerRecordFilter(scope: PayerScope): { OR: object[] } {
  return {
    OR: [
      { payerId: { in: scope.payerIds.length ? scope.payerIds : ["__none__"] } },
      { studentId: { in: scope.viewableStudentIds.length ? scope.viewableStudentIds : ["__none__"] } },
    ],
  };
}

/**
 * The bill-to party for a review/dispatch (doc 11 §3): an explicit payer wins,
 * else the student's default ACTIVE payer, else the student self-pays. Returns
 * the basis so the answer carries its reason (never a silent guess).
 */
export type BillToResolution = {
  payerId: string | null;
  basis: "explicit_dispatch" | "student_default" | "self_pay";
  warning?: string;
};

export async function resolveDefaultPayer(
  organizationId: string,
  studentId: string | null,
  explicitPayerId: string | null,
): Promise<BillToResolution> {
  // An explicit dispatch selection wins ONLY if it is still an ACTIVE, in-org
  // relationship for this student (doc 11 §3.6 rule 1). A revoked/suspended or
  // cross-tenant id never becomes the frozen bill-to — it falls through with a
  // warning so the answer carries its reason (CONSTITUTION rule 6).
  if (explicitPayerId) {
    if (studentId) {
      const rel = await db.studentPayerRelationship.findFirst({
        where: { organizationId, studentId, payerId: explicitPayerId, status: "ACTIVE" },
        select: { id: true },
      });
      if (rel) return { payerId: explicitPayerId, basis: "explicit_dispatch" };
    }
    // fall through, but keep the warning
    const fallback = await defaultOrSelfPay(organizationId, studentId);
    return { ...fallback, warning: "The payer selected at dispatch is no longer available; billing fell back to the student's default." };
  }
  return defaultOrSelfPay(organizationId, studentId);
}

async function defaultOrSelfPay(organizationId: string, studentId: string | null): Promise<BillToResolution> {
  if (!studentId) return { payerId: null, basis: "self_pay" };
  const rel = await db.studentPayerRelationship.findFirst({
    where: { organizationId, studentId, status: "ACTIVE", isDefault: true },
    select: { payerId: true },
  });
  return rel ? { payerId: rel.payerId, basis: "student_default" } : { payerId: null, basis: "self_pay" };
}

/** Enforce the paying-party XOR: exactly one of payerId | studentId (doc 20 V2). */
export function assertPaymentPartyXor(payerId: string | null, studentId: string | null): void {
  if ((payerId == null) === (studentId == null)) {
    throw new Error("A payment customer must have exactly one of payerId or studentId set.");
  }
}

/** Issue a single-use invitation token for a payer (hash stored, raw returned once). */
export async function issuePayerInvite(payerId: string, expiryDays: number): Promise<string> {
  const raw = generateToken();
  await db.responsiblePayer.update({
    where: { id: payerId },
    data: { inviteTokenHash: hashToken(raw), inviteExpiresAt: new Date(Date.now() + expiryDays * 86_400_000) },
  });
  return raw; // shown once to staff to hand to the payer — never persisted raw
}
