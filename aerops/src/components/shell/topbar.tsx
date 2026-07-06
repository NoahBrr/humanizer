"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, LogOut, Search } from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar } from "@/components/ui/misc";
import { ThemeToggle } from "./theme-toggle";

type TopbarNotification = { id: string; title: string; body: string | null; createdAt: string };

export function Topbar({
  firstName, lastName, roleLabel, unreadCount, recent,
}: {
  firstName: string; lastName: string; roleLabel: string; unreadCount: number; recent: TopbarNotification[];
}) {
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        className="hidden h-8 w-64 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
      </button>
      <div className="flex-1" />
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
      <div className="relative">
        <button
          onClick={() => { setMenuOpen(!menuOpen); setBellOpen(false); }}
          aria-label="Account menu"
          aria-expanded={menuOpen}
          className="flex cursor-pointer items-center gap-2 rounded-lg p-1 hover:bg-muted"
        >
          <Avatar first={firstName} last={lastName} />
          <div className="hidden text-left leading-tight md:block">
            <p className="text-xs font-medium">{firstName} {lastName}</p>
            <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
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
