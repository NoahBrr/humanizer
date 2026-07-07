"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";

export function Sidebar({ allowedPaths, orgName }: { allowedPaths: string[]; orgName: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href));

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) {
      document.documentElement.dataset.sidebar = "collapsed";
      localStorage.setItem("aerops-sidebar", "collapsed");
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.removeItem("aerops-sidebar");
    }
  }

  return (
    <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground transition-[width] lg:flex">
      <div className={cn("flex h-14 items-center gap-2.5 px-5", collapsed && "justify-center px-0")}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white p-0.5 shadow-sm">
          <AeroOpsMark className="h-full w-full" />
        </div>
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
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="cursor-pointer rounded-lg p-1.5 text-sidebar-foreground/50 hover:bg-white/5 hover:text-white"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
