"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { AeroOpsMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const SOLUTIONS = [
  { href: "/solutions/flight-schools", label: "Flight Schools" },
  { href: "/solutions/flying-clubs", label: "Flying Clubs" },
  { href: "/solutions/aircraft-rental", label: "Aircraft Rental" },
  { href: "/solutions/fbos", label: "FBOs" },
  { href: "/solutions/maintenance", label: "Maintenance" },
  { href: "/solutions/corporate-flight-departments", label: "Corporate Flight Departments" },
];

const NAV = [
  { href: "/features", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ authedHref }: { authedHref: string | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);

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
          <Link href="/features" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Product</Link>
          <div className="relative" onMouseEnter={() => setSolutionsOpen(true)} onMouseLeave={() => setSolutionsOpen(false)}>
            <button className="flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setSolutionsOpen(!solutionsOpen)}>
              Solutions <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {solutionsOpen && (
              <div className="absolute left-0 top-full w-64 rounded-xl border border-border bg-card p-1.5 shadow-xl">
                <Link href="/solutions" className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => setSolutionsOpen(false)}>
                  All solutions
                </Link>
                {SOLUTIONS.map((s) => (
                  <Link key={s.href} href={s.href} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setSolutionsOpen(false)}>
                    {s.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Pricing</Link>
          <Link href="/about" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">About</Link>
          <Link href="/contact" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Contact</Link>
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {authedHref ? (
            <Link href={authedHref} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
              Open AeroOps
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Sign in</Link>
              <Link href="/sign-up" className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted">Create account</Link>
              <Link href="/demo" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                Request a Demo
              </Link>
            </>
          )}
        </div>

        <button className="ml-auto cursor-pointer rounded-lg p-2 hover:bg-muted md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div className={cn("border-t border-border bg-background md:hidden", mobileOpen ? "block" : "hidden")}>
        <nav className="space-y-1 p-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>{n.label}</Link>
          ))}
          <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Solutions</p>
          {SOLUTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onClick={() => setMobileOpen(false)}>{s.label}</Link>
          ))}
          <div className="flex gap-2 px-3 pt-3">
            {authedHref ? (
              <Link href={authedHref} className="flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">Open AeroOps</Link>
            ) : (
              <>
                <Link href="/sign-in" className="flex h-10 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium">Sign in</Link>
                <Link href="/demo" className="flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">Request a Demo</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
