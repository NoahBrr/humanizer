"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";

export function Sidebar({ allowedPaths, orgName }: { allowedPaths: string[]; orgName: string }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Plane className="h-4 w-4 -rotate-45" />
        </div>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold tracking-tight text-white">AeroOps</p>
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
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <item.icon className={cn("h-4 w-4", active ? "text-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[10px] text-sidebar-foreground/40">
        AeroOps · Aviation Academy OS
      </div>
    </aside>
  );
}
