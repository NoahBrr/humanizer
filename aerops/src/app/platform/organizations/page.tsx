import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const orgs = await db.organization.findMany({
    include: { plan: true, _count: { select: { users: true, aircraft: true, locations: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{orgs.length} customer organizations on the platform</p>
        </div>
        <Link href="/platform/organizations/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-violet-700">
          <Plus className="h-4 w-4" /> New organization
        </Link>
      </div>

      <Card>
        <CardContent className="p-2">
          <Table>
            <THead>
              <TR><TH>Organization</TH><TH>Plan</TH><TH>Users</TH><TH>Aircraft</TH><TH>Locations</TH><TH>Created</TH><TH>Status</TH></TR>
            </THead>
            <TBody>
              {orgs.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/platform/organizations/${o.id}`} className="text-xs font-semibold text-primary hover:underline">{o.name}</Link>
                    <p className="font-mono text-[10px] text-muted-foreground">{o.slug}</p>
                  </TD>
                  <TD><Badge tone="violet">{o.plan?.name ?? "No plan"}</Badge></TD>
                  <TD className="text-xs tabular-nums">{o._count.users}{o.plan ? ` / ${o.plan.maxUsers}` : ""}</TD>
                  <TD className="text-xs tabular-nums">{o._count.aircraft}{o.plan ? ` / ${o.plan.maxAircraft}` : ""}</TD>
                  <TD className="text-xs tabular-nums">{o._count.locations}</TD>
                  <TD className="text-xs">{formatDate(o.createdAt)}</TD>
                  <TD><StatusBadge status={o.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
