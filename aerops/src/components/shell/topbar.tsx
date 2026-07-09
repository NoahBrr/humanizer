"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Search, Plus, CloudSun, MapPin } from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar } from "@/components/ui/misc";
import { ThemeToggle } from "./theme-toggle";

type TopbarNotification = { id: string; title: string; body: string | null; createdAt: string };
type LocationOpt = { id: string; name: string; icao: string | null };
type TopbarWeather = { icao: string; category: "VFR" | "MVFR" | "IFR"; summary: string };

const WX_TONE: Record<TopbarWeather["category"], string> = { VFR: "text-success", MVFR: "text-warning", IFR: "text-destructive" };

export function Topbar({
  firstName, lastName, roleLabel, unreadCount, recent, locations = [], currentLocationId = "", weather = null,
}: {
  firstName: string; lastName: string; roleLabel: string; unreadCount: number; recent: TopbarNotification[];
  locations?: LocationOpt[]; currentLocationId?: string; weather?: TopbarWeather | null;
}) {
  const router = useRouter();
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function setLocation(id: string) {
    document.cookie = id
      ? `aerops-location=${id}; path=/; max-age=31536000; samesite=lax`
      : "aerops-location=; path=/; max-age=0";
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        className="hidden h-8 w-56 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
      </button>

      {locations.length > 1 && (
        <div className="hidden items-center gap-1 md:flex">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={currentLocationId}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Location"
            className="h-8 cursor-pointer rounded-lg border border-border bg-card px-2 text-xs font-medium shadow-sm"
          >
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.icao ?? l.name}</option>)}
          </select>
        </div>
      )}

      {weather && (
        <div
          className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm xl:flex"
          title="Weather for your active location. Live METAR/TAF feeds connect via the Aviation Weather API in production."
        >
          <CloudSun className="h-3.5 w-3.5 text-warning" />
          <span className={`font-semibold ${WX_TONE[weather.category]}`}>{weather.category}</span>
          <span>{weather.icao} · {weather.summary}</span>
        </div>
      )}

      <div className="flex-1" />

      <Link
        href="/schedule?new=1"
        aria-label="Quick add booking"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
      </Link>
      <ThemeToggle />
      <div className="relative">
        <button
          onClick={() => { setBellOpen(!bellOpen); setMenuOpen(false); }}
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg hover:bg-muted"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute right-0 top-11 w-80 animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border px-4 py-2.5 text-xs font-semibold">Notifications</div>
            <div className="max-h-80 overflow-y-auto">
              {recent.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">All caught up</p>}
              {recent.map((n) => (
                <div key={n.id} className="border-b border-border px-4 py-2.5 last:border-0">
                  <p className="text-xs font-medium">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{n.body}</p>}
                </div>
              ))}
            </div>
            <Link href="/notifications" onClick={() => setBellOpen(false)} className="block bg-muted/50 px-4 py-2 text-center text-xs font-medium text-primary hover:bg-muted">
              View all
            </Link>
          </div>
        )}
      </div>
      <div className="relative ml-1 border-l border-border pl-1.5">
        <button
          onClick={() => { setMenuOpen(!menuOpen); setBellOpen(false); }}
          aria-label="Account menu"
          aria-expanded={menuOpen}
          className="flex cursor-pointer items-center gap-2 rounded-lg p-1 hover:bg-muted"
        >
          <Avatar first={firstName} last={lastName} />
          <div className="hidden text-left leading-tight md:block">
            <p className="text-xs font-medium">{firstName} {lastName}</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{roleLabel}</p>
          </div>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-12 w-44 animate-fade-up overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl">
            <button
              onClick={() => signOut({ callbackUrl: "/sign-in" })}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-destructive hover:bg-muted"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
