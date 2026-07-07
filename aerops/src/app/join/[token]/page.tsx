import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { AeroOpsLogoStacked } from "@/components/brand/logo";
import { ROLE_LABELS } from "@/lib/rbac";
import { RedeemButton } from "./redeem-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join organization" };

/**
 * Landing page for shareable invite links. Public: signed-out visitors are
 * pointed at sign-in/sign-up (with a return path); signed-in individual
 * accounts can redeem in one click.
 */
export default async function JoinTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link, session] = await Promise.all([
    db.inviteLink.findUnique({
      where: { token },
      include: { organization: { select: { name: true, brandColor: true, status: true, deletedAt: true } } },
    }),
    getSession(),
  ]);

  const invalid =
    !link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date()) ||
    (link.maxUses !== null && link.uses >= link.maxUses) ||
    link.organization.status !== "ACTIVE" || link.organization.deletedAt;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-up text-center">
        <AeroOpsLogoStacked className="mb-8" />
        {invalid || !link ? (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className="text-sm font-semibold">This invite link is no longer valid</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              It may have expired, reached its limit, or been revoked. Ask your organization for a new link, or search for it instead.
            </p>
            <Link href={session ? "/welcome/join" : "/sign-up"} className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {session ? "Search organizations" : "Create an account"}
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: link.organization.brandColor }}>
              {link.organization.name.slice(0, 2).toUpperCase()}
            </span>
            <p className="mt-3 text-sm font-semibold">You&apos;re invited to join {link.organization.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              as {ROLE_LABELS[link.role]} · {link.autoApprove ? "instant access" : "an admin will confirm your request"}
            </p>
            {!session ? (
              <div className="mt-4 space-y-2">
                <Link href={`/sign-up?callbackUrl=/join/${token}`} className="flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Create account to join
                </Link>
                <Link href={`/sign-in?callbackUrl=/join/${token}`} className="flex h-9 w-full items-center justify-center rounded-lg border border-border text-sm font-medium hover:bg-muted">
                  I already have an account
                </Link>
              </div>
            ) : session.kind === "individual" ? (
              <RedeemButton token={token} orgName={link.organization.name} autoApprove={link.autoApprove} />
            ) : (
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                You already belong to an organization, so this invite can&apos;t be used with this account.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
