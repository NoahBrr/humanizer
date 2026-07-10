import Link from "next/link";
import { Search, Users2, ShieldHalf } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/rbac";
import { requirePlatformSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

const MIN_QUERY = 2;
const RESULT_LIMIT = 30;

function userStatus(u: { isActive: boolean; deletedAt: Date | null }) {
  if (u.deletedAt) return "Deleted";
  return u.isActive ? "Active" : "Suspended";
}

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformSession();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  // Cross-tenant search is intentional and only reachable behind the platform
  // guard. Bounded by RESULT_LIMIT — the user table is unbounded.
  const results = query.length >= MIN_QUERY
    ? await db.user.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, email: true, role: true,
          isActive: true, deletedAt: true, customRoleId: true,
          organization: { select: { id: true, name: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: RESULT_LIMIT + 1,
      })
    : [];
  const truncated = results.length > RESULT_LIMIT;
  const users = results.slice(0, RESULT_LIMIT);

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Search every customer user across all organizations.</p>
        </div>
        <Link href="/platform/users/staff" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted/50">
          <ShieldHalf className="h-4 w-4" /> Platform staff
        </Link>
      </div>

      <form className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by name or email…"
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm shadow-sm"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="h-9 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700">Search</button>
      </form>

      {query.length < MIN_QUERY ? (
        <EmptyState icon={<Users2 className="h-5 w-5" />} title="Search for a user" description="Type at least two characters of a name or email to find any customer user on the platform." />
      ) : users.length === 0 ? (
        <EmptyState icon={<Search className="h-5 w-5" />} title="No matches" description={`No users match “${query}”. Try a different name or email.`} />
      ) : (
        <Card>
          <CardContent className="p-2">
            <Table>
              <THead><TR><TH>User</TH><TH>Email</TH><TH>Organization</TH><TH>Role</TH><TH>Status</TH><TH></TH></TR></THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Avatar first={u.firstName} last={u.lastName} className="h-6 w-6 text-[9px]" />
                        <Link href={`/platform/users/${u.id}`} className="text-xs font-semibold text-primary hover:underline">{u.firstName} {u.lastName}</Link>
                      </div>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{u.email}</TD>
                    <TD className="text-xs">
                      {u.organization ? (
                        <Link href={`/platform/organizations/${u.organization.id}`} className="hover:underline">{u.organization.name}</Link>
                      ) : (
                        <span className="text-muted-foreground">No organization</span>
                      )}
                    </TD>
                    <TD className="text-xs">{u.customRoleId ? <Badge tone="violet">Custom role</Badge> : ROLE_LABELS[u.role]}</TD>
                    <TD><StatusBadge status={userStatus(u)} /></TD>
                    <TD><Link href={`/platform/users/${u.id}`} className="text-xs font-medium text-primary hover:underline">Manage</Link></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {truncated && <p className="mt-2 text-xs text-muted-foreground">Showing the first {RESULT_LIMIT} matches — refine your search to narrow the list.</p>}
    </div>
  );
}
