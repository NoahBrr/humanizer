import { getSession } from "@/lib/session";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

/**
 * Public marketing site shell. Fully separate from the authenticated app:
 * no org data is rendered here; signed-in visitors just get an
 * "Open AeroOps" shortcut to their home surface.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(() => null);
  const authedHref = !session
    ? null
    : session.platformRole && !session.impersonation
      ? "/platform"
      : session.kind === "individual"
        ? "/welcome"
        : "/dashboard";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader authedHref={authedHref} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
