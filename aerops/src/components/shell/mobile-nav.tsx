"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";

/**
 * Phone/tablet navigation: the four most-used destinations pinned to a bottom
 * bar (large touch targets), everything else behind a "More" sheet. Hidden at
 * the lg breakpoint where the sidebar takes over.
 */
export function MobileNav({ allowedPaths }: { allowedPaths: string[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = NAV_ITEMS.filter((i) => allowedPaths.includes(i.href));
  const pinned = items.slice(0, 4);
  const overflow = items.slice(4);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const overflowActive = overflow.some((i) => isActive(i.href));

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
            <div className="flex items-center justify-between px-5 pt-4 pb-1">
              <p className="text-sm font-semibold">More</p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close menu" className="rounded-lg p-2 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 p-3">
              {overflow.map((item) => (
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
        {overflow.length > 0 && (
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
