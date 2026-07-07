"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, HelpCircle, Link2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ROLE_LABELS } from "@/lib/rbac";

const ASSIGNABLE_ROLES = ["STUDENT", "INSTRUCTOR", "DISPATCHER", "MAINTENANCE", "ACCOUNTANT", "SCHOOL_ADMIN"] as const;

type LocationOpt = { id: string; name: string; icao: string | null };

// --- Per-request decision panel ------------------------------------------------

export function DecisionPanel({ requestId, requestedRole, locations }: { requestId: string; requestedRole: string; locations: LocationOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState(requestedRole);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [adminNote, setAdminNote] = useState("");
  const [response, setResponse] = useState("");
  const [showReject, setShowReject] = useState<false | "reject" | "more_info">(false);

  async function act(action: "approve" | "reject" | "more_info") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/join-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          role: action === "approve" ? role : undefined,
          locationId: action === "approve" && locationId ? locationId : undefined,
          adminNote: adminNote || undefined,
          adminResponse: action !== "approve" ? response || undefined : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Action failed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Assign role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 text-xs">
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Assign location</Label>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-8 text-xs">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.icao ? `${l.icao} — ` : ""}{l.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Internal note <span className="text-muted-foreground/60">(never shown)</span></Label>
          <Input className="h-8 text-xs" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="e.g. verified with chief CFI" />
        </div>
      </div>

      {showReject && (
        <div className="space-y-1">
          <Label>{showReject === "reject" ? "Reason shown to the requester" : "What info do you need from them?"}</Label>
          <Textarea value={response} onChange={(e) => setResponse(e.target.value)} className="min-h-16 text-xs" />
        </div>
      )}
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!showReject ? (
          <>
            <Button size="sm" variant="success" onClick={() => act("approve")} disabled={!!busy}>
              {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve as {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowReject("more_info")} disabled={!!busy}>
              <HelpCircle className="h-3.5 w-3.5" /> Ask for more info
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setShowReject("reject")} disabled={!!busy}>
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant={showReject === "reject" ? "destructive" : "default"} onClick={() => act(showReject)} disabled={!!busy || !response.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : showReject === "reject" ? <X className="h-3.5 w-3.5" /> : <HelpCircle className="h-3.5 w-3.5" />}
              {showReject === "reject" ? "Confirm rejection" : "Send info request"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)} disabled={!!busy}>Back</Button>
          </>
        )}
      </div>
    </div>
  );
}

// --- Invite links manager --------------------------------------------------------

type LinkRow = { id: string; label: string; role: string; autoApprove: boolean; uses: number; maxUses: number | null; expiresAt: string | null };

export function InviteLinksManager({ links }: { links: LinkRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [copied, setCopied] = useState(false);
  // The shareable URL is returned once at creation and never stored, so it is
  // shown here exactly once for the admin to copy (ADR-020).
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [label, setLabel] = useState("General invite");
  const [role, setRole] = useState("STUDENT");
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");

  async function create() {
    setBusy(true);
    const res = await fetch("/api/invite-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        role,
        autoApprove,
        maxUses: maxUses ? Number(maxUses) : null,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setShowNew(false);
    if (res.ok && data?.link?.url) setFreshUrl(`${window.location.origin}${data.link.url}`);
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    await fetch("/api/invite-links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setBusy(false);
    router.refresh();
  }

  function copyFresh() {
    if (!freshUrl) return;
    navigator.clipboard.writeText(freshUrl).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Invite links</p>
        <Button size="sm" variant="outline" onClick={() => setShowNew(!showNew)}><Plus className="h-3.5 w-3.5" /> New link</Button>
      </div>

      {freshUrl && (
        <div className="rounded-lg border border-brand-royal/30 bg-brand-royal/5 p-3">
          <p className="text-xs font-semibold text-brand-navy dark:text-foreground">Copy this link now — it won&apos;t be shown again.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1.5 text-[11px] text-muted-foreground">{freshUrl}</code>
            <Button size="sm" onClick={copyFresh}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </Button>
            <button onClick={() => setFreshUrl(null)} className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {showNew && (
        <Card>
          <CardContent className="grid gap-2 p-3 sm:grid-cols-5">
            <div className="space-y-1"><Label>Label</Label><Input className="h-8 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select className="h-8 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </div>
            <div className="space-y-1"><Label>Max uses</Label><Input className="h-8 text-xs" type="number" min={1} placeholder="∞" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></div>
            <div className="space-y-1"><Label>Expires (days)</Label><Input className="h-8 text-xs" type="number" min={1} placeholder="never" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} /></div>
            <div className="flex flex-col justify-between gap-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium">
                <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand-royal)]" />
                Auto-approve
              </label>
              <Button size="sm" onClick={create} disabled={busy || label.trim().length < 2}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {links.length === 0 && !showNew && (
        <p className="rounded-lg border border-border bg-card px-4 py-4 text-xs text-muted-foreground">
          No active invite links. Create one to onboard students, members, or staff without individual email invitations.
        </p>
      )}
      {links.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {l.label} · {ROLE_LABELS[l.role as keyof typeof ROLE_LABELS]}
              {l.autoApprove && <span className="ml-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">auto-approve</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {l.uses}{l.maxUses ? `/${l.maxUses}` : ""} uses
              {l.expiresAt ? ` · expires ${new Date(l.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : " · no expiration"}
            </p>
          </div>
          <button onClick={() => revoke(l.id)} disabled={busy} className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Revoke link">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
