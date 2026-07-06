import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.platformRole && !session.impersonation) redirect("/platform");
  redirect("/dashboard");
}
