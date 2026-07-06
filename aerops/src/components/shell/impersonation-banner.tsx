"use client";

import { useState } from "react";
import { Eye, LogOut, Loader2 } from "lucide-react";

/**
 * Always-visible banner while a platform admin is impersonating an
 * organization user. Ending the session returns to /platform and is audited
 * server-side.
 */
export function ImpersonationBanner({ orgName, targetName, readOnly }: { orgName: string; targetName: string; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);

  async function endImpersonation() {
    setBusy(true);
    await fetch("/api/platform/impersonate", { method: "DELETE" });
    window.location.href = "/platform/organizations";
  }

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-violet-600 px-4 py-1.5 text-xs font-medium text-white">
      <Eye className="h-3.5 w-3.5" />
      Viewing {orgName} as {targetName}{readOnly ? " · read-only" : ""} — this support session is being recorded in the audit log.
      <button
        onClick={endImpersonation}
        disabled={busy}
        className="flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />} End session
      </button>
    </div>
  );
}
