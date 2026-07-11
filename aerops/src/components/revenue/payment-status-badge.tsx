import { Badge } from "@/components/ui/badge";
import { statusToneOf } from "@/lib/status-colors";

/**
 * Read-only badge for the payment leg of a Revenue Review's lifecycle
 * (doc 30 §13). Tone is drawn from the single-source status map
 * (`lib/status-colors.ts`); only the human labels live here. Payment-phase
 * subset of `RevenueReviewStatus` — the pre-payment review states
 * (DRAFT / AWAITING_* / APPROVED …) are intentionally out of scope.
 */
export type PaymentReviewStatus =
  | "PAYMENT_SCHEDULED"
  | "PAYMENT_PROCESSING"
  | "ACH_PENDING"
  | "CARD_PAID"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "DISPUTED";

const PAYMENT_LABELS: Record<PaymentReviewStatus, string> = {
  PAYMENT_SCHEDULED: "Payment scheduled",
  PAYMENT_PROCESSING: "Processing",
  ACH_PENDING: "ACH pending",
  CARD_PAID: "Card paid",
  PAID: "Paid",
  PAYMENT_FAILED: "Payment failed",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  DISPUTED: "Disputed",
};

export function PaymentStatusBadge({ status, className }: { status: PaymentReviewStatus; className?: string }) {
  return (
    <Badge tone={statusToneOf(status)} className={className}>
      {PAYMENT_LABELS[status]}
    </Badge>
  );
}
