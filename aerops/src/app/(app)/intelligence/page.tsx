import { redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles, Workflow } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { generateInsights } from "@/lib/insights";
import { AUTOMATIONS } from "@/lib/automations";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { AskBox } from "./ask-box";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intelligence" };

export default async function IntelligencePage() {
  const session = await getSession();
  if (!session!.permissions.has("students.view")) redirect("/dashboard");
  const organizationId = session!.organizationId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [insights, org, payMonth] = await Promise.all([
    generateInsights(organizationId),
    db.organization.findUnique({ where: { id: organizationId }, select: { disabledAutomations: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
  ]);

  // Simple, honest forecast: MTD revenue run-rate projected to month end.
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const mtd = Number(payMonth._sum.amount ?? 0);
  const forecast = dayOfMonth > 2 ? (mtd / dayOfMonth) * daysInMonth : null;

  const severityTone = { ACT_NOW: "red", THIS_WEEK: "amber", OPPORTUNITY: "blue" } as const;
  const categoryTone = { OPERATIONS: "blue", MAINTENANCE: "orange", TRAINING: "green", FINANCE: "purple", GROWTH: "cyan" } as const;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="AeroOps Intelligence"
        description="Recommendations with their reasoning, data, and confidence — the assistant proposes, humans decide"
      />

      <AskBox />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Today&apos;s Recommendations</CardTitle>
            <CardDescription>
              Generated live from airworthiness, readiness, workload, pipeline, and ledger state — never from guesswork
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {insights.length === 0 && <p className="text-xs text-muted-foreground">Nothing needs attention — a rare and beautiful morning.</p>}
            {insights.map((ins, i) => (
              <Link key={i} href={ins.href} className="block rounded-lg border border-border p-3 transition-shadow hover:shadow-md">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={severityTone[ins.severity]}>{ins.severity.replaceAll("_", " ").toLowerCase()}</Badge>
                  <Badge tone={categoryTone[ins.category]}>{ins.category.toLowerCase()}</Badge>
                  <span className="text-xs font-semibold">{ins.recommendation}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">confidence: {ins.confidence.toLowerCase()}</span>
                </div>
                <p className="mt-1.5 text-[11px]"><span className="font-medium text-muted-foreground">Why:</span> {ins.why}</p>
                <p className="text-[11px]"><span className="font-medium text-muted-foreground">Data:</span> {ins.data}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Forecast</CardTitle>
              <CardDescription>Month-end revenue at current run-rate</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{forecast ? formatCurrency(forecast) : "—"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatCurrency(mtd)} collected through day {dayOfMonth} of {daysInMonth}. Linear run-rate — seasonality-aware forecasting arrives with the modeling layer.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><Workflow className="h-4 w-4" /> Automation Status</CardTitle>
              <CardDescription>Rules running on operational events</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(AUTOMATIONS).map(([key, a]) => {
                const enabled = !(org?.disabledAutomations ?? []).includes(key);
                return (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{a.label}</span>
                    <Badge tone={enabled ? "green" : "gray"}>{enabled ? "Active" : "Off"}</Badge>
                  </div>
                );
              })}
              <p className="pt-1 text-[10px] text-muted-foreground">Managed in Settings → Workflow Automations.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Safety Boundaries</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-[11px] text-muted-foreground">
              <p>The assistant never dispatches aircraft, approves maintenance, moves money, or deletes records.</p>
              <p>Every action stays behind the permissioned, audited APIs — the AI recommends, people decide.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
