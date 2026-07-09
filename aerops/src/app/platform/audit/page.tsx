import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { requirePlatformSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  await requirePlatformSession();
  const { org } = await searchParams;
  const [logs, orgs] = await Promise.all([
    db.auditLog.findMany({
      where: org ? { organizationId: org } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { organization: { select: { name: true } } },
    }),
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="animate-fade-up">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Immutable, append-only record of every important action across the platform.</p>
      </div>

      <form className="mb-3">
        <select
          name="org"
          defaultValue={org ?? ""}
          className="h-8 rounded-lg border border-input bg-card px-3 text-xs shadow-sm"
          aria-label="Filter by organization"
        >
          <option value="">All organizations</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button type="submit" className="ml-2 h-8 cursor-pointer rounded-lg border border-border bg-card px-3 text-xs font-medium shadow-sm hover:bg-muted">Filter</button>
      </form>

      <Card>
        <CardContent className="p-2">
          <Table>
            <THead>
              <TR><TH>Time</TH><TH>Action</TH><TH>Actor</TH><TH>Organization</TH><TH>Entity</TH><TH>Change</TH><TH>IP</TH></TR>
            </THead>
            <TBody>
              {logs.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(l.createdAt)}</TD>
                  <TD><code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{l.action}</code></TD>
                  <TD className="text-xs">{l.actorLabel}</TD>
                  <TD className="text-xs">{l.organization?.name ?? "—"}</TD>
                  <TD className="text-[11px] text-muted-foreground">{l.entityType ?? "—"}</TD>
                  <TD className="max-w-64 truncate text-[10px] text-muted-foreground">
                    {l.newValue ? JSON.stringify(l.newValue) : "—"}
                  </TD>
                  <TD className="text-[11px] text-muted-foreground">{l.ip ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
