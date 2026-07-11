"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RevenueReviewStatus } from "@prisma/client";
import { Loader2, Send, CheckCircle2, MessageSquareWarning, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { SUBMITTABLE, APPROVABLE, VOIDABLE } from "@/lib/revenue-review";
import { apiErrorMessage } from "@/lib/utils";

/**
 * Revenue Review approval controls (doc 03 §2). Visibility is gated on
 * (status ∈ the right set) AND (a server-computed capability flag) — but the
 * flags only hide controls; the API routes re-check the permission and the
 * legal transition, so this component is never the authorization boundary.
 *
 * No payment executes in this phase: approval freezes a snapshot and finalizes
 * the wrapped invoice — it never charges. The approve control reads exactly
 * "Approve Revenue Review", never anything implying a charge.
 */
export function ReviewApproval({
  reviewId,
  status,
  canSubmit,
  canApprove,
  canVoid,
  expectedTotal,
  updatedAt,
}: {
  reviewId: string;
  status: RevenueReviewStatus;
  canSubmit: boolean;
  canVoid: boolean;
  canApprove: boolean;
  /** The total + updatedAt the approver is looking at — sent so the server can
   *  refuse to freeze numbers that moved since (doc 03 §2.6 stale-state guard). */
  expectedTotal: string;
  updatedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "submit" | "approve" | "request-changes" | "void">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "request-changes" | "void">(null);
  const [reason, setReason] = useState("");

  const showSubmit = SUBMITTABLE.includes(status) && canSubmit;
  const showApprove = APPROVABLE.includes(status) && canApprove;
  const showVoid = VOIDABLE.includes(status) && canVoid;

  if (!showSubmit && !showApprove && !showVoid) {
    return (
      <p className="text-xs text-muted-foreground">
        No actions are available to you for this review at its current status.
      </p>
    );
  }

  async function run(
    action: "submit" | "approve" | "request-changes" | "void",
    body?: Record<string, unknown>,
  ) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/revenue/reviews/${reviewId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setError("This review changed — refresh and try again.");
        } else {
          setError(apiErrorMessage(json?.error, "Something went wrong. Please try again."));
        }
        return;
      }
      if (action === "approve" && json?.approved === false) {
        setNotice("Your approval was recorded — a second approval is required.");
      }
      setPanel(null);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;
  const reasonValid = reason.trim().length >= 3;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {showSubmit && (
          <Button size="sm" disabled={anyBusy} onClick={() => run("submit")}>
            {busy === "submit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Submit for approval
          </Button>
        )}
        {showApprove && (
          <>
            <Button
              size="sm"
              variant="success"
              disabled={anyBusy || panel !== null}
              onClick={() => run("approve", { expectedTotal, updatedAt })}
            >
              {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Approve Revenue Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={anyBusy}
              onClick={() => {
                setError(null);
                setNotice(null);
                setReason("");
                setPanel(panel === "request-changes" ? null : "request-changes");
              }}
            >
              <MessageSquareWarning className="h-3.5 w-3.5" />
              Request changes
            </Button>
          </>
        )}
        {showVoid && (
          <Button
            size="sm"
            variant="destructive"
            disabled={anyBusy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setReason("");
              setPanel(panel === "void" ? null : "void");
            }}
          >
            <Ban className="h-3.5 w-3.5" />
            Void review
          </Button>
        )}
      </div>

      {panel === "request-changes" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <Label>Reason for requested changes</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain what the instructor needs to correct before resubmitting."
            className="min-h-16 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!reasonValid || anyBusy} onClick={() => run("request-changes", { reason: reason.trim() })}>
              {busy === "request-changes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareWarning className="h-3.5 w-3.5" />}
              Send back for changes
            </Button>
            <Button size="sm" variant="ghost" disabled={anyBusy} onClick={() => { setPanel(null); setReason(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "void" && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-semibold text-destructive">Voiding is permanent — this review can no longer be approved or charged.</p>
          <Label>Reason for voiding</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record why this review is being voided."
            className="min-h-16 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" disabled={!reasonValid || anyBusy} onClick={() => run("void", { reason: reason.trim() })}>
              {busy === "void" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
              Confirm void
            </Button>
            <Button size="sm" variant="ghost" disabled={anyBusy} onClick={() => { setPanel(null); setReason(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notice && <p className="text-xs font-medium text-primary">{notice}</p>}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
