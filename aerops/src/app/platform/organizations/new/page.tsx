import { db } from "@/lib/db";
import { NewOrgWizard } from "./new-org-wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "New Organization" };

export default async function NewOrganizationPage() {
  const plans = await db.subscriptionPlan.findMany({ orderBy: { priceMonthly: "asc" } });
  return (
    <NewOrgWizard
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.priceMonthly),
        maxUsers: p.maxUsers,
        maxAircraft: p.maxAircraft,
        maxLocations: p.maxLocations,
      }))}
    />
  );
}
