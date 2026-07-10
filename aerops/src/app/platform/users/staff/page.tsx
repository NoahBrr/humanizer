import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { PLATFORM_ROLE_SPEC_ALIAS } from "@/lib/platform-permissions";
import { formatDate } from "@/lib/utils";
import { requirePlatformSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Staff" };

export default async function PlatformStaffPage() {
  await requirePlatformSession();
  const users = await db.platformUser.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="animate-fade-up">
      <Link href="/platform/users" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Users
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-xl font-semibold tracking-tight">Platform Staff</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">AeroOps employees. These accounts are separate from customer organizations and hold platform roles.</p>
      </div>
      <Card>
        <CardContent className="p-2">
          <Table>
            <THead><TR><TH>User</TH><TH>Email</TH><TH>Platform role</TH><TH>Status</TH><TH>Since</TH></TR></THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Avatar first={u.firstName} last={u.lastName} className="h-6 w-6 text-[9px]" />
                      <span className="text-xs font-medium">{u.firstName} {u.lastName}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{u.email}</TD>
                  <TD>
                    <Badge tone="violet">{PLATFORM_ROLE_SPEC_ALIAS[u.role]}</Badge>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{PLATFORM_ROLE_LABELS[u.role]}</span>
                  </TD>
                  <TD><Badge tone={u.isActive ? "green" : "gray"}>{u.isActive ? "Active" : "Inactive"}</Badge></TD>
                  <TD className="text-xs">{formatDate(u.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
