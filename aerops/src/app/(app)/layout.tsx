import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canAccess, ROLE_LABELS } from "@/lib/rbac";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NAV_ITEMS } from "@/components/shell/nav-config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const { role, organizationId, firstName, lastName, id } = session.user;

  const [org, unreadCount, recent] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.notification.count({ where: { organizationId, isRead: false, OR: [{ userId: null }, { userId: id }] } }),
    db.notification.findMany({
      where: { organizationId, OR: [{ userId: null }, { userId: id }] },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, title: true, body: true, createdAt: true },
    }),
  ]);

  const allowedPaths = NAV_ITEMS.filter((i) => canAccess(role, i.href)).map((i) => i.href);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Sidebar allowedPaths={allowedPaths} orgName={org?.name ?? "AeroOps"} />
      <CommandPalette allowedPaths={allowedPaths} />
      <MobileNav allowedPaths={allowedPaths} />
      <div className="lg:pl-56">
        <Topbar
          firstName={firstName}
          lastName={lastName}
          roleLabel={ROLE_LABELS[role]}
          unreadCount={unreadCount}
          recent={recent.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
        />
        <main id="main-content" className="mx-auto max-w-7xl p-4 pb-24 lg:p-6 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
