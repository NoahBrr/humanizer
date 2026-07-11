import Link from "next/link";
import { notFound } from "next/navigation";
import type { RevenueReviewStatus } from "@prisma/client";
import { Plane, User, GraduationCap, MapPin, Radio, Gauge } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { reviewViewFilter } from "@/lib/revenue-access";
import { isFrozen, type ApprovalSnapshot } from "@/lib/revenue-review";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate, formatDateTime, fullName } from "@/lib/utils";
import { ReviewTimeEntry, type TimeEntryRow } from "./review-time-entry";
import { ReviewApproval } from "./review-approval";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue Review" };

const EDITABLE_STATUSES: RevenueReviewStatus[] = ["DRAFT", "AWAITING_INSTRUCTOR_REVIEW", "CHANGES_REQUESTED"];

const CATEGORY_LABELS: Record<string, string> = {
  FLIGHT_INSTRUCTION: "Flight instruction",
  GROUND_INSTRUCTION: "Ground instruction",
  PREFLIGHT_BRIEFING: "Pre-flight briefing",
  POSTFLIGHT_DEBRIEFING: "Post-flight debriefing",
  SIMULATOR_INSTRUCTION: "Simulator instruction",
  ORAL_PREPARATION: "Oral preparation",
  CHECKRIDE_PREPARATION: "Checkride preparation",
  STAGE_CHECK: "Stage check",
  GROUND_SCHOOL: "Ground school",
  ADMINISTRATIVE: "Administrative",
  CUSTOM: "Custom",
};

const APPROVAL_KIND_LABELS: Record<string, string> = {
  OPERATIONS: "Operations",
  SECOND: "Second",
  FINANCE: "Finance",
};

