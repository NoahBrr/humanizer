"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, ChevronDown } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav-config";

/**
 * Desktop sidebar. Two independent collapse behaviors:
 *
 *  1. Rail collapse (`railCollapsed`) — the whole sidebar shrinks to an icon
 *     rail. Persisted via localStorage `aerops-sidebar` and applied pre-paint
 *     by the root layout script (`html[data-sidebar="collapsed"]`).
 *  2. Category collapse (`hiddenGroups`) — each domain section
 *     (Command Center, Flight Operations, …) can be folded to just its
 *     heading. Persisted via localStorage `aerops-sidebar-groups`. The
 *     section containing the current page auto-opens on navigation. Category
 *     collapse only applies in the expanded rail; in the icon rail every
 *     destination shows as an icon.
 *
 * Hydration safety: the server and the client's first render use the SAME
 * defaults — rail expanded, all categories open — and nothing reads
 * `document`/`localStorage` during render. Persisted preferences are applied
 * only after mount, so the SSR tree and the first client tree always match;
 * the pre-paint CSS covers the rail state so there is no flash.
 */
export function Sidebar({ allowedPaths, orgName }: { allowedPaths: string[]; orgName: string }) {
  const pathname = usePathname();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());

  const allowed = new Set(allowedPaths);
  const groups = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => allowed.has(i.href)) })).filter(
    (g) => g.items.length > 0,
  );

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(href + "/"),
    [pathname],
  );
  const activeGroup = groups.find((g) => g.items.some((i) => isActive(i.href)))?.label;

  // Read persisted preferences only after mount — never during render.
  useEffect(() => {
    setRailCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    try {
      const raw = localStorage.getItem("aerops-sidebar-groups");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setHiddenGroups(new Set(arr.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* ignore corrupt preference */
    }
  }, []);

  // The section holding the current page always opens on navigation.
  useEffect(() => {
    if (!activeGroup) return;
    setHiddenGroups((prev) => {
      if (!prev.has(activeGroup)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  const setRail = useCallback((next: boolean) => {
    setRailCollapsed(next);
    if (next) {
      document.documentElement.dataset.sidebar = "collapsed";
      localStorage.setItem("aerops-sidebar", "collapsed");
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.removeItem("aerops-sidebar");
    }
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem("aerops-sidebar-groups", JSON.stringify([...next]));
      } catch {
        /* ignore write failure */
      }
      return next;
    });
  }, []);

  // Keyboard shortcut: `[` toggles the rail (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      setRail(document.documentElement.dataset.sidebar !== "collapsed");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setRail]);

  return (
    <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex">
      {/* Edge handle — pinned to the border, always visible, so the rail is
          always one obvious click from reopening. */}
      <button
        onClick={() => setRail(!railCollapsed)}
        aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={`${railCollapsed ? "Expand" : "Collapse"} sidebar  ( [ )`}
        className="absolute -right-3 top-16 z-40 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
      >
        {railCollapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      <div className={cn("flex h-14 items-center gap-2.5 px-5", railCollapsed && "justify-center px-0")}>
        <button
          onClick={() => railCollapsed && setRail(false)}
          title={railCollapsed ? "Expand sidebar" : undefined}
          className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white p-0.5 shadow-sm", railCollapsed && "cursor-pointer")}
          aria-label={railCollapsed ? "Expand sidebar" : "AeroOps"}
        >
          <AeroOpsMark className="h-full w-full" />
        </button>
        <div className="sidebar-label min-w-0 leading-tight">
          <p className="text-[13px] font-bold tracking-[0.06em] text-white">
            AERO<span className="text-brand-sky">OPS</span>
          </p>
          <p className="truncate text-[10px] text-sidebar-foreground/60">{orgName}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group) => {
          const open = railCollapsed || !hiddenGroups.has(group.label);
          return (
            <div key={group.label} className="pt-2 first:pt-0.5">
              {/* Heading is a toggle in the expanded rail; hidden in the icon
                  rail (the group spacing keeps the icon clusters separated). */}
              <div className="sidebar-label">
                <button
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={open}
                  className="group/head flex w-full items-center justify-between rounded-md px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground/70"
                >
                  <span>{group.label}</span>
                  <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-200", !open && "-rotate-90")} />
                </button>
              </div>
              {open && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={railCollapsed ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                          railCollapsed && "justify-center px-0",
                          active ? "bg-white/10 text-white" : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-sky" />}
                        <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} />
                        <span className="sidebar-label">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — a single clean collapse control (label hides in the icon rail). */}
      <div className="border-t border-white/5 p-3">
        <button
          onClick={() => setRail(!railCollapsed)}
          aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={`${railCollapsed ? "Expand" : "Collapse"} sidebar  ( [ )`}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-white/5 hover:text-white",
            railCollapsed && "justify-center px-0",
          )}
        >
          {railCollapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
          <span className="sidebar-label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}
