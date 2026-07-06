import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, LayoutDashboard, ScrollText, Users, Plane } from "lucide-react";
import { getSession } from "@/lib/session";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { PlatformNavLinks, PlatformSignOut } from "./platform-nav";

export const metadata = { title: { default: "Platform", template: "%s · AeroOps Platform" } };

const PLATFORM_NAV = [
  { href: "/platform/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/platform/organizations", label: "Organizations", icon: Building2 },
  { href: "/platform/users", label: "Platform Users", icon: Users },
  { href: "/platform/audit", label: "Audit Log", icon: ScrollText },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.platformRole) redirect("/dashboard"); // customers never see /platform

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white">
            <Plane className="h-4 w-4 -rotate-45" />
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold tracking-tight text-white">AeroOps Platform</p>
            <p className="text-[10px] text-sidebar-foreground/60">Internal · {PLATFORM_ROLE_LABELS[session.platformRole]}</p>
          </div>
        </div>
        <PlatformNavLinks items={PLATFORM_NAV.map(({ href, label }) => ({ href, label }))} />
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
