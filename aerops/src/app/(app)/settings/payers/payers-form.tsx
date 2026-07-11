"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

// Payer types mirror the PayerType enum (schema) with human labels.
const PAYER_TYPES = [
  ["PARENT", "Parent"],
  ["GUARDIAN", "Guardian"],
  ["EMPLOYER", "Employer"],
  ["SCHOLARSHIP_SPONSOR", "Scholarship sponsor"],
  ["UNIVERSITY", "University"],
  ["CLUB_SPONSOR", "Club sponsor"],
  ["OTHER", "Other"],
] as const;

export function CreatePayerForm({ students }: { students: { id: string; name: string }[] }) {
  const router = useRouter();
  const [payerType, setPayerType] = useState("PARENT");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(null);
    const res = await fetch("/api/revenue/payers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payerType,
        displayName,
        email,
        companyName: companyName || undefined,
        studentId: studentId || undefined,
        isDefault: studentId ? isDefault : undefined,
      }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) {
      setError(typeof j.error === "string" ? j.error : "Could not create the payer.");
      return;
    }
    setToken(j.inviteToken);
    setDisplayName("");
    setEmail("");
    setCompanyName("");
    setStudentId("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Payer type</Label>
          <Select value={payerType} onChange={(e) => setPayerType(e.target.value)}>
            {PAYER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jordan Nguyen" required />
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" required />
        </div>
        <div className="space-y-1">
          <Label>Company (optional)</Label>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Aviation LLC" />
        </div>
        <div className="space-y-1">
          <Label>Link to student (optional)</Label>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">— No link —</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="flex items-end">
          {studentId && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-3.5 w-3.5" />
              Set as this student&apos;s default payer
            </label>
          )}
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create payer
          </Button>
        </div>
      </form>

      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      {token && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/50 p-3">
          <p className="text-xs font-medium">Invite token — shown once. Share it securely with the payer.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 text-[11px]">{token}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(token); setCopied(true); }}>
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
