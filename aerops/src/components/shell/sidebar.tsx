"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";

/**
 * Desktop sidebar with a collapse mode that can never get stuck closed:
 * the expand affordance is pinned to the sidebar's edge (always visible),
 * the logo itself expands when collapsed, and the `[` keyboard shortcut
 * toggles from anywhere. The preference persists per browser via
 * localStorage (`aerops-sidebar`), applied pre-paint by the root layout's
 * theme script to avoid a flash.
 */
export function Sidebar({ allowedPaths, orgName }: { allowedPaths: string[]; orgName: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href));

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
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                collapsed && "justify-center px-0",
                active ? "bg-white/10 text-white" : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} />
              <span className="sidebar-label">{item.label}</span>
            </Link>
          );
        })}
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
