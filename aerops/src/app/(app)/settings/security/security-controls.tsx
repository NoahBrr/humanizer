"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, KeyRound, MonitorOff, Loader2, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/utils";

/** Self-service security controls: MFA enrollment, password change, logout-all. */
export function SecurityControls({ mfaEnabled }: { mfaEnabled: boolean }) {
  const router = useRouter();
  const [enroll, setEnroll] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  async function startEnroll() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/security/mfa", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setEnroll(await res.json());
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg({ kind: "err", text: apiErrorMessage(j.error, "Could not start MFA enrollment. Please try again.") });
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/security/mfa", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await res.json();
    setBusy(false);
    if (res.ok) {
      setEnroll(null);
      setCode("");
      setMsg({ kind: "ok", text: "Two-factor authentication is now enabled. You'll be asked for a code at sign-in." });
      router.refresh();
    } else {
      setMsg({ kind: "err", text: j.error ?? "Verification failed." });
    }
  }

  async function disableMfa() {
    const current = window.prompt("Enter a current authenticator code to disable MFA:");
    if (!current) return;
    setBusy(true);
    const res = await fetch("/api/security/mfa", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: current }) });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? { kind: "ok", text: "MFA disabled." } : { kind: "err", text: j.error ?? "Could not disable MFA." });
    router.refresh();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/security/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.ok) {
      window.location.href = "/sign-in"; // all sessions (incl. this one) were revoked
    } else {
      setMsg({ kind: "err", text: j.error ?? "Password change failed." });
    }
  }

  async function logoutAll() {
    if (!window.confirm("Sign out of every device, including this one?")) return;
    await fetch("/api/security/sessions", { method: "DELETE" });
    window.location.href = "/sign-in";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Account Protection</CardTitle>
        <CardDescription>These controls apply to your own account. Demo passwords predate the 12-character policy; new passwords must meet it.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5" /> Two-factor authentication</p>
          {!mfaEnabled && !enroll && (
            <Button size="sm" onClick={startEnroll} disabled={busy}>Enable MFA</Button>
          )}
          {enroll && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Add this secret to your authenticator app (Google Authenticator, 1Password, Authy…), then confirm with a code:
              </p>
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 p-2">
                <code className="min-w-0 flex-1 break-all text-[11px]">{enroll.secret}</code>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(enroll.secret); setCopied(true); }}>
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" className="h-8 w-28 text-xs" />
                <Button size="sm" onClick={confirmEnroll} disabled={busy || code.length < 6}>Verify</Button>
              </div>
            </div>
          )}
          {mfaEnabled && (
            <div className="space-y-2">
              <p className="text-[11px] text-success">✓ Enabled — codes required at sign-in.</p>
              <Button size="sm" variant="outline" onClick={disableMfa} disabled={busy}>Disable…</Button>
            </div>
          )}
        </div>

        <form onSubmit={changePassword} className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><KeyRound className="h-3.5 w-3.5" /> Change password</p>
          <div className="space-y-1"><Label>Current</Label><Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="h-8 text-xs" required /></div>
          <div className="space-y-1"><Label>New (12+ chars, mixed)</Label><Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="h-8 text-xs" minLength={12} required /></div>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Update password
          </Button>
          <p className="text-[10px] text-muted-foreground">Changing your password signs you out everywhere.</p>
        </form>

        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><MonitorOff className="h-3.5 w-3.5" /> Sessions</p>
          <p className="text-[11px] text-muted-foreground">Lost a device or shared a computer? Revoke every active session for your account.</p>
          <Button size="sm" variant="destructive" onClick={logoutAll}>Log out all devices</Button>
        </div>

        {msg && (
          <p className={`lg:col-span-3 text-xs font-medium ${msg.kind === "ok" ? "text-success" : "text-destructive"}`}>{msg.text}</p>
        )}
      </CardContent>
    </Card>
  );
}
