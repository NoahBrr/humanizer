import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AeroOpsLogoStacked } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { getPlatformInvitationByToken } from "./invitation-data";
import { ActivateForm } from "./activate-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activate your account" };

const PROBLEMS: Record<string, string> = {
  invalid: "This setup link is invalid. Check that you copied the whole link, or ask your AeroOps administrator to send a new invitation.",
  used: "This setup link has already been used. If you already set your password, sign in below.",
  expired: "This setup link has expired. Ask your AeroOps administrator to send a new invitation.",
};

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPlatformInvitationByToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8">
          <AeroOpsLogoStacked />
        </div>

        {result.status !== "valid" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{PROBLEMS[result.status]}</p>
            </div>
            <Link href="/sign-in" className="block">
              <Button className="w-full" variant="outline">Go to sign in</Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4">
              <h1 className="text-lg font-semibold tracking-tight">Set your password</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Welcome, {result.invite.firstName}. You&apos;re activating the AeroOps platform account for{" "}
                <span className="font-medium text-foreground">{result.invite.email}</span> as{" "}
                <span className="font-medium text-foreground">{PLATFORM_ROLE_LABELS[result.invite.role]}</span>.
              </p>
            </div>
            <ActivateForm token={token} />
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Internal AeroOps staff access. All platform activity is audited.
        </p>
      </div>
    </div>
  );
}
