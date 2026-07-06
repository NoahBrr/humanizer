import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "blue" | "green" | "amber" | "red" | "violet" | "cyan" | "gray";

const tones: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  gray: "bg-muted text-muted-foreground",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-red-500/12 text-red-600 dark:text-red-400",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  cyan: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400",
};

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}

/** Map common domain statuses to badge tones so every page renders them the same way. */
export function statusTone(status: string): Tone {
  const map: Record<string, Tone> = {
    AVAILABLE: "green", COMPLETED: "green", PAID: "green", RELEASED: "green", RESOLVED: "green", PASSED: "green", CLOSED: "gray",
    SCHEDULED: "blue", OPEN: "blue", DISPATCHED: "cyan", IN_FLIGHT: "violet", IN_PROGRESS: "amber", PENDING: "amber",
    PARTIALLY_PAID: "amber", DEFERRED: "amber", RESERVED: "amber", NEEDS_IMPROVEMENT: "amber",
    GROUNDED: "red", CANCELLED: "red", OVERDUE: "red", NO_SHOW: "red", FAILED: "red", GROUNDING: "red", VOID: "gray",
    IN_MAINTENANCE: "amber", WEATHER_CANCELLED: "gray", MAJOR: "amber", MINOR: "gray",
    EXCELLENT: "green", SATISFACTORY: "blue", INCOMPLETE: "gray", DRAFT: "gray", RETIRED: "gray", DISCONTINUED: "gray",
  };
  return map[status] ?? "default";
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
    </Badge>
  );
}
