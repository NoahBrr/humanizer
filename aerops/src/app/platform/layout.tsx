import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Activity, Building2, Crown, Database, DatabaseZap, LayoutDashboard, ScrollText, ShieldHalf, Users } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { getSession } from "@/lib/session";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { PlatformNavLinks, PlatformSignOut } from "./platform-nav";

export const metadata = { title: { default: "Platform", template: "%s · AeroOps Platform" } };

const PLATFORM_NAV = [
  { href: "/platform/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/platform/organizations", label: "Organizations", icon: Building2 },
  { href: "/platform/demo-data", label: "Demo Data Generator", icon: DatabaseZap },
  { href: "/platform/simulation", label: "Live Simulation", icon: Activity },
  { href: "/platform/imports", label: "Import Jobs", icon: Database },
  { href: "/platform/users", label: "Users", icon: Users },
  { href: "/platform/users/staff", label: "Platform Staff", icon: ShieldHalf },
  { href: "/platform/audit", label: "Audit Log", icon: ScrollText },
];

// Founder Controls (D3-A) is founder-exclusive — appended only for the immutable
// `isFounder` identity, never for a mere platform role. Non-founders never see it.
const FOUNDER_NAV = { href: "/platform/founder", label: "Founder Controls", icon: Crown };

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const pathname = (await headers()).get("x-pathname");

  // Public tokenized routes under /platform (the Platform User activation page)
  // carry no session. The middleware allow-lists them; render them bare, with no
  // console chrome. Every data-bearing page still self-guards via
  // requirePlatformSession()/requireFounderSession(), so the console cannot leak.
  if (!session) return <>{children}</>;
  if (!session.platformRole) redirect("/dashboard"); // customers never see /platform

  // Force a password rotation before any console use. Loop-safe: never redirect
  // while already on the change-password route, and fail open (no redirect) when
  // the path header is unavailable — so this can never trap a user in a loop.
  if (session.mustChangePassword && pathname && !pathname.startsWith("/platform/security/change-password")) {
    redirect("/platform/security/change-password");
  }

  const nav = session.isFounder ? [...PLATFORM_NAV, FOUNDER_NAV] : PLATFORM_NAV;

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white p-0.5 shadow-sm">
            <AeroOpsMark className="h-full w-full" />
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-bold tracking-[0.06em] text-white">
              AERO<span className="text-brand-sky">OPS</span> <span className="font-semibold text-sidebar-foreground/80">Platform</span>
            </p>
            <p className="text-[10px] text-sidebar-foreground/60">Internal · {PLATFORM_ROLE_LABELS[session.platformRole]}</p>
          </div>
        </div>
        <PlatformNavLinks items={nav.map(({ href, label }) => ({ href, label }))} />
        <div className="px-5 py-4">
          <PlatformSignOut name={`${session.firstName} ${session.lastName}`} />
        </div>
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
          <p className="text-xs font-medium text-muted-foreground">
            Internal administration — actions here affect customer organizations and are audited.
          </p>
          <Link href="/platform/organizations" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 lg:hidden">
            Organizations
          </Link>
        </header>
        <main className="mx-auto max-w-6xl p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
