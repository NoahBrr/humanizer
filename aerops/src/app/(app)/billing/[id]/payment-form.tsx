"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function PaymentForm({ invoiceId, amountDue }: { invoiceId: string; amountDue: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(amountDue.toFixed(2));
  const [method, setMethod] = useState("CARD");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), method, reference: reference || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Payment failed.");
    } else {
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Record Payment</CardTitle>
        <CardDescription>In production this connects to Stripe; here it records a manual payment and posts to the student ledger.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Amount</Label><Input type="number" step="0.01" min="0.01" max={amountDue} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" /></div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-40">
              <option value="CARD">Card (Stripe)</option>
              <option value="ACH">ACH</option>
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
              <option value="ACCOUNT_CREDIT">Account credit</option>
              <option value="GIFT_CERTIFICATE">Gift certificate</option>
            </Select>
          </div>
          <div className="flex-1 space-y-1"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #, Stripe id…" /></div>
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Apply payment</Button>
        </form>
        {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