export default async function RevenueReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  // UI hiding is not authorization — the page enforces the permission itself.
  if (!session || !session.permissions.has("revenue.review_view")) notFound();

  const { id } = await params;
  // An instructor 404s on another instructor's review (doc 03 §6.1).
  const review = await db.revenueReview.findFirst({
    where: { id, organizationId: session.organizationId, ...(await reviewViewFilter(session)) },
    include: {
      invoice: { include: { lines: true } },
      timeEntries: { orderBy: { createdAt: "asc" } },
      aircraft: { select: { tailNumber: true } },
      student: { include: { user: { select: { firstName: true, lastName: true } } } },
      instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      location: { select: { name: true } },
      dispatch: { select: { id: true } },
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!review) notFound();

  const hobbsOut = review.hobbsOut != null ? Number(review.hobbsOut) : null;
  const hobbsIn = review.hobbsIn != null ? Number(review.hobbsIn) : null;
  const tachOut = review.tachOut != null ? Number(review.tachOut) : null;
  const tachIn = review.tachIn != null ? Number(review.tachIn) : null;
  const hobbsElapsed = hobbsOut != null && hobbsIn != null ? hobbsIn - hobbsOut : null;
  const tachElapsed = tachOut != null && tachIn != null ? tachIn - tachOut : null;

  const lines = review.invoice.lines.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    lineTotal: Number(l.quantity) * Number(l.unitPrice),
  }));
  const total = lines.reduce((t, l) => t + l.lineTotal, 0);

  const entries: TimeEntryRow[] = review.timeEntries.map((e) => ({
    id: e.id,
    category: e.category,
    categoryLabel: CATEGORY_LABELS[e.category] ?? e.category,
    customLabel: e.customLabel,
    hours: Number(e.hours),
    billToCustomer: e.billToCustomer,
    compensable: e.compensable,
    notes: e.notes,
  }));

  const editable = EDITABLE_STATUSES.includes(review.status);
  const canEnterTime = session.permissions.has("revenue.time_entry") && !!review.instructorId;
  const showTimeForm = editable && canEnterTime;

  // Approval capability flags. These only control visibility — every route
  // re-checks the permission, own-scope, and the legal transition server-side
  // (UI hiding is never the boundary). Read-only impersonation hides all of it.
  const readOnly = !!session.impersonation?.readOnly;
  const canSubmit = !readOnly && session.permissions.has("revenue.review_submit");
  const canApprove = !readOnly && session.permissions.has("revenue.approve");
  const canVoid = !readOnly && session.permissions.has("revenue.void");

  // Approval timeline, oldest first (chronological). Derived from lifecycle
  // actor fields + the recorded approval signatures — read-only, no recompute.
  const timeline: { at: Date; label: string; detail?: string }[] = [];
  if (review.submittedAt) timeline.push({ at: review.submittedAt, label: "Submitted for operations review" });
  for (const a of review.approvals) {
    timeline.push({
      at: a.createdAt,
      label: `${APPROVAL_KIND_LABELS[a.kind] ?? a.kind} approval recorded`,
      detail: `by ${a.approverLabel}`,
    });
  }
  if (review.changesRequestedAt) timeline.push({ at: review.changesRequestedAt, label: "Changes requested", detail: review.changesRequestedReason ?? undefined });
  if (review.approvedAt) timeline.push({ at: review.approvedAt, label: "Approved — snapshot frozen" });
  if (review.voidedAt) timeline.push({ at: review.voidedAt, label: "Voided", detail: review.voidReason ?? undefined });
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  const snapshot = isFrozen(review.status) && review.approvalSnapshot
    ? (review.approvalSnapshot as unknown as ApprovalSnapshot)
    : null;

  const facts: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [
    { icon: <Plane className="h-3.5 w-3.5" />, label: "Aircraft", value: review.aircraft?.tailNumber ?? "—" },
    { icon: <GraduationCap className="h-3.5 w-3.5" />, label: "Student", value: fullName(review.student?.user) || "—" },
    { icon: <User className="h-3.5 w-3.5" />, label: "Instructor", value: fullName(review.instructor?.user) || "Solo" },
    { icon: <MapPin className="h-3.5 w-3.5" />, label: "Location", value: review.location?.name ?? "—" },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={`Revenue Review ${review.number}`} description={`Flight date ${formatDate(review.flightDate)}`}>
        <Link href="/billing/reviews" className="text-xs font-medium text-primary hover:underline">All reviews</Link>
      </PageHeader>

      {/* Status banner */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={review.status} />
            <p className="text-xs text-muted-foreground">
              {editable
                ? "This review is still open. Confirm instructor time and charges — nothing is charged until Operations approves."
                : "This review is locked. Its charges and time entries are frozen."}
            </p>
          </div>
          <p className="text-sm font-semibold tabular-nums">Draft total {formatCurrency(total)}</p>
        </CardContent>
      </Card>

      {/* Approval actions */}
      <Card className="mb-4">
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <CardContent>
          <ReviewApproval
            reviewId={review.id}
            status={review.status}
            canSubmit={canSubmit}
            canApprove={canApprove}
            canVoid={canVoid}
            expectedTotal={total.toFixed(2)}
            updatedAt={review.updatedAt.toISOString()}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Flight information */}
          <Card>
            <CardHeader><CardTitle>Flight information</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{f.icon}{f.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium">{f.value}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[11px] text-muted-foreground">Review #</dt>
                  <dd className="mt-0.5 text-sm font-medium">{review.number}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Flight date</dt>
                  <dd className="mt-0.5 text-sm font-medium">{formatDate(review.flightDate)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Radio className="h-3.5 w-3.5" />Dispatch</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {review.dispatch ? <Link href="/dispatch" className="text-primary hover:underline">View board</Link> : "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Time summary */}
          <Card>
            <CardHeader><CardTitle>Time summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Meter icon={<Gauge className="h-3.5 w-3.5" />} title="Hobbs" out={hobbsOut} in={hobbsIn} elapsed={hobbsElapsed} />
                <Meter icon={<Gauge className="h-3.5 w-3.5" />} title="Tach" out={tachOut} in={tachIn} elapsed={tachElapsed} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold">Instructor time entries</p>
                {entries.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    No instructor time recorded.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                        <span className="font-medium">{e.category === "CUSTOM" && e.customLabel ? e.customLabel : e.categoryLabel}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {e.hours.toFixed(1)} hrs · {e.billToCustomer ? "billed" : "not billed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Charges */}
          <Card>
            <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
            <CardContent className="p-2">
              {lines.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">No charge lines on this review.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Description</TH><TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit price</TH><TH className="text-right">Line total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lines.map((l) => (
                      <TR key={l.id}>
                        <TD className="text-xs">{l.description}</TD>
                        <TD className="text-right text-xs tabular-nums">{l.quantity.toFixed(2)}</TD>
                        <TD className="text-right text-xs tabular-nums">{formatCurrency(l.unitPrice)}</TD>
                        <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(l.lineTotal)}</TD>
                      </TR>
                    ))}
                    <TR className="hover:bg-transparent">
                      <TD className="text-xs font-semibold" colSpan={3}>Total (not charged)</TD>
                      <TD className="text-right text-xs font-semibold tabular-nums">{formatCurrency(total)}</TD>
                    </TR>
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Instructor time entry sidebar */}
        <div className="space-y-4 lg:col-span-1">
          {snapshot && (
            <Card>
              <CardHeader><CardTitle>Approved totals (frozen)</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  A point-in-time snapshot frozen at approval. These figures never recompute.
                </p>
                <dl className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="font-semibold tabular-nums">{formatCurrency(review.totalAtApproval ?? snapshot.total)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Tax total</dt>
                    <dd className="tabular-nums">{formatCurrency(snapshot.tax.total)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Payment policy</dt>
                    <dd className="font-medium">{(review.paymentPolicyAtApproval ?? snapshot.paymentPolicy).replaceAll("_", " ").toLowerCase()}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approval activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {timeline.map((ev, i) => (
                    <li key={i} className="relative pl-4">
                      <span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
                      <p className="text-xs font-medium">{ev.label}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(ev.at)}</p>
                      {ev.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{ev.detail}</p>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">Oldest first.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Instructor time</CardTitle></CardHeader>
            <CardContent>
              {showTimeForm ? (
                <ReviewTimeEntry reviewId={review.id} entries={entries} />
              ) : entries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {canEnterTime
                    ? "This review is locked, so instructor time can no longer be changed."
                    : "No instructor time recorded."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {entries.map((e) => (
                    <li key={e.id} className="rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold">
                        {e.category === "CUSTOM" && e.customLabel ? e.customLabel : e.categoryLabel}
                        <span className="ml-2 font-normal tabular-nums text-muted-foreground">{e.hours.toFixed(1)} hrs</span>
                      </p>
                      {e.notes && <p className="mt-1 text-[11px] text-muted-foreground">{e.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meter({ icon, title, out, in: inVal, elapsed }: { icon: React.ReactNode; title: string; out: number | null; in: number | null; elapsed: number | null }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold">{icon}{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><p className="text-[10px] text-muted-foreground">Out</p><p className="text-xs font-semibold tabular-nums">{out?.toFixed(1) ?? "—"}</p></div>
        <div><p className="text-[10px] text-muted-foreground">In</p><p className="text-xs font-semibold tabular-nums">{inVal?.toFixed(1) ?? "—"}</p></div>
        <div><p className="text-[10px] text-muted-foreground">Elapsed</p><p className="text-xs font-semibold tabular-nums">{elapsed != null ? elapsed.toFixed(1) : "—"}</p></div>
      </div>
    </div>
  );
}
