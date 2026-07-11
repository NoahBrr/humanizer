"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Plus, ShieldCheck, ShieldAlert, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Skeleton } from "@/components/ui/misc";

type Method = {
  id: string;
  type: string;
  status: string;
  isDefault: boolean;
  display: string;
  consentValid: boolean;
};

/**
 * Payer payment-methods manager. Lists saved methods (safe metadata only),
 * adds a DEV method via the foundation stub, sets a default, detaches a method,
 * and revokes off-session charging consent. All state comes from the scoped
 * /api/payer/* endpoints — this component never sees a PAN, token, or secret.
 */
export function PayerMethods() {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // action key in flight

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/payer/payment-methods");
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not load payment methods.");
      setMethods(j.methods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payment methods.");
      setMethods([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(key: string, req: () => Promise<Response>, fail: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await req();
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : fail);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : fail);
    } finally {
      setBusy(null);
    }
  }

  const addMethod = () =>
    act("add", () => fetch("/api/payer/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodType: "card" }),
    }), "Could not add the payment method.");

  const setDefault = (id: string) =>
    act(`default:${id}`, () => fetch("/api/payer/payment-methods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodId: id }),
    }), "Could not set the default method.");

  const detach = (id: string) =>
    act(`detach:${id}`, () => fetch(`/api/payer/payment-methods?methodId=${encodeURIComponent(id)}`, { method: "DELETE" }), "Could not detach the method.");

  const revokeConsent = (id: string) =>
    act(`consent:${id}`, () => fetch(`/api/payer/consent?methodId=${encodeURIComponent(id)}`, { method: "DELETE" }), "Could not revoke authorization.");

  const active = (methods ?? []).filter((m) => m.status !== "DETACHED");

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Payment methods</CardTitle>
          <CardDescription>Saved methods for approved flight charges. Development fixtures — no real card is stored.</CardDescription>
        </div>
        <Button size="sm" onClick={addMethod} disabled={busy === "add"}>
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add method
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}

        {methods === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="h-5 w-5" />}
            title="No payment methods yet"
            description="Add a method so approved flight charges can be collected. This foundation build adds a test card."
          />
        ) : (
          active.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {m.display}
                    {m.isDefault && <Badge tone="blue"><Star className="h-3 w-3" /> Default</Badge>}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {m.consentValid ? (
                      <><ShieldCheck className="h-3 w-3 text-success" /> Charging authorized</>
                    ) : (
                      <><ShieldAlert className="h-3 w-3 text-amber-600" /> No current authorization</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {!m.isDefault && (
                  <Button variant="outline" size="sm" onClick={() => setDefault(m.id)} disabled={!!busy}>
                    {busy === `default:${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />} Make default
                  </Button>
                )}
                {m.consentValid && (
                  <Button variant="ghost" size="sm" onClick={() => revokeConsent(m.id)} disabled={!!busy}>
                    {busy === `consent:${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />} Revoke
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => detach(m.id)} disabled={!!busy} aria-label="Detach method">
                  {busy === `detach:${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
