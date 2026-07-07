import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AeroOpsLogo } from "@/components/brand/logo";
import { SignOutButton } from "./sign-out-button";

/**
 * Onboarding surface for individual accounts (signed in, no organization).
 * Members and platform staff are routed to their own homes — this shell
 * never shows organization modules.
 */
export default async function WelcomeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in?callbackUrl=/welcome");
  if (session.platformRole && !session.impersonation) redirect("/platform");
  if (session.kind !== "individual") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <AeroOpsLogo className="text-sm" />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {session.firstName} {session.lastName} · Individual account
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
