"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

const ROLES = [
  ["STUDENT", "Student"],
  ["INSTRUCTOR", "Instructor"],
  ["DISPATCHER", "Dispatcher"],
  ["MAINTENANCE", "Maintenance"],
  ["ACCOUNTANT", "Accountant"],
  ["SCHOOL_ADMIN", "School Administrator"],
] as const;

export function InviteUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STUDENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) {
      setError(typeof j.error === "string" ? j.error : "Could not create the invitation.");
    } else {
      setInviteUrl(`${window.location.origin}${j.inviteUrl}`);
      setEmail("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new.member@school.com" required />
        </div>
        <div className="space-y-1">
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
            {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite
        </Button>
      </form>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      {inviteUrl && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
          <code className="min-w-0 flex-1 truncate text-[11px]">{inviteUrl}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); }}>
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} Copy link
          </Button>
        </div>
      )}
    </div>
  );
}
