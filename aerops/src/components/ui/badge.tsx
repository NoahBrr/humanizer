import * as React from "react";
import { cn } from "@/lib/utils";
import { statusToneOf, type StatusTone } from "@/lib/status-colors";

type Tone = "default" | "blue" | "green" | "amber" | "red" | "violet" | "purple" | "cyan" | "gray" | "orange" | "darkred" | "black";

const tones: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  gray: "bg-muted text-muted-foreground",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  red: "bg-red-500/12 text-red-600 dark:text-red-400",
  darkred: "bg-red-900/15 text-red-900 dark:bg-red-900/40 dark:text-red-300",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  purple: "bg-violet-500/12 text-violet-700 dark:text-violet-400",
  cyan: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-400",
  black: "bg-gray-800/90 text-white dark:bg-gray-700",
};

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}

/** Canonical status → tone mapping lives in lib/status-colors.ts (Section 3). */
export function statusTone(status: string): StatusTone {
  return statusToneOf(status);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusToneOf(status)} className={className}>
      {status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
    </Badge>
  );
}
