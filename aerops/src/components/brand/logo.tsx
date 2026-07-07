import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AeroOps brand marks. Single source of truth for the logo — every surface
 * (sidebar, auth, platform portal, loading states, favicon source) renders
 * from these components / the SVGs in public/brand.
 *
 * variant:
 *  - "color"  gradient A + silver contrail + navy jet (works on light & dark)
 *  - "mono"   single currentColor rendering for embossing / print / favicons
 */
export type MarkVariant = "color" | "mono";

const GRADIENT_A = ["#0B2447", "#1E63D0", "#38A1E8"] as const;
const GRADIENT_SWOOSH = ["#8E99A8", "#D7DEE6"] as const;
const NAVY = "#0B2447";

/** Standalone "A" icon (square). */
export function AeroOpsMark({
  className,
  variant = "color",
  title = "AeroOps",
}: {
  className?: string;
  variant?: MarkVariant;
  title?: string;
}) {
  const id = React.useId().replace(/[:]/g, "");
  const mono = variant === "mono";
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label={title} className={className}>
      {!mono && (
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={GRADIENT_A[0]} />
            <stop offset="0.55" stopColor={GRADIENT_A[1]} />
            <stop offset="1" stopColor={GRADIENT_A[2]} />
          </linearGradient>
          <linearGradient id={`s${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={GRADIENT_SWOOSH[0]} />
            <stop offset="1" stopColor={GRADIENT_SWOOSH[1]} />
          </linearGradient>
        </defs>
      )}
      {/* Letter A (no crossbar — the contrail forms it) */}
      <path
        fill={mono ? "currentColor" : `url(#a${id})`}
        d="M211 78h90l155 368h-96L256 208 152 446H56L211 78Z"
      />
      {/* Contrail sweeping through the A up to the jet */}
      <path
        fill={mono ? "currentColor" : `url(#s${id})`}
        opacity={mono ? 0.55 : 1}
        d="M46 474c130-38 258-124 368-282l30 22C330 384 200 460 62 494l-16-20Z"
      />
      {/* Jet silhouette */}
      <g transform="translate(316 4) scale(7.6)">
        <path
          fill={mono ? "currentColor" : NAVY}
          transform="rotate(45 12 12)"
          d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
        />
      </g>
    </svg>
  );
}

/** Full horizontal lockup: mark + AEROOPS wordmark (+ optional tagline). */
export function AeroOpsLogo({
  className,
  markClassName,
  variant = "color",
  tagline = false,
}: {
  className?: string;
  markClassName?: string;
  variant?: MarkVariant;
  tagline?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <AeroOpsMark variant={variant} className={cn("h-9 w-9 shrink-0", markClassName)} />
      <div className="leading-none">
        <p className="font-bold tracking-[0.08em]" style={{ fontSize: "1.25em" }}>
          <span className={variant === "mono" ? "" : "text-brand-navy dark:text-foreground"}>AERO</span>
          <span className={variant === "mono" ? "opacity-70" : "text-brand-sky"}>OPS</span>
        </p>
        {tagline && (
          <p className="mt-1 text-[0.55em] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            The Operating System for Aviation
          </p>
        )}
      </div>
    </div>
  );
}

/** Stacked lockup for auth screens / loading states. */
export function AeroOpsLogoStacked({ className, variant = "color" }: { className?: string; variant?: MarkVariant }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 text-center", className)}>
      <AeroOpsMark variant={variant} className="h-16 w-16" />
      <div>
        <p className="text-2xl font-bold leading-none tracking-[0.08em]">
          <span className={variant === "mono" ? "" : "text-brand-navy dark:text-foreground"}>AERO</span>
          <span className={variant === "mono" ? "opacity-70" : "text-brand-sky"}>OPS</span>
        </p>
        <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          The Operating System for Aviation
        </p>
      </div>
    </div>
  );
}
