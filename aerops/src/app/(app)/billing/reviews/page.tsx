import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { reviewViewFilter } from "@/lib/revenue-access";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revenue Reviews" };

export default async function RevenueReviewsPage() {
  const session = await getSession();
  // UI hiding is not authorization — the page enforces the permission itself.
  if (!session || !session.permissions.has("revenue.review_view")) notFound();

  // Instructors see only their own reviews; ops/finance/dispatch see all (doc 03 §6.1).
  const reviews = await db.revenueReview.findMany({
    where: { organizationId: session.organizationId, ...(await reviewViewFilter(session)) },
    include: {
      invoice: { select: { lines: { select: { quantity: true, unitPrice: true } } } },
      aircraft: { select: { tailNumber: true } },
      student: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const rows = reviews.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    flightDate: r.flightDate,
    tailNumber: r.aircraft?.tailNumber ?? "—",
    student: fullName(r.student?.user) || "—",
    draftTotal: r.invoice.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0),
  }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Revenue Reviews"
        description="Each closed flight creates a draft Revenue Review. Confirm instructor time and charges before Operations approves — nothing is charged until then."
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-2">
            <EmptyState
              icon={<ClipboardList className="h-5 w-5" />}
              title="No Revenue Reviews yet"
              description="Close out a flight to create one. Aircraft return generates a draft review automatically — no charge until it's approved."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-2">
            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Review</TH><TH>Date</TH><TH>Aircraft</TH><TH>Student</TH>
                    <TH className="text-right">Draft total</TH><TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/billing/reviews/${r.id}`} className="text-xs font-semibold text-primary hover:underline">{r.number}</Link>
                      </TD>
                      <TD className="text-xs">{formatDate(r.flightDate)}</TD>
                      <TD className="text-xs font-medium">{r.tailNumber}</TD>
                      <TD className="text-xs">{r.student}</TD>
                      <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(r.draftTotal)}</TD>
                      <TD><StatusBadge status={r.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <div className="space-y-2 p-1 md:hidden">
              {rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/billing/reviews/${r.id}`}
                  className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-primary">{r.number}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(r.flightDate)} · {r.tailNumber} · {r.student}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-2 text-xs font-medium tabular-nums">Draft total {formatCurrency(r.draftTotal)}</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
