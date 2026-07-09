import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { activeLocationWeather, icaoOf, weatherSummary } from "@/lib/weather";
import { db } from "@/lib/db";
import { canAccessSection, ROLE_LABELS } from "@/lib/rbac";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { NAV_ITEMS } from "@/components/shell/nav-config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // Platform staff without an active impersonation belong in /platform.
  if (session.platformRole && !session.impersonation) redirect("/platform");
  // Individual accounts (no organization yet) live on the onboarding surface.
  if (session.kind === "individual") redirect("/welcome");

  if (session.orgStatus !== "ACTIVE") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">This organization is {session.orgStatus === "SUSPENDED" ? "suspended" : "deactivated"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Access is temporarily disabled. Your data is safe. Please contact your administrator or AeroOps support to restore access.
          </p>
        </div>
      </div>
    );
  }

  const { organizationId, userId } = session;
  const locationCookie = (await cookies()).get("aerops-location")?.value ?? "";
  const activeWx = await activeLocationWeather(session.organizationId, locationCookie);
  const [org, locations, unreadCount, recent] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.location.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true, icao: true }, orderBy: { name: "asc" } }),
    db.notification.count({ where: { organizationId, isRead: false, OR: [{ userId: null }, { userId }] } }),
    db.notification.findMany({
      where: { organizationId, OR: [{ userId: null }, { userId }] },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, title: true, body: true, createdAt: true },
    }),
  ]);

  const TRAINING_PROFILES = ["part_61", "part_141", "university"];
  const hasTraining =
    session.businessProfiles.length === 0 || session.businessProfiles.some((p) => TRAINING_PROFILES.includes(p));
  const allowedPaths = NAV_ITEMS.filter(
    (i) => canAccessSection(session.permissions, session.modules, i.href) && (i.href !== "/training" || hasTraining),
  ).map((i) => i.href);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {session.impersonation && (
        <ImpersonationBanner
          orgName={org?.name ?? ""}
          targetName={`${session.firstName} ${session.lastName}`}
          readOnly={session.impersonation.readOnly}
        />
      )}
      <Sidebar allowedPaths={allowedPaths} orgName={org?.name ?? "AeroOps"} />
      <CommandPalette allowedPaths={allowedPaths} />
      <MobileNav allowedPaths={allowedPaths} />
      <div className="app-shell lg:pl-56">
        <Topbar
          firstName={session.firstName}
          lastName={session.lastName}
          roleLabel={ROLE_LABELS[session.role]}
          unreadCount={unreadCount}
          recent={recent.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
          locations={locations}
          currentLocationId={locations.some((l) => l.id === locationCookie) ? locationCookie : ""}
          weather={activeWx ? { icao: icaoOf(activeWx.location), category: activeWx.weather.category, summary: weatherSummary(activeWx.weather) } : null}
        />
        <main id="main-content" className="mx-auto max-w-7xl p-4 pb-24 lg:p-6 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
