"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/features", label: "Product" },
  { href: "/solutions/flight-schools", label: "Solutions" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ authedHref }: { authedHref: string | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="AeroOps home">
          <AeroOpsMark className="h-8 w-8" />
          <span className="text-[15px] font-bold tracking-[0.07em]">
            <span className="text-brand-navy dark:text-foreground">AERO</span><span className="text-brand-sky">OPS</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {authedHref ? (
            <Link href={authedHref} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
              Open AeroOps
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Log In</Link>
              <Link href="/sign-up" className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted">Create Account</Link>
              <Link href="/demo" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                Request a Demo
              </Link>
            </>
          )}
        </div>

        <button className="print-hidden ml-auto cursor-pointer rounded-lg p-2 hover:bg-muted md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div className={cn("border-t border-border bg-background md:hidden", mobileOpen ? "block" : "hidden")}>
        <nav className="space-y-1 p-3">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>
              {item.label}
            </Link>
          ))}
          <div className="flex gap-2 px-3 pt-3">
            {authedHref ? (
              <Link href={authedHref} className="flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">Open AeroOps</Link>
            ) : (
              <>
                <Link href="/sign-in" className="flex h-10 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium">Log In</Link>
                <Link href="/demo" className="flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">Request a Demo</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
