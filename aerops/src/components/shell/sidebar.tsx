"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav-config";

/**
 * Desktop sidebar. Navigation is grouped by domain (Command Center, Flight
 * Operations, Training, Business, Organization) so the rail scans as short
 * lists rather than one long column.
 *
 * Collapse can never get stuck closed: the expand affordance is pinned to the
 * edge (always visible), the logo re-expands when collapsed, and `[` toggles
 * from anywhere. The preference persists per browser via localStorage
 * (`aerops-sidebar`) and is applied pre-paint by the root layout's init script
 * (which sets `html[data-sidebar="collapsed"]`, driving the collapse CSS).
 *
 * Hydration safety: the server and the client's first render BOTH use
 * `collapsed=false` — nothing reads `document`/`localStorage` during render.
 * The persisted preference is read only after mount (in an effect), so the
 * server HTML and the client's initial tree always match; the pre-paint CSS
 * handles the visual state in the meantime so there is no flash.
 */
export function Sidebar({ allowedPaths, orgName }: { allowedPaths: string[]; orgName: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const allowed = new Set(allowedPaths);
  const groups = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => allowed.has(i.href)) })).filter(
    (g) => g.items.length > 0,
  );

  // Read the persisted preference only after mount — never during render.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  const setState = useCallback((next: boolean) => {
    setCollapsed(next);
    if (next) {
      document.documentElement.dataset.sidebar = "collapsed";
      localStorage.setItem("aerops-sidebar", "collapsed");
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.removeItem("aerops-sidebar");
    }
  }, []);

  // Keyboard shortcut: `[` toggles the sidebar (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      setState(document.documentElement.dataset.sidebar !== "collapsed");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setState]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex">
      {/* Edge handle — pinned to the sidebar border, always visible, so the
          sidebar is always one obvious click from reopening. */}
      <button
        onClick={() => setState(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={`${collapsed ? "Expand" : "Collapse"} sidebar  ( [ )`}
        className="absolute -right-3 top-16 z-40 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      <div className={cn("flex h-14 items-center gap-2.5 px-5", collapsed && "justify-center px-0")}>
        <button
          onClick={() => collapsed && setState(false)}
          title={collapsed ? "Expand sidebar" : undefined}
          className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white p-0.5 shadow-sm", collapsed && "cursor-pointer")}
          aria-label={collapsed ? "Expand sidebar" : "AeroOps"}
        >
          <AeroOpsMark className="h-full w-full" />
        </button>
        <div className="sidebar-label leading-tight">
          <p className="text-[13px] font-bold tracking-[0.06em] text-white">
            AERO<span className="text-brand-sky">OPS</span>
          </p>
          <p className="max-w-36 truncate text-[10px] text-sidebar-foreground/60">{orgName}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.label} className="pt-3 first:pt-1">
            {/* Group heading hides on collapse (via .sidebar-label); the top
                padding keeps the icon clusters visually separated. */}
            <p className="sidebar-label px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/40">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active ? "bg-white/10 text-white" : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {/* Left accent for the active item — clean, premium, and
                        visible even when the sidebar is collapsed to icons. */}
                    {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-sky" />}
                    <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} />
                    <span className="sidebar-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn("flex items-center justify-between px-5 py-4", collapsed && "justify-center px-0")}>
        <p className="sidebar-label text-[10px] text-sidebar-foreground/40">AeroOps · The Operating System for Aviation</p>
        <button
          onClick={() => setState(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar  ( [ )`}
          className="cursor-pointer rounded-lg p-1.5 text-sidebar-foreground/50 hover:bg-white/5 hover:text-white"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
