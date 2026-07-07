import Link from "next/link";
import { Building2, Search, MonitorPlay, ArrowRight, UserRound } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { CancelRequestButton } from "./request-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

const OPTIONS = [
  {
    href: "/welcome/create",
    icon: Building2,
    title: "Create a new company or operator",
    body: "Set up your flight school, club, FBO, or flight department on AeroOps. You'll be the organization owner.",
  },
  {
    href: "/welcome/join",
    icon: Search,
    title: "Join an existing company or operator",
    body: "Search by name, airport, or organization code and request access. An admin will approve your request.",
  },
  {
    href: "/demo",
    icon: MonitorPlay,
    title: "Request a demo",
    body: "See AeroOps in action with our team before setting anything up.",
  },
];

export default async function WelcomePage() {
  const session = (await getSession())!;
  const requests = await db.joinRequest.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { organization: { select: { name: true } } },
  });
  const open = requests.filter((r) => r.status === "PENDING" || r.status === "MORE_INFO");

  return (
    <div className="animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to AeroOps, {session.firstName}!</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your account is ready. What would you like to do?
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <Link key={o.href} href={o.href} className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/50">
            <o.icon className="h-6 w-6 text-brand-royal" />
            <p className="mt-3 flex items-center gap-1 text-sm font-semibold">
              {o.title}
              <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{o.body}</p>
          </Link>
        ))}
      </div>

      <Card className="mt-6">
        <CardContent className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserRound className="h-4 w-4 text-muted-foreground" /> Your join requests
          </p>
          {requests.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No requests yet. When you ask to join an organization, its status will appear here.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.organization.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Requested {r.requestedRole.toLowerCase().replaceAll("_", " ")} · {r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {r.adminResponse && <span className="ml-1 text-foreground/80">— “{r.adminResponse}”</span>}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                  {(r.status === "PENDING" || r.status === "MORE_INFO") && <CancelRequestButton id={r.id} />}
                </div>
              ))}
            </div>
          )}
          {open.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              You&apos;ll get access automatically the moment an administrator approves your request.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        You can also continue as an individual — your account works without an organization, and you can join one any time.
      </p>
    </div>
  );
}
