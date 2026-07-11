import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CreditCard, CheckCircle2, AlertTriangle } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { RequirementsDue } from "@/lib/connected-account";
import { ConnectControls } from "./connect-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected Payments" };

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  REQUIREMENTS_DUE: "Requirements due",
  RESTRICTED: "Restricted",
  ENABLED: "Enabled",
  DISABLED: "Disabled",
  SUSPENDED: "Suspended",
};

/**
 * Connected-payments settings (spec Part P, doc 19). Read-only mirror of the
 * org's provider account — status, the charge gate, and any outstanding
 * requirements — plus onboarding/sync hand-offs to the Stripe-hosted surface.
 * Org-scoped from the session; gated on revenue.connect_manage. No money, no
 * KYC values, no secrets are ever read here.
 */
export default async function ConnectedPaymentsPage() {
  const session = await getSession();
  if (!session!.permissions.has("revenue.connect_manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;

  const account = await db.connectedAccount.findUnique({ where: { organizationId } });
  const requirements = (account?.requirementsDue as RequirementsDue | null) ?? null;
  const outstanding = requirements ? [...requirements.pastDue, ...requirements.currentlyDue] : [];

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader
        title="Connected Payments"
        description="Onboard your organization's payout account and keep its status in sync. KYC and bank details are entered on the provider's secure surface — never here."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Account Status</CardTitle>
          <CardDescription>
            Charging is enabled once your account is fully onboarded. Refresh to pull the latest state from the provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!account ? (
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="No connected account yet"
              description="Start onboarding to create your organization's payout account. You'll be taken to the provider's secure onboarding to enter your business and bank details."
            />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <Badge tone={statusTone(account.status)}>{STATUS_LABELS[account.status] ?? account.status}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Charging</span>
                  {account.chargesEnabled ? (
                    <Badge tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> Enabled</Badge>
                  ) : (
                    <Badge tone="gray">Not enabled</Badge>
                  )}
                </div>
                {account.lastStatusSyncAt && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Last synced</span>
                    <span className="text-xs font-medium">{formatDateTime(account.lastStatusSyncAt)}</span>
                  </div>
                )}
              </div>

              {outstanding.length > 0 && (
                <div className="rounded-lg border border-border bg-amber-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Requirements due
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Finish these on the provider onboarding to keep charging enabled.
                    {requirements?.currentDeadline ? ` Due by ${formatDateTime(new Date(requirements.currentDeadline))}.` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {outstanding.map((req) => (
                      <span key={req} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{req}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border pt-4">
            <ConnectControls />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
