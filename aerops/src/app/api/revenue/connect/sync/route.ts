import { NextResponse } from "next/server";
import { authorize } from "@/lib/session";
import { syncConnectedAccount } from "@/lib/connect-onboarding";

/**
 * Pull the latest connected-account status from the provider and reduce it into
 * our projection (doc 19). Out-of-order safe (the reducer ignores stale
 * snapshots). Read-through of provider state — no money moves. Test mode only.
 */
export async function POST() {
  const { session, error } = await authorize("revenue.connect_manage", { mutating: true });
  if (error) return error;

  const result = await syncConnectedAccount(session.organizationId, new Date());
  switch (result.status) {
    case "disabled": return NextResponse.json({ error: "Connected payments are not enabled for this environment." }, { status: 409 });
    case "not_started": return NextResponse.json({ error: "Onboarding has not been started for this school." }, { status: 409 });
    case "stale": return NextResponse.json({ ok: true, note: "Already up to date." });
    default: return NextResponse.json({ ok: true, status: result.accountStatus, chargesEnabled: result.chargesEnabled });
  }
}
