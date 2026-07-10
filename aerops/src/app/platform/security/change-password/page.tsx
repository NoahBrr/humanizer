import { KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePlatformSession } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const session = await requirePlatformSession();
  const forced = !!session.mustChangePassword;

  return (
    <div className="mx-auto max-w-md animate-fade-up">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-muted-foreground" /> Change password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {forced && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              You must set a new password before continuing. This is required for your account.
            </p>
          )}
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
