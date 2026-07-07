import { requirePlatformSession } from "@/lib/session";
import DemoDataClient from "./demo-data-client";

export const metadata = { title: "Demo Data" };

export default async function DemoDataPage() {
  await requirePlatformSession();
  return <DemoDataClient />;
}
