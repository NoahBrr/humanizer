import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { emitDomainEvent } from "@/lib/events";
import { APPROVABLE, requiredApprovalKinds, type ApprovalSnapshot } from "@/lib/revenue-review";
import { computeTax, type TaxableLine, type TaxRuleInput } from "@/lib/tax";
import { postJournal, debit, credit, nonZero, type JournalLine } from "@/lib/ledger";
import { categorizeLines, buildApprovalAllocationRows, postAllocationSet } from "@/lib/revenue-allocation";
import { resolvePlatformFeePolicy, feeBaseAmount, computePlatformFee, accruePlatformFee } from "@/lib/platform-fee";
import { birthEarnings } from "@/lib/instructor-compensation";
import type { AllocationCategory, LedgerAccount } from "@prisma/client";

/**
 * Approve a Revenue Review (doc 03 §2). Records the actor's approval signature;
 * when every required kind (OPERATIONS, optional SECOND/FINANCE) is present, it
 * freezes the immutable financial snapshot, finalizes the wrapped invoice, and
 * moves the review to APPROVED. This is the ONLY place the snapshot is written.
 *
 * NO PAYMENT PROVIDER IS INVOLVED. Approval never calls Stripe or charges a
 * method — the control reads "Approve Revenue Review", not "Approve and Charge".
 * The payment request/outbox + charging land in Phases 4–5.
 *
 * Separation of duties: the SECOND approver must differ from the OPERATIONS
 * approver and from the submitter. A completed approval kind is unique per
 * review (DB constraint), so a double-submit or concurrent approve is rejected.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Gate on authentication + module, then check the approval capability manually
  // so a finance-only approver (revenue.approve_finance, not revenue.approve —
  // the ACCOUNTANT bundle) can record the FINANCE signature. Per-kind permission
  // is enforced below once the required kind is known.
  const { session, error } = await authorize(null, { mutating: true });
  if (error) return error;
  if (!session.modules.has("billing")) {
    return NextResponse.json({ error: "This module isn't enabled for your organization." }, { status: 403 });
  }
  const canOps = session.permissions.has("revenue.approve");
  const canFinance = session.permissions.has("revenue.approve_finance");
  if (!canOps && !canFinance) {
    return NextResponse.json({ error: "You don't have permission to approve Revenue Reviews." }, { status: 403 });
  }
  const { id } = await params;

  // Optional stale-state guard (doc 03 §2.6): the approver may pass the total and
  // updatedAt they saw; if the review moved since, refuse rather than freeze
  // numbers they never reviewed.
  const staleGuard = await req.json().catch(() => ({})) as { expectedTotal?: string; updatedAt?: string };

  const review = await db.revenueReview.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      invoice: { include: { lines: true } },
      approvals: true,
      timeEntries: true,
      organization: { select: { planId: true, revenueWorkflowPolicy: true, orgPaymentPolicy: true, revenueSettings: true } },
    },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!APPROVABLE.includes(review.status)) {
    return NextResponse.json({ error: "This review is not awaiting approval." }, { status: 409 });
  }
  if (staleGuard.updatedAt && review.updatedAt.toISOString() !== staleGuard.updatedAt) {
    return NextResponse.json({ error: "This review changed since you opened it — refresh and review the current numbers before approving." }, { status: 409 });
  }

  const policy = review.organization.revenueWorkflowPolicy ?? { operationsApprovalRequired: true, secondApprovalAmountThreshold: null, financeApprovalRequired: false, separationOfDutiesRequired: true };
  const settings = review.organization.revenueSettings;
  const paymentPolicy = review.organization.orgPaymentPolicy?.defaultTimingPolicy ?? "IMMEDIATE_ON_APPROVAL";

  // ---- Compute the total (subtotal + tax) from the current invoice lines ----
  const subtotal = review.invoice.lines.reduce((t, l) => t.plus(new Prisma.Decimal(l.quantity).times(l.unitPrice)), new Prisma.Decimal(0));
  let taxComputation = computeTax([], []);
  if (settings?.taxEnabled) {
    const rules = await db.taxRule.findMany({ where: { organizationId: session.organizationId, isActive: true } });
    const taxable: TaxableLine[] = review.invoice.lines.map((l) => ({
      lineId: l.id,
      amount: new Prisma.Decimal(l.quantity).times(l.unitPrice),
      chargeClass: chargeClassFor(l.kind),
      taxable: isTaxable(l.kind),
    }));
    const ruleInputs: TaxRuleInput[] = rules.map((r) => ({ id: r.id, ruleKey: r.ruleKey, version: r.version, name: r.name, jurisdictionLabel: r.jurisdictionLabel, ratePercent: r.ratePercent, appliesToKinds: r.appliesToKinds }));
    taxComputation = computeTax(taxable, ruleInputs, { mode: settings.taxRoundingMode, level: settings.taxRoundingLevel });
  }
  const total = subtotal.plus(taxComputation.totalTax);

  if (staleGuard.expectedTotal && staleGuard.expectedTotal !== total.toFixed(2)) {
    return NextResponse.json({ error: "The total changed since you opened this review — refresh and review the current numbers before approving." }, { status: 409 });
  }

  // Platform fee — resolved + computed BEFORE the tx (deterministic) so the
  // snapshot and the accrued row agree exactly. Default policy is 0 bps.
  const feePolicy = await resolvePlatformFeePolicy(session.organizationId, review.organization.planId, new Date());
  const feeAmount = computePlatformFee(feePolicy, feeBaseAmount(feePolicy.feeBase, subtotal, total));

  // ---- Determine required vs provided approval kinds ----
  const required = requiredApprovalKinds(policy, total.toNumber(), review.secondApprovalRequired);
  // Only NON-superseded signatures count toward "provided": a Changes Requested
  // invalidates prior approvals, so the corrected numbers require a fresh
  // approval and the old signature can never carry forward (doc 03 §2.7).
  const active = review.approvals.filter((a) => a.supersededAt === null);
  const provided = new Set(active.map((a) => a.kind));
  const nextKind = required.find((k) => !provided.has(k));
  if (!nextKind) {
    return NextResponse.json({ error: "This review is already fully approved." }, { status: 409 });
  }

  // ---- Per-kind permission: OPERATIONS/SECOND need revenue.approve; FINANCE needs revenue.approve_finance ----
  if (nextKind === "FINANCE" ? !canFinance : !canOps) {
    return NextResponse.json({ error: `You don't have permission for the ${nextKind.toLowerCase()} approval on this review.` }, { status: 403 });
  }

  // ---- Separation of duties (doc 03 §2.8) ----
  const sod = policy.separationOfDutiesRequired !== false;
  const riskFlagged = review.riskFlags.length > 0;
  const priorByActor = active.some((a) => a.approverUserId === session.userId);
  if (sod) {
    // No one signs the same review twice (blocks OPERATIONS+SECOND by one person).
    if (priorByActor) {
      return NextResponse.json({ error: "You have already approved this review — another approver is required." }, { status: 403 });
    }
    // The submitter may not approve their own RISK-FLAGGED review (damage fee,
    // manual item, discount, time override), nor provide the second approval.
    // (Single-approver relaxation — allow with a SELF_APPROVED_SOLE_USER audit
    // flag when exactly one user holds revenue.approve — is deferred; a
    // one-approver org sets separationOfDutiesRequired=false to self-approve.)
    if (review.submittedById === session.userId && (riskFlagged || nextKind === "SECOND")) {
      return NextResponse.json({ error: "You submitted this review — a different person must approve it." }, { status: 403 });
    }
  }

  const actorLabel = `${session.firstName} ${session.lastName}`;
  const complete = required.every((k) => provided.has(k) || k === nextKind);

  try {
    const outcome = await db.$transaction(async (tx) => {
      // Lock the review row and re-validate status INSIDE the tx before writing
      // the signature. This serializes against a concurrent Changes Requested /
      // void (which also lock+mutate this row), closing the partial-approval
      // TOCTOU: a request-changes can no longer supersede between the status
      // read and the signature insert — either this tx locks first (its
      // signature is then correctly superseded by the later request-changes) or
      // request-changes locks first (this claim matches zero rows → 409).
      const lock = await tx.revenueReview.updateMany({
        where: { id: review.id, status: "AWAITING_OPERATIONS_REVIEW" },
        data: { updatedAt: new Date() },
      });
      if (lock.count === 0) throw new AlreadyResolved();

      // Record the approval signature (one ACTIVE approval per review+kind — a
      // concurrent or duplicate approval of the same kind hits the partial
      // unique index and aborts).
      await tx.revenueReviewApproval.create({
        data: { organizationId: session.organizationId, revenueReviewId: review.id, kind: nextKind, approverUserId: session.userId, approverLabel: actorLabel },
      });

      if (!complete) {
        return { status: "AWAITING_OPERATIONS_REVIEW" as const, approved: false };
      }

      // Freeze the immutable snapshot and finalize — guarded status claim so a
      // concurrent approval of the LAST kind can't double-finalize.
      const snapshot: ApprovalSnapshot = {
        version: 1,
        frozenAt: new Date().toISOString(),
        currency: review.currency,
        lines: review.invoice.lines.map((l) => ({
          kind: l.kind, description: l.description,
          quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(),
          lineTotal: new Prisma.Decimal(l.quantity).times(l.unitPrice).toFixed(2),
        })),
        subtotal: subtotal.toFixed(2),
        tax: { total: taxComputation.totalTax.toFixed(2), perRule: taxComputation.perRule.map((r) => ({ ruleKey: r.ruleKey, jurisdiction: r.jurisdictionLabel, tax: r.tax.toFixed(2) })) },
        total: total.toFixed(2),
        paymentPolicy,
        platformFee: feeAmount.toFixed(2),
        approvals: [...active.map((a) => ({ kind: a.kind, approverLabel: a.approverLabel, at: a.createdAt.toISOString() })), { kind: nextKind, approverLabel: actorLabel, at: new Date().toISOString() }],
      };

      const claim = await tx.revenueReview.updateMany({
        where: { id: review.id, status: "AWAITING_OPERATIONS_REVIEW" },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: session.userId,
          totalAtApproval: total,
          paymentPolicyAtApproval: paymentPolicy,
          approvalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      if (claim.count === 0) throw new AlreadyResolved();

      // Finalize the wrapped invoice: DRAFT → OPEN (now a real receivable).
      await tx.invoice.update({ where: { id: review.invoiceId }, data: { status: "OPEN", dueAt: new Date(Date.now() + 14 * 86_400_000) } });

      // ---- Financial core (doc 12/28). Every posting balances or the whole
      // ---- approval aborts (assertions throw inside the tx). ----
      const approvedAt = new Date();

      // 1. Instructor compensation earnings (structurally separate from billing).
      const compTotal = await birthEarnings(tx, {
        organizationId: session.organizationId,
        instructorId: review.instructorId ?? "",
        revenueReviewId: review.id,
        locationId: review.locationId,
        currency: review.currency,
        approvedAt,
        timeEntries: review.timeEntries.map((t) => ({ id: t.id, category: t.category, customLabel: t.customLabel, hours: t.hours, compensable: t.compensable })),
        compensationApprovalMode: settings?.compensationApprovalMode ?? "AUTO_ON_REVIEW_APPROVAL",
      });

      // 2. Platform fee — ACCRUED with a full basis snapshot (0.00 default).
      await accruePlatformFee(tx, {
        organizationId: session.organizationId, revenueReviewId: review.id, invoiceId: review.invoiceId,
        policy: feePolicy, subtotal, total, currency: review.currency,
      });

      // 3. Balanced approval journal J1 (revenue recognized; A/R + comp accrual).
      const catAmounts = categorizeLines(review.invoice.lines);
      const revenueLines: JournalLine[] = [];
      for (const [cat, amt] of catAmounts) {
        if (amt.greaterThan(0)) revenueLines.push(credit(ledgerAccountForCategory(cat), amt));
        else if (amt.lessThan(0)) revenueLines.push(debit("CONTRA_REVENUE_DISCOUNTS", amt.abs()));
      }
      const j1: JournalLine[] = nonZero([
        debit("ACCOUNTS_RECEIVABLE", total),
        ...(compTotal.greaterThan(0) ? [debit("INSTRUCTOR_COMP_EXPENSE", compTotal)] : []),
        ...revenueLines,
        ...(taxComputation.totalTax.greaterThan(0) ? [credit("TAX_PAYABLE", taxComputation.totalTax)] : []),
        ...(compTotal.greaterThan(0) ? [credit("INSTRUCTOR_COMP_PAYABLE", compTotal)] : []),
      ]);
      await postJournal(tx, {
        organizationId: session.organizationId, journalId: `jrnl_${review.id}_approved`,
        event: "revenue_review.approved", sourceType: "RevenueReview", sourceId: review.id,
        currency: review.currency, effectiveAt: approvedAt, lines: j1,
      });

      // 4. Balanced APPROVAL allocation set S1 (REVENUE + PROCEEDS dimensions).
      const rows = buildApprovalAllocationRows({ categoryAmounts: catAmounts, taxAmount: taxComputation.totalTax, platformFee: feeAmount, total });
      await postAllocationSet(tx, {
        organizationId: session.organizationId, revenueReviewId: review.id, invoiceId: review.invoiceId,
        setId: `set_${review.id}_approval`, event: "APPROVAL", currency: review.currency,
        effectiveAt: approvedAt, amount: total, rows,
      });

      return { status: "APPROVED" as const, approved: true };
    });

    await recordAudit({
      organizationId: session.organizationId, actorUserId: session.userId, actorLabel,
      action: outcome.approved ? "revenue.review.approve" : "revenue.review.approve_partial",
      entityType: "RevenueReview", entityId: review.id,
      newValue: { kind: nextKind, status: outcome.status, total: total.toFixed(2) },
    });
    if (outcome.approved) {
      logger.info("revenue review approved", { reviewId: review.id, total: total.toFixed(2) });
      await emitDomainEvent(session.organizationId, "revenue_review.approved", { reviewId: review.id, invoiceId: review.invoiceId, total: total.toFixed(2) });
    }
    return NextResponse.json({ status: outcome.status, approved: outcome.approved, recordedKind: nextKind });
  } catch (e) {
    if (e instanceof AlreadyResolved || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      return NextResponse.json({ error: "This review was just approved by someone else." }, { status: 409 });
    }
    logger.error("revenue review approve failed", { reviewId: review.id, error: String(e) });
    return NextResponse.json({ error: "The approval could not be saved. Please try again." }, { status: 500 });
  }
}

class AlreadyResolved extends Error {}

/** Revenue allocation category → its ledger revenue account (doc 28 taxonomy). */
function ledgerAccountForCategory(cat: AllocationCategory): LedgerAccount {
  switch (cat) {
    case "AIRCRAFT_REVENUE": return "REVENUE_AIRCRAFT";
    case "INSTRUCTOR_SERVICE_REVENUE": return "REVENUE_INSTRUCTION";
    case "AIRPORT_LANDING_FEES": return "REVENUE_AIRPORT_FEES";
    case "FUEL_REVENUE": return "REVENUE_FUEL";
    default: return "REVENUE_OTHER";
  }
}

// Invoice-line kind → tax charge-class + taxability (doc 07). Conservative
// defaults; per-org Revenue Item taxability refines this in a later phase.
function chargeClassFor(kind: string): string {
  if (kind === "AIRCRAFT_RENTAL") return "aircraft_rental";
  if (kind === "INSTRUCTOR_TIME" || kind === "GROUND_INSTRUCTION" || kind === "SIMULATOR_TIME") return "instruction";
  if (kind === "FUEL_SURCHARGE") return "fuel";
  return "other";
}
function isTaxable(kind: string): boolean {
  // Instruction is commonly non-taxable; rental/fuel/supplies commonly taxable.
  return kind !== "INSTRUCTOR_TIME" && kind !== "GROUND_INSTRUCTION" && kind !== "DISCOUNT";
}
