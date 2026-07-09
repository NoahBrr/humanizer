"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, NAV_GROUPS } from "./nav-config";

/**
 * Phone/tablet navigation: the four most-used destinations pinned to a bottom
 * bar (large touch targets), everything else behind a "More" sheet grouped by
 * the same domain sections as the desktop sidebar. Hidden at the lg breakpoint
 * where the sidebar takes over.
 */
export function MobileNav({ allowedPaths }: { allowedPaths: string[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const allowed = new Set(allowedPaths);
  const items = NAV_ITEMS.filter((i) => allowed.has(i.href));
  const pinned = items.slice(0, 4);
  const overflowHrefs = new Set(items.slice(4).map((i) => i.href));
  // The "More" sheet mirrors the sidebar's grouping, showing only the
  // destinations that aren't pinned to the bottom bar.
  const overflowGroups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => overflowHrefs.has(i.href)),
  })).filter((g) => g.items.length > 0);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const overflowActive = [...overflowHrefs].some((href) => isActive(href));

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 animate-fade-up rounded-t-2xl border-t border-border bg-card pb-[calc(4.5rem+env(safe-area-inset-bottom))]"
            role="dialog"
            aria-label="More navigation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <p className="text-sm font-semibold">Navigate</p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close menu" className="rounded-lg p-2 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto px-3 pb-3">
              {overflowGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70">{group.label}</p>
                  <div className="grid grid-cols-3 gap-1">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl text-xs font-medium",
                          isActive(item.href) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {pinned.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
              isActive(item.href) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
        {overflowHrefs.size > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More navigation options"
            className={cn(
              "flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
              overflowActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        )}
      </nav>
    </>
  );
}
