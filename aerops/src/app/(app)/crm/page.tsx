import { redirect } from "next/navigation";
import { TrendingUp, Megaphone } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { LeadPipeline, type LeadRow } from "./lead-pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Growth" };

const STAGES = ["NEW", "CONTACTED", "DISCOVERY_SCHEDULED", "DISCOVERY_COMPLETED", "APPLICATION", "ENROLLED", "LOST"] as const;

export default async function CrmPage() {
  const session = await getSession();
  if (!session!.permissions.has("students.manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;

  const leads = await db.lead.findMany({ where: { organizationId }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] });

  const active = leads.filter((l) => !["ENROLLED", "LOST"].includes(l.status));
  const pipelineValue = active.reduce((t, l) => t + Number(l.estValue ?? 0), 0);
  const converted = leads.filter((l) => l.status === "ENROLLED").length;
  const closedOut = converted + leads.filter((l) => l.status === "LOST").length;
  const followUpsDue = active.filter((l) => l.nextFollowUp && l.nextFollowUp <= new Date()).length;

  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);

  const stats = [
    { label: "Active leads", value: String(active.length) },
    { label: "Pipeline value", value: formatCurrency(pipelineValue) },
    { label: "Conversion rate", value: closedOut ? `${Math.round((converted / closedOut) * 100)}%` : "—" },
    { label: "Follow-ups due", value: String(followUpsDue), alert: followUpsDue > 0 },
    { label: "Enrolled (all time)", value: String(converted) },
  ];

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    interest: l.interest,
    source: l.source,
    status: l.status,
    estValue: l.estValue ? Number(l.estValue) : null,
    followUpDue: !!l.nextFollowUp && l.nextFollowUp <= new Date(),
  }));

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Growth"
        description="Leads, discovery flights, and the enrollment pipeline — every inquiry from the website form lands here"
      >
        <a href="/request-flight?org=golden-gate" target="_blank" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          <Megaphone className="h-4 w-4" /> Public form ↗
        </a>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-xl font-semibold ${s.alert ? "text-warning" : ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <LeadPipeline stages={[...STAGES]} leads={rows} readOnly={!!session!.impersonation?.readOnly} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Lead Sources</CardTitle>
          <CardDescription>Where inquiries come from — feeds marketing ROI reporting</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => (
            <Badge key={source} tone="blue" className="px-3 py-1.5">{source} · {count}</Badge>
          ))}
          {bySource.size === 0 && <p className="text-xs text-muted-foreground">No leads yet — share the public form to start the pipeline.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
