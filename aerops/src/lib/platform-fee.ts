import { Prisma, type PlatformFeeBase, type PlatformFeePolicy } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Platform-fee computation + accrual (doc 12/27). AeroOps' fee on collected
 * tenant revenue: accrued at approval with a full basis snapshot, earned at
 * collection, reversed on refund. Resolution is org override → plan → global
 * default (both FKs null); ABSENT policy means 0 bps — no fee revenue until an
 * AeroOps platform role sets commercial terms (open decision D2). Controlled
 * ONLY through platform surfaces; org staff can never edit it.
 */

const Z = new Prisma.Decimal(0);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type ResolvedFeePolicy = Pick<PlatformFeePolicy, "id" | "version" | "feePercentBps" | "feeFlatAmount" | "feeBase" | "minFee" | "maxFee" | "currency" | "refundReversesFee">;

/** The zero policy used when an org has no configured platform fee (default). */
export const ZERO_FEE_POLICY: ResolvedFeePolicy = {
  id: null as unknown as string, version: null as unknown as number,
  feePercentBps: 0, feeFlatAmount: Z, feeBase: "COLLECTED_PRETAX",
  minFee: null, maxFee: null, currency: "USD", refundReversesFee: true,
};

/** Resolve the effective platform-fee policy at `at`: org override → plan → global. */
export async function resolvePlatformFeePolicy(organizationId: string, planId: string | null, at: Date): Promise<ResolvedFeePolicy> {
  const effective = { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] };
  const pick = async (where: Prisma.PlatformFeePolicyWhereInput) =>
    db.platformFeePolicy.findFirst({ where: { ...where, ...effective }, orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }] });

  const org = await pick({ organizationId });
  if (org) return org;
  if (planId) {
    const plan = await pick({ planId, organizationId: null });
    if (plan) return plan;
  }
  const global = await pick({ organizationId: null, planId: null });
  return global ?? ZERO_FEE_POLICY;
}

/** The fee base amount (doc 27): pre-tax subtotal or total. */
export function feeBaseAmount(base: PlatformFeeBase, subtotal: Prisma.Decimal, total: Prisma.Decimal): Prisma.Decimal {
  return base === "COLLECTED_TOTAL" ? total : subtotal;
}

/** Compute the fee for a base amount: bps × base + flat, clamped [min,max], half-up cents. */
export function computePlatformFee(policy: ResolvedFeePolicy, baseAmount: Prisma.Decimal): Prisma.Decimal {
  let fee = baseAmount.times(policy.feePercentBps).dividedBy(10000).plus(policy.feeFlatAmount);
  if (policy.minFee && fee.lessThan(policy.minFee)) fee = D(policy.minFee);
  if (policy.maxFee && fee.greaterThan(policy.maxFee)) fee = D(policy.maxFee);
  if (fee.lessThan(0)) fee = Z;
  return fee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Accrue the platform fee for a review at approval (status ACCRUED) with a full
 * basis snapshot. Runs inside the approval transaction. Returns the fee amount
 * so the caller can post the PROCEEDS split + ledger. One PlatformFee per review
 * (revenueReviewId @unique).
 */
export async function accruePlatformFee(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; revenueReviewId: string; invoiceId: string; policy: ResolvedFeePolicy; subtotal: Prisma.Decimal; total: Prisma.Decimal; currency: string },
): Promise<Prisma.Decimal> {
  const base = feeBaseAmount(input.policy.feeBase, input.subtotal, input.total);
  const amount = computePlatformFee(input.policy, base);
  await tx.platformFee.create({
    data: {
      organizationId: input.organizationId,
      revenueReviewId: input.revenueReviewId,
      invoiceId: input.invoiceId,
      status: "ACCRUED",
      feePercentBps: input.policy.feePercentBps,
      feeFlatAmount: input.policy.feeFlatAmount,
      feeBase: input.policy.feeBase,
      appliedBaseAmount: base,
      amount,
      currency: input.currency,
      policyId: input.policy.id ?? null,
      policyVersion: input.policy.version ?? null,
    },
  });
  return amount;
}
