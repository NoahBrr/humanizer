"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MapPin, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { TIME_ZONES } from "@/lib/timezones";
import { apiErrorMessage } from "@/lib/utils";

type Location = { id: string; name: string; icao: string | null; timeZone: string; isActive: boolean };

const SAVE_FALLBACK = "Could not save this location. Please review the fields and try again.";
const DEFAULT_TZ = "America/New_York";

export function LocationsManager({ locations }: { locations: Location[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Your Locations</CardTitle>
          <CardDescription>Inactive locations stay on record but are hidden from booking and dispatch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {locations.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-6 w-6" />}
              title="No locations yet"
              description="Add the airport or base your organization flies from to unlock scheduling, weather, and dispatch."
            />
          ) : (
            locations.map((loc) => <LocationRow key={loc.id} location={loc} />)
          )}
        </CardContent>
      </Card>
      <AddLocation />
    </div>
  );
}

function LocationRow({ location }: { location: Location }) {
  const router = useRouter();
  const [name, setName] = useState(location.name);
  const [icao, setIcao] = useState(location.icao ?? "");
  const [timeZone, setTimeZone] = useState(location.timeZone);
  const [isActive, setIsActive] = useState(location.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/organization/locations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: location.id, name: name.trim(), icao: icao.trim() || null, timeZone, isActive }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(apiErrorMessage(j.error, SAVE_FALLBACK));
    }
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={120} required />
        </div>
        <div className="w-28 space-y-1">
          <Label>ICAO</Label>
          <Input value={icao} onChange={(e) => { setIcao(e.target.value.toUpperCase()); setSaved(false); }} maxLength={8} placeholder="ICAO code" className="font-mono uppercase" />
        </div>
        <div className="w-52 space-y-1">
          <Label>Time zone</Label>
          <Select value={timeZone} onChange={(e) => { setTimeZone(e.target.value); setSaved(false); }}>
            {TIME_ZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={isActive} onChange={(e) => { setIsActive(e.target.checked); setSaved(false); }} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
          Active
          <Badge tone={isActive ? "green" : "gray"}>{isActive ? "In service" : "Hidden"}</Badge>
        </label>
        <div className="flex items-center gap-3">
          {saved && <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Saved</span>}
          <Button type="submit" size="sm" variant="outline" disabled={busy || name.trim().length === 0}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </div>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </form>
  );
}

function AddLocation() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [icao, setIcao] = useState("");
  const [timeZone, setTimeZone] = useState(DEFAULT_TZ);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/organization/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), icao: icao.trim() || null, timeZone, isActive: true }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setIcao("");
      setTimeZone(DEFAULT_TZ);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(apiErrorMessage(j.error, SAVE_FALLBACK));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Add location</CardTitle>
        <CardDescription>New locations are active by default and immediately available for scheduling.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Palo Alto Airport" required />
          </div>
          <div className="w-28 space-y-1">
            <Label>ICAO</Label>
            <Input value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase())} maxLength={8} placeholder="ICAO code" className="font-mono uppercase" />
          </div>
          <div className="w-52 space-y-1">
            <Label>Time zone</Label>
            <Select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {TIME_ZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </Select>
          </div>
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </form>
        {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
