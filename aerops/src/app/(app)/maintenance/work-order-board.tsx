"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type WorkOrderRow = {
  id: string; number: string | null; tail: string; title: string; category: string | null;
  priority: string; status: string; assignedTo: string | null; approvedBy: string | null;
};

const NEXT: Record<string, string[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["ASSIGNED"],
  SCHEDULED: ["ASSIGNED", "IN_PROGRESS"],
  ASSIGNED: ["IN_PROGRESS", "WAITING_PARTS"],
  WAITING_PARTS: ["IN_PROGRESS"],
  IN_PROGRESS: ["AWAITING_INSPECTION", "WAITING_PARTS"],
  AWAITING_INSPECTION: ["APPROVED"],
  APPROVED: ["RETURN_TO_SERVICE"],
  RETURN_TO_SERVICE: ["CLOSED"],
};

export function WorkOrderBoard({ orders, canManage }: { orders: WorkOrderRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(id: string, status: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/maintenance/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Transition failed.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Wrench className="h-4 w-4" /> Work Orders</CardTitle>
        <CardDescription>
          Full lifecycle: open → assigned → parts → in progress → inspection → approved (signed) → return to service → closed.
          Return-to-service restores grounded aircraft automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        {orders.length === 0 && <p className="text-xs text-muted-foreground">No active work orders — the shop floor is clear.</p>}
        {orders.map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {o.number && <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{o.number}</code>}
              <StatusBadge status={o.priority} />
              <span className="text-xs font-semibold">{o.tail} — {o.title}</span>
              {o.category && <Badge tone="gray">{o.category}</Badge>}
              <span className="ml-auto"><StatusBadge status={o.status} /></span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {o.assignedTo ? `Assigned to ${o.assignedTo}` : "Unassigned"}
              {o.approvedBy ? ` · RTS approved by ${o.approvedBy} ✍` : ""}
            </p>
            {canManage && (NEXT[o.status] ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(NEXT[o.status] ?? []).map((next) => (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === "RETURN_TO_SERVICE" ? "success" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    disabled={busyId === o.id}
                    onClick={() => transition(o.id, next)}
                  >
                    {busyId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : next === "RETURN_TO_SERVICE" ? <CheckCircle2 className="h-3 w-3" /> : null}
                    {next.replaceAll("_", " ").toLowerCase()}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
