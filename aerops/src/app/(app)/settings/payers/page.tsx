import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { fullName } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import { CreatePayerForm } from "./payers-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Responsible Payers" };

/**
 * Staff management of responsible payers (doc 11 §4). Create a payer, link a
 * student, and hand off the one-time invite token. Org-scoped from the session;
 * gated on revenue.payment_methods_manage.
 */
export default async function PayersSettingsPage() {
  const session = await getSession();
  if (!session!.permissions.has("revenue.payment_methods_manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;

  const [payers, students] = await Promise.all([
    db.responsiblePayer.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        relationships: {
          where: { status: "ACTIVE" },
          include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
    }),
    db.student.findMany({
      where: { user: { organizationId } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { lastName: "asc" } },
    }),
  ]);

  const studentOptions = students.map((s) => ({ id: s.id, name: fullName(s.user) }));

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader
        title="Responsible Payers"
        description="Parents, employers, and sponsors who bill for students. Create a payer, link a student, and share the one-time invite."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a payer</CardTitle>
          <CardDescription>They receive a single-use invite token to claim their account and manage payment methods.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CreatePayerForm students={studentOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          {payers.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No payers yet" description="Add a parent, employer, or sponsor above to bill on a student's behalf." />
          ) : (
            <ul className="divide-y divide-border">
              {payers.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {p.displayName}
                      <Badge tone="gray">{p.payerType.replaceAll("_", " ").toLowerCase()}</Badge>
                      <StatusBadge status={p.status} />
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.email}{p.companyName ? ` · ${p.companyName}` : ""}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.relationships.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">No linked students</span>
                      ) : (
                        p.relationships.map((r) => (
                          <Badge key={r.id} tone={r.isDefault ? "blue" : "gray"}>
                            {fullName(r.student.user)}{r.isDefault ? " · default" : ""}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-[11px] text-muted-foreground">
        Roles shown use aviation-native labels ({ROLE_LABELS.STUDENT}). Payers are not organization members — they reach only their own portal.
      </p>
    </div>
  );
}
