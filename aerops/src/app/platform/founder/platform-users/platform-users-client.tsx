"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, Copy, Crown, Loader2, LogOut, MailPlus, Pause, Play, Search, Settings2, ShieldAlert, UserPlus,
} from "lucide-react";
import type { PlatformRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";
import { ASSIGNABLE_PLATFORM_ROLES } from "@/lib/platform-user-admin";
import { apiErrorMessage, formatDate } from "@/lib/utils";
import type { PlatformUserRow } from "../founder-data";

const ROLE_OPTIONS = ASSIGNABLE_PLATFORM_ROLES.map((value) => ({ value, label: PLATFORM_ROLE_LABELS[value] }));

export function PlatformUsersClient({ users, currentUserId }: { users: PlatformUserRow[]; currentUserId: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      PLATFORM_ROLE_LABELS[u.role].toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <div className="space-y-6">
      <InviteForm />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Staff accounts <span className="ml-1 font-normal text-muted-foreground">({users.length})</span></CardTitle>
          <div className="relative w-56 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, role"
              className="h-8 pl-8 text-xs"
              aria-label="Search platform users"
            />
          </div>
        </CardHeader>
        <CardContent className="p-2">
          <Table>
            <THead>
              <TR><TH>User</TH><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH className="text-right">Manage</TH></TR>
            </THead>
            <TBody>
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />
              ))}
              {filtered.length === 0 && (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    No platform users match “{query}”.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Invite -------------------------------------------------------------------

function InviteForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<PlatformRole>("SUPPORT_ENGINEER");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSetupUrl(null);
    try {
      const res = await fetch("/api/platform/founder/platform-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName, role, expiresInDays: Number(expiresInDays) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.setupUrl) {
        setSetupUrl(`${window.location.origin}${data.setupUrl}`);
        setEmail(""); setFirstName(""); setLastName("");
        setCopied(false);
      } else {
        setError(apiErrorMessage(data.error, "Could not create the invitation."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MailPlus className="h-4 w-4 text-muted-foreground" /> Invite a platform user</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new.staff@aerops.io" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-first">First name</Label>
            <Input id="inv-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-last">Last name</Label>
            <Input id="inv-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-role">Role</Label>
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-days">Link expires in (days)</Label>
            <Input id="inv-days" type="number" min={1} max={30} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} className="w-40" />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create invite
            </Button>
          </div>
        </form>

        {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        {setupUrl && (
          <div className="space-y-1.5 rounded-lg border border-success/40 bg-success/10 p-3">
            <p className="text-xs font-medium text-foreground">One-time setup link — share it securely. It is shown once and expires.</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
              <code className="min-w-0 flex-1 truncate text-[11px]">{setupUrl}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(setupUrl); setCopied(true); }}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          The invitee sets their own password on activation — a founder never handles another user&apos;s password.
          Founder Super Admin cannot be invited; founder authority is bootstrap-only.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Row + actions ------------------------------------------------------------

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function UserRow({ user, isSelf }: { user: PlatformUserRow; isSelf: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [roleDraft, setRoleDraft] = useState<PlatformRole>(user.role);
  const [readOnlyDraft, setReadOnlyDraft] = useState(user.readOnly);
  const [expiryDraft, setExpiryDraft] = useState(toLocalInput(user.accessExpiresAt));

  const expired = !!user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date();
  // Changing a founder always requires a recorded reason (server enforces >= 3 chars).
  const reasonRequired = user.isFounder;
  const reasonOk = !reasonRequired || reason.trim().length > 0;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/founder/platform-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reasonRequired ? { ...body, reason: reason.trim() } : body),
      });
      if (res.ok) {
        setReason("");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(apiErrorMessage(data.error, "Action failed."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TR className={open ? "bg-muted/40" : undefined}>
        <TD>
          <div className="flex items-center gap-2">
            <Avatar first={user.firstName} last={user.lastName} className="h-6 w-6 text-[9px]" />
            <span className="flex items-center gap-1 text-xs font-medium">
              {user.firstName} {user.lastName}
              {user.isFounder && <Crown className="h-3 w-3 text-violet-500" aria-label="Founder" />}
            </span>
          </div>
        </TD>
        <TD className="text-xs text-muted-foreground">{user.email}</TD>
        <TD className="text-xs">{PLATFORM_ROLE_LABELS[user.role]}</TD>
        <TD>
          <div className="flex flex-wrap items-center gap-1">
            {user.isFounder && <Badge tone="violet">Founder</Badge>}
            {!user.isActive && <Badge tone="gray">Inactive</Badge>}
            {user.readOnly && <Badge tone="amber">Read-only</Badge>}
            {user.mustChangePassword && <Badge tone="orange">Must reset</Badge>}
            {user.accessExpiresAt && (
              <Badge tone={expired ? "red" : "cyan"}>{expired ? "Expired" : `Until ${formatDate(user.accessExpiresAt)}`}</Badge>
            )}
            {user.mfaEnabled && <Badge tone="green">MFA</Badge>}
            {user.isActive && !user.readOnly && !user.mustChangePassword && !user.accessExpiresAt && !user.isFounder && (
              <Badge tone="green">Active</Badge>
            )}
          </div>
        </TD>
        <TD className="text-right">
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setOpen((v) => !v)}>
            <Settings2 className="h-3.5 w-3.5" /> {open ? "Close" : "Manage"}
          </Button>
        </TD>
      </TR>

      {open && (
        <TR className="bg-muted/20 hover:bg-muted/20">
          <TD colSpan={5} className="py-4">
            <div className="space-y-4">
              {reasonRequired && (
                <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <Label htmlFor={`reason-${user.id}`} className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Reason (required to change a founder)
                  </Label>
                  <Input
                    id={`reason-${user.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Recorded in the audit log"
                    className="bg-card"
                  />
                </div>
              )}

              {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

              {/* Role */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Role</span>
                <Select value={roleDraft} onChange={(e) => setRoleDraft(e.target.value as PlatformRole)} disabled={busy} className="h-8 w-56 text-xs">
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
                <Button variant="secondary" size="sm" disabled={busy || !reasonOk || roleDraft === user.role} onClick={() => act({ action: "set_role", role: roleDraft })}>
                  Apply role
                </Button>
              </div>

              {/* Access */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Access</span>
                {user.isActive ? (
                  <Button variant="outline" size="sm" disabled={busy || !reasonOk || isSelf} title={isSelf ? "You cannot deactivate your own account." : undefined} onClick={() => act({ action: "deactivate" })}>
                    <Pause className="h-3.5 w-3.5" /> Deactivate
                  </Button>
                ) : (
                  <Button variant="success" size="sm" disabled={busy || !reasonOk} onClick={() => act({ action: "activate" })}>
                    <Play className="h-3.5 w-3.5" /> Activate
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy || !reasonOk} onClick={() => act({ action: "force_logout" })}>
                  <LogOut className="h-3.5 w-3.5" /> Force logout
                </Button>
              </div>

              {/* Scope */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Scope</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={readOnlyDraft}
                    disabled={busy}
                    onChange={(e) => setReadOnlyDraft(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                  />
                  Read-only
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Access until</span>
                  <Input
                    type="datetime-local"
                    value={expiryDraft}
                    disabled={busy}
                    onChange={(e) => setExpiryDraft(e.target.value)}
                    className="h-8 w-52 text-xs"
                    aria-label="Access expiry"
                  />
                  {expiryDraft && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px]" disabled={busy} onClick={() => setExpiryDraft("")}>
                      Clear
                    </Button>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !reasonOk}
                  onClick={() => act({ action: "set_scope", readOnly: readOnlyDraft, accessExpiresAt: expiryDraft ? new Date(expiryDraft).toISOString() : null })}
                >
                  Apply scope
                </Button>
              </div>

              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </TD>
        </TR>
      )}
    </>
  );
}
