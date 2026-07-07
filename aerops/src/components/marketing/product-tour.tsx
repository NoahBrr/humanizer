"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { PRODUCT_TOUR } from "./tour-data";
import { cn } from "@/lib/utils";

/**
 * Interactive workspace tour: a tab rail of every major AeroOps workspace
 * driving one large live screenshot. Keyboard- and touch-friendly.
 */
export function ProductTour() {
  const [index, setIndex] = useState(0);
  const stop = PRODUCT_TOUR[index];

  const go = (d: number) => setIndex((i) => (i + d + PRODUCT_TOUR.length) % PRODUCT_TOUR.length);

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {PRODUCT_TOUR.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setIndex(i)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              i === index
                ? "border-brand-royal bg-brand-royal text-white dark:border-brand-sky dark:bg-brand-sky dark:text-brand-navy"
                : "border-border bg-card text-muted-foreground hover:border-brand-royal/40 hover:text-foreground",
            )}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-[0_20px_60px_-25px_rgb(11_36_71/0.4)]">
        <div className="flex h-8 items-center gap-1.5 border-b border-border bg-muted/60 px-3.5">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="ml-3 text-[10px] text-muted-foreground">aerops.io — {stop.title}</span>
        </div>
        <Image key={stop.key} src={stop.image} alt={`AeroOps ${stop.title}`} width={1400} height={875} quality={90} className="w-full animate-fade-up" />
        <button onClick={() => go(-1)} aria-label="Previous workspace" className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-md hover:bg-card">
          <ChevronLeft className="h-4.5 w-4.5" />
        </button>
        <button onClick={() => go(1)} aria-label="Next workspace" className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-md hover:bg-card">
          <ChevronRight className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-base font-semibold text-brand-navy dark:text-foreground">{stop.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{stop.description}</p>
        </div>
        <Link href={stop.href} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted">
          View feature <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
