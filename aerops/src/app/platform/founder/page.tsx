import Link from "next/link";
import { Crown, Users, ShieldCheck, MailPlus, ArrowRight, ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { requireFounderSession } from "@/lib/session";
import { founderConsoleStats } from "./founder-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Founder Controls" };

export default async function FounderControlsPage() {
  await requireFounderSession();
  const stats = await founderConsoleStats();

  const cards = [
    { label: "Platform users", value: stats.totalUsers, hint: `${stats.activeUsers} active`, icon: Users },
    { label: "Active founders", value: stats.activeFounders, hint: "Immutable identity", icon: Crown },
    { label: "Pending invites", value: stats.pendingInvites, hint: "Awaiting activation", icon: MailPlus },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-400">
          <Crown className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Founder Controls</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Founder-only administration for AeroOps staff accounts. Access keys on the immutable founder
            identity — not a role — and every action here is recorded in the audit log.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <c.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xl font-semibold leading-none tracking-tight">{c.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.label} · <span className="text-foreground/70">{c.hint}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/platform/founder/platform-users" className="group">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="flex items-start gap-3 p-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  Platform Users
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Invite AeroOps staff, change roles, deactivate or force-logout accounts, and scope
                  access (read-only, expiry). Changes to a founder require a recorded reason.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card className="h-full border-dashed">
          <CardContent className="flex items-start gap-3 p-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ScrollText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Audited by design</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Founder identity is set only by the bootstrap and can never be granted by assigning a
                role. The full trail lives in the{" "}
                <Link href="/platform/audit" className="font-medium text-primary hover:underline">audit log</Link>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
