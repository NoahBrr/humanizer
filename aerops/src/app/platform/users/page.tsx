import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { formatDate } from "@/lib/utils";
import { requirePlatformSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Users" };

export default async function PlatformUsersPage() {
  await requirePlatformSession();
  const users = await db.platformUser.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="animate-fade-up">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Platform Users</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">AeroOps staff. These accounts are separate from customer organizations.</p>
      </div>
      <Card>
        <CardContent className="p-2">
          <Table>
            <THead><TR><TH>User</TH><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH>Since</TH></TR></THead>
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
                  <TD><Badge tone="violet">{PLATFORM_ROLE_LABELS[u.role]}</Badge></TD>
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
