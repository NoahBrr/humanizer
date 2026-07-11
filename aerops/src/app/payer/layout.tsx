import { redirect } from "next/navigation";
import { authorizePayer } from "@/lib/session";
import { resolvePayerScope } from "@/lib/payers";
import { AeroOpsLogo } from "@/components/brand/logo";
import { SignOutButton } from "./sign-out-button";

/**
 * Responsible-payer self-service surface (doc 11 §7, doc 36 §5.2). A dedicated
 * top-level shell OUTSIDE the (app) tenant group — payers are Users linked via
 * StudentPayerRelationship, NOT organization members, so they never reach the
 * org sidebar or any org module. The gate + scope both derive from the caller's
 * own payer rows; a non-payer is bounced to sign-in.
 */
export default async function PayerLayout({ children }: { children: React.ReactNode }) {
  const { session, error } = await authorizePayer();
  if (error || !session) redirect("/sign-in?callbackUrl=/payer");

  const scope = await resolvePayerScope(session.userId);
  if (!scope.isPayer) redirect("/sign-in?callbackUrl=/payer");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <AeroOpsLogo className="text-sm" />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {session.firstName} {session.lastName} · Payer
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
