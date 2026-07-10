"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LogOut, Pause, Play, ShieldCheck, Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@prisma/client";

type Props = {
  userId: string;
  userName: string;
  impersonating: boolean;
  state: { isActive: boolean; isDeleted: boolean; isOwner: boolean; hasOrg: boolean; orgActive: boolean };
  current: { role: Role; customRoleId: string | null };
  roleOptions: { value: Role; label: string }[];
  customRoles: { id: string; name: string }[];
  can: { manage: boolean; roles: boolean; transferOwner: boolean; impersonate: boolean };
};

export function UserActions({ userId, userName, impersonating, state, current, roleOptions, customRoles, can }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(current.role);
  const [customRoleId, setCustomRoleId] = useState<string>(current.customRoleId ?? "");

  const anyPower = can.manage || can.roles || can.transferOwner || can.impersonate;
  const locked = busy || impersonating;

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Action failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(readOnly: boolean) {
    setBusy(true);
    const res = await fetch("/api/platform/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, readOnly }),
    });
    if (res.ok) window.location.href = "/dashboard";
    else { setBusy(false); setError("Could not start the session."); }
  }

  if (!anyPower) {
    return (
      <Card><CardContent className="p-4 text-xs text-muted-foreground">Your platform role has read-only access to this user.</CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Manage user</CardTitle>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </CardHeader>
      <CardContent className="space-y-3">
        {impersonating && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            End the active impersonation session before managing users — actions are disabled while impersonating.
          </p>
        )}
        {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        {can.manage && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Access</span>
            {!state.isDeleted && state.isActive && (
              <Button variant="outline" size="sm" disabled={locked} onClick={() => act({ action: "deactivate" }, `Deactivate ${userName}? They lose access immediately (data is preserved).`)}>
                <Pause className="h-3.5 w-3.5" /> Deactivate
              </Button>
            )}
            {!state.isDeleted && !state.isActive && (
              <Button variant="success" size="sm" disabled={locked} onClick={() => act({ action: "reactivate" })}>
                <Play className="h-3.5 w-3.5" /> Reactivate
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={locked} onClick={() => act({ action: "force_logout" }, `Force ${userName} to sign out of all devices?`)}>
              <LogOut className="h-3.5 w-3.5" /> Force logout
            </Button>
          </div>
        )}

        {can.roles && state.hasOrg && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Role</span>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={locked} className="h-8 w-52 text-xs" aria-label="Built-in role">
              {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => act({ action: "set_role", role }, `Set ${userName}'s role to ${roleOptions.find((r) => r.value === role)?.label}? Any custom role is cleared.`)}>
              Apply role
            </Button>
            {customRoles.length > 0 && (
              <>
                <span className="text-[11px] text-muted-foreground">or</span>
                <Select value={customRoleId} onChange={(e) => setCustomRoleId(e.target.value)} disabled={locked} className="h-8 w-52 text-xs" aria-label="Custom role">
                  <option value="">Custom role…</option>
                  {customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                <Button variant="secondary" size="sm" disabled={locked || !customRoleId} onClick={() => act({ action: "set_custom_role", customRoleId }, `Assign the “${customRoles.find((r) => r.id === customRoleId)?.name}” custom role to ${userName}?`)}>
                  Apply custom
                </Button>
              </>
            )}
          </div>
        )}

        {can.transferOwner && state.hasOrg && !state.isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ownership</span>
            <Button variant="outline" size="sm" disabled={locked || !state.isActive || state.isDeleted} onClick={() => act({ action: "transfer_owner" }, `Make ${userName} the Account Owner of this organization? They will be promoted to the owner role.`)}>
              <Crown className="h-3.5 w-3.5" /> Make Account Owner
            </Button>
          </div>
        )}

        {can.impersonate && state.hasOrg && state.isActive && state.orgActive && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Support</span>
            <Button variant="outline" size="sm" disabled={locked} onClick={() => impersonate(true)} title={`View the workspace as ${userName} (read-only)`}>
              <Eye className="h-3.5 w-3.5" /> View as (read-only)
            </Button>
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => { if (window.confirm(`Impersonate ${userName} with FULL access? Every action is audited and the customer is notified.`)) impersonate(false); }}>
              <ShieldCheck className="h-3.5 w-3.5" /> Full access
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
