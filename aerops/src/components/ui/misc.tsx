import * as React from "react";
import { cn, initials } from "@/lib/utils";

export function Avatar({ first, last, className }: { first?: string | null; last?: string | null; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground",
        className,
      )}
    >
      {initials(first, last)}
    </div>
  );
}

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: "primary" | "success" | "warning" }) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

/**
 * Canonical empty state: never "No data". Always says what's missing, why,
 * and offers the next step (optional `action`). See DESIGN_SYSTEM.md.
 */
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Standard page header. `eyebrow` is the marketing-style uppercase-tracked
 * kicker (opt-in; default pages render exactly as before). The title carries
 * the marketing heading treatment (brand-navy, tracking-tight) so the app and
 * the public site read as one brand in operator mode.
 */
export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-royal dark:text-brand-sky">{eyebrow}</p>
        )}
        <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-brand-navy dark:text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
