"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Client-controlled section visibility for the server-rendered dashboard.
 *
 * The server renders every section as an RSC node and passes it in a stable
 * order; this component only decides which nodes to render, plus the
 * "Customize" popover. Preferences persist to localStorage under
 * `aerops-dashboard-layout` (sectionKey → boolean).
 *
 * Hydration safety: the initial state is the DEFAULT set (all sections on),
 * identical on the server and the first client render. Saved preferences are
 * merged in only AFTER mount (useEffect) — localStorage is never read during
 * render, so SSR and first paint always match.
 */

/** A card inside a grouped section (e.g. one of the Needs-Attention cards). */
export type DashboardSectionChild = {
  key: string;
  label: string;
  node: React.ReactNode;
  /** false → always shown with its group, no toggle in the popover. */
  toggleable?: boolean;
};

export type DashboardSection = {
  key: string;
  label: string;
  /** Simple section: rendered as-is when visible. */
  node?: React.ReactNode;
  /** Grouped section: a heading plus a grid of individually-toggleable cards. */
  children?: DashboardSectionChild[];
  gridClassName?: string;
};

const STORAGE_KEY = "aerops-dashboard-layout";

function sectionKeys(sections: DashboardSection[]): string[] {
  const keys: string[] = [];
  for (const s of sections) {
    keys.push(s.key);
    for (const c of s.children ?? []) if (c.toggleable !== false) keys.push(c.key);
  }
  return keys;
}

function defaultVisibility(sections: DashboardSection[]): Record<string, boolean> {
  return Object.fromEntries(sectionKeys(sections).map((k) => [k, true]));
}

export function CustomizableDashboard({
  greeting,
  pinned,
  sections,
}: {
  greeting: React.ReactNode;
  pinned?: React.ReactNode;
  sections: DashboardSection[];
}) {
  // Default (all-on) on both server and first client render — hydration-safe.
  const [visible, setVisible] = useState<Record<string, boolean>>(() => defaultVisibility(sections));
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Apply saved preferences only after mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      setVisible((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(prev)) if (typeof saved[k] === "boolean") next[k] = saved[k] as boolean;
        return next;
      });
    } catch {
      // Ignore corrupt/legacy preferences and keep the default set.
    }
  }, []);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setKey(key: string, value: boolean) {
    setVisible((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode / quota) — in-memory state still applies.
      }
      return next;
    });
  }

  function reset() {
    setVisible(defaultVisibility(sections));
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  const isOn = (key: string) => visible[key] !== false;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {greeting}
        <div className="relative" ref={popoverRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Customize
          </Button>
          {open && (
            <div
              role="menu"
              aria-label="Customize dashboard sections"
              className="absolute right-0 top-11 z-30 w-64 animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-xs font-semibold">Sections</span>
                <button
                  onClick={reset}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
              <div className="max-h-[70vh] space-y-0.5 overflow-y-auto p-1.5">
                {sections.map((s) => (
                  <div key={s.key}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={isOn(s.key)}
                        onChange={(e) => setKey(s.key, e.target.checked)}
                        className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                      />
                      {s.label}
                    </label>
                    {s.children
                      ?.filter((c) => c.toggleable !== false)
                      .map((c) => (
                        <label
                          key={c.key}
                          className="ml-5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                        >
                          <input
                            type="checkbox"
                            checked={isOn(c.key)}
                            disabled={!isOn(s.key)}
                            onChange={(e) => setKey(c.key, e.target.checked)}
                            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                          />
                          {c.label}
                        </label>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {pinned}

      {sections.map((s) => {
        if (!isOn(s.key)) return null;

        if (s.children) {
          const shown = s.children.filter((c) => c.toggleable === false || isOn(c.key));
          if (shown.length === 0) return null;
          return (
            <section key={s.key}>
              <h2 className="mb-3 text-sm font-semibold tracking-tight text-brand-navy dark:text-foreground">{s.label}</h2>
              <div className={s.gridClassName ?? "grid grid-cols-1 gap-4"}>
                {shown.map((c) => (
                  <div key={c.key}>{c.node}</div>
                ))}
              </div>
            </section>
          );
        }

        return <div key={s.key}>{s.node}</div>;
      })}
    </div>
  );
}
