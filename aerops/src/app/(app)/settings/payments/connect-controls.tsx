"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/utils";

/**
 * Client actions for connected-payments onboarding. Both routes 409 when
 * charging is disabled in this environment — surfaced to the parent as a calm
 * "not enabled" state rather than a red error (spec Part P, doc 19).
 */
export function ConnectControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "onboard" | "sync">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  async function onboard() {
    setBusy("onboard");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/revenue/connect/onboard", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setDisabled(true);
        return;
      }
      if (!res.ok || !j.url) {
        setError(apiErrorMessage(j.error, "Could not start onboarding. Please try again."));
        return;
      }
      // Hand off to the provider-hosted onboarding surface.
      window.location.href = j.url;
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/revenue/connect/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // "Not enabled in this environment" and "onboarding not started" both
        // 409; the former is the environment gate, the latter is actionable.
        if (typeof j.error === "string" && /not enabled/i.test(j.error)) {
          setDisabled(true);
        } else {
          setError(apiErrorMessage(j.error, "Start onboarding before refreshing status."));
        }
        return;
      }
      if (!res.ok) {
        setError(apiErrorMessage(j.error, "Could not refresh status. Please try again."));
        return;
      }
      setNotice(j.note ?? "Status refreshed.");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (disabled) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium text-foreground">Connected payments aren&apos;t enabled in this environment</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Onboarding and status sync are unavailable here. They become active once the payment provider is
          configured for this environment — no action is needed from you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onboard} disabled={busy !== null}>
          {busy === "onboard" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Start / resume onboarding
        </Button>
        <Button variant="outline" onClick={sync} disabled={busy !== null}>
          {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh status
        </Button>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      {notice && <p className="text-xs font-medium text-success">{notice}</p>}
    </div>
  );
}
