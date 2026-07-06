import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/rbac";
import { AcceptInviteForm } from "./accept-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join your organization" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { organization: { select: { name: true, status: true } }, customRole: { select: { name: true } } },
  });

  const invalid =
    !invitation || invitation.acceptedAt !== null || invitation.expiresAt < new Date() || invitation.organization.status !== "ACTIVE";

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">This invitation isn&apos;t valid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have expired or already been used. Ask your organization&apos;s administrator to send a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AcceptInviteForm
      token={token}
      orgName={invitation.organization.name}
      email={invitation.email}
      roleLabel={invitation.customRole?.name ?? ROLE_LABELS[invitation.role]}
    />
  );
}
