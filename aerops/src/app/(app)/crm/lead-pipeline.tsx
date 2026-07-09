"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, UserPlus, Check, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

export type LeadRow = {
  id: string; name: string; email: string; interest: string | null; source: string;
  status: string; estValue: number | null; followUpDue: boolean;
};

const STAGE_LABELS: Record<string, string> = {
  NEW: "New", CONTACTED: "Contacted", DISCOVERY_SCHEDULED: "Discovery Scheduled",
  DISCOVERY_COMPLETED: "Discovery Done", APPLICATION: "Application", ENROLLED: "Enrolled", LOST: "Lost",
};

export function LeadPipeline({ stages, leads, readOnly }: { stages: string[]; leads: LeadRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    const res = await fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    const j = await res.json().catch(() => ({}));
    setBusyId(null);
    if (j.inviteUrl) setInviteUrl(`${window.location.origin}${j.inviteUrl}`);
    router.refresh();
  }

  const visibleStages = stages.filter((s) => s !== "LOST");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Pipeline</CardTitle>
        <CardDescription>Advance leads stage by stage; converting creates a student invitation automatically</CardDescription>
      </CardHeader>
      <CardContent>
        {inviteUrl && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-2">
            <span className="text-xs font-medium text-success">Lead converted — send this enrollment link:</span>
            <code className="min-w-0 flex-1 truncate text-[11px]">{inviteUrl}</code>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); }}>
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {visibleStages.map((stage, idx) => {
            const items = leads.filter((l) => l.status === stage);
            const next = visibleStages[idx + 1];
            return (
              <div key={stage} className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold">
                  {STAGE_LABELS[stage]} <span className="text-muted-foreground">{items.length}</span>
                </p>
                <div className="space-y-1.5">
                  {items.length === 0 && <p className="px-1 py-2 text-[11px] text-muted-foreground">—</p>}
                  {items.map((l) => (
                    <div key={l.id} className="rounded-lg border border-border bg-card p-2 shadow-sm">
                      <p className="truncate text-[11px] font-semibold">{l.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{l.interest ?? "—"} · {l.source}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {l.estValue !== null && <Badge tone="gray">{formatCurrency(l.estValue)}</Badge>}
                        {l.followUpDue && <Badge tone="amber">follow up</Badge>}
                      </div>
                      {!readOnly && stage !== "ENROLLED" && (
                        <div className="mt-1.5 flex gap-1">
                          {next && next !== "ENROLLED" && (
                            <Button variant="outline" size="sm" className="h-6 flex-1 px-1 text-[10px]" disabled={busyId === l.id} onClick={() => patch(l.id, { status: next })}>
                              <ArrowRight className="h-3 w-3" /> {STAGE_LABELS[next]}
                            </Button>
                          )}
                          {(stage === "APPLICATION" || stage === "DISCOVERY_COMPLETED") && (
                            <Button variant="success" size="sm" className="h-6 flex-1 px-1 text-[10px]" disabled={busyId === l.id} onClick={() => patch(l.id, { convert: true })}>
                              <UserPlus className="h-3 w-3" /> Convert
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-6 px-1 text-[10px] text-muted-foreground" disabled={busyId === l.id} onClick={() => patch(l.id, { status: "LOST" })}>
                            ✕
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
