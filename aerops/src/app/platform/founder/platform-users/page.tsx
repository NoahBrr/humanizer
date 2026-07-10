import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireFounderSession } from "@/lib/session";
import { listPlatformUsersForFounder } from "../founder-data";
import { PlatformUsersClient } from "./platform-users-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Users" };

export default async function FounderPlatformUsersPage() {
  const session = await requireFounderSession();
  const users = await listPlatformUsersForFounder();

  return (
    <div className="animate-fade-up">
      <Link href="/platform/founder" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Founder Controls
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-xl font-semibold tracking-tight">Platform Users</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Invite and manage AeroOps staff accounts. Every change is audited; changing a founder requires a recorded reason.
        </p>
      </div>
      <PlatformUsersClient users={users} currentUserId={session.userId} />
    </div>
  );
}
