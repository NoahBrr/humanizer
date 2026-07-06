"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlatformNavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 px-3 py-3">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-violet-600/20 text-white" : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PlatformSignOut({ name }: { name: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/sign-in" })}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-sidebar-foreground/60 hover:bg-white/5 hover:text-white"
    >
      <LogOut className="h-3.5 w-3.5" /> {name} — sign out
    </button>
  );
}
