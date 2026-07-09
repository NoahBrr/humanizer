# AeroOps Design System

The visual and interaction standard for every AeroOps surface — tenant app,
platform portal, Mission Control, marketing site, auth, and print. The
[CONSTITUTION.md](../../CONSTITUTION.md) is law; CLAUDE.md §4 is the
session-start digest of this document; the
[ENGINEERING_HANDBOOK.md](../engineering/ENGINEERING_HANDBOOK.md) styling,
accessibility, and responsive sections are the working practice — this
document does not contradict them, it details them. Anything marked
**(aspirational — not yet enforced)** describes the intended standard where
the code is not yet consistent.

Tone in one line: **aviation-professional, enterprise-calm**. No flashy
gradients, no trendy effects, no decoration that a dispatcher at 6 a.m.
would have to look past.

## Color palette

- **Brand palette** (defined once in `src/app/globals.css` `:root`):
  Deep Navy `#0B2447` (`--brand-navy`) · Royal Blue `#1E63D0`
  (`--brand-royal`) · Sky Blue `#38A1E8` (`--brand-sky`) · Silver `#C6CFD8`
  (`--brand-silver`) · Gunmetal `#2E3A46` (`--brand-gunmetal`) · White.
- **Semantic tokens** derive from the brand in oklch: `--background`,
  `--foreground`, `--card`, `--muted`, `--border`, `--input`, `--primary`
  (royal blue), `--accent` (sky tint), `--destructive`, `--success`,
  `--warning`, `--info` (sky blue), `--ring`, plus `--sidebar` /
  `--sidebar-foreground` (deep navy / silver). Every token has a `.dark`
  counterpart; both blocks live in `globals.css` and surface as Tailwind
  utilities (`bg-primary`, `text-muted-foreground`, `bg-sidebar`,
  `text-brand-sky`) via `@theme inline`.
- **Never raw hex in components** — tokens only. Change brand in `:root`;
  everywhere else consumes tokens. The two sanctioned hex homes outside
  `globals.css`: `src/components/brand/logo.tsx` (the brand-mark source of
  truth) and `src/lib/status-colors.ts` `STATUS_HEX` (solid fills for
  SVG/calendar surfaces where CSS classes can't reach, per-theme, ≥3:1
  contrast against their surface).
- **Status colors are canonical** (⚖ constitution rule 4): one
  `STATUS_TONE` map in `src/lib/status-colors.ts`, meanings frozen —
  Scheduled → blue, Released/Dispatched → purple, In Flight → green,
  Completed → gray, Cancelled → red, Maintenance → orange, Grounded → dark
  red. New states get new entries; existing meanings never change. UI
  consumes it through `statusToneOf()` / `<StatusBadge>`; calendars and SVG
  through `statusHex(status, mode)`.
- Light/dark parity is do-not-break rule 7: every color decision is made
  for both themes at the same time, never retrofitted.

## Typography

- **Inter**, loaded via `next/font/google` in `src/app/layout.tsx`
  (`--font-inter`, fallback `system-ui, sans-serif`), antialiased, with
  `font-feature-settings: "cv11", "ss01"` set on `body` in `globals.css`.
- Scale in practice (match it — don't invent sizes):
  - Page title: `text-[1.35rem] font-semibold tracking-tight text-brand-navy
    dark:text-foreground` (`PageHeader` in `ui/misc.tsx`) — the marketing
    heading treatment at operator scale. `PageHeader` also accepts an optional
    `eyebrow` (the uppercase-tracked marketing kicker, `text-xs font-semibold
    uppercase tracking-[0.16em] text-brand-royal dark:text-brand-sky`); it is
    opt-in, so pages that pass no eyebrow are unchanged.
  - Card/section title: `text-sm font-semibold tracking-tight`
    (`CardTitle`); descriptions `text-xs text-muted-foreground`.
  - Body and controls: `text-sm`. Table headers and labels: `text-xs
    font-medium text-muted-foreground`.
  - Micro copy (badges, timestamps, role labels): `text-[10px]`–`text-[11px]`.
- The wordmark uses `font-bold tracking-[0.08em]`; the tagline
  `uppercase tracking-[0.22em]`. That letterspacing is brand-only — never
  use it for UI text.
- Hierarchy comes from weight and the muted-foreground token, not from
  extra sizes or colors.

## Spacing

- Tailwind's default spacing scale only — no arbitrary pixel margins.
- Page rhythm: sections stack with `space-y-4`/`space-y-5`; stat/card
  grids use `gap-3`/`gap-4`; `PageHeader` closes with `mb-6`.
- Card interior: header `p-5 pb-3`, content `p-5 pt-2`. Table cells:
  `px-3 py-2.5`; header row `h-9`.
- Control heights are fixed: inputs/selects/buttons `h-9` (md), `h-8`
  (sm), `h-10` (lg). Topbar and drawer headers are `h-14`.
- Density is deliberate: AeroOps is an operations console, not a landing
  page — compact rows, no oversized hero spacing inside the app shell.

## Components

- Primitives live in `src/components/ui/` — `badge.tsx`, `button.tsx`,
  `card.tsx`, `drawer.tsx`, `input.tsx` (Input/Select/Textarea/Label),
  `misc.tsx` (Avatar, Progress, Skeleton, EmptyState, PageHeader),
  `table.tsx`. Shell chrome lives in `src/components/shell/`; brand marks
  only in `src/components/brand/logo.tsx`.
- **Extend the primitives; never fork them.** A second copy of anything
  becomes a shared component (constitution conventions).
- Composition is `cn()` (`src/lib/utils.ts` — clsx + tailwind-merge):
  primitives accept `className` and merge, never override with inline
  styles.
- `ui/drawer.tsx` is the reference interactive primitive: focus trap, ESC
  to close, focus restore on close, `role="dialog"` + `aria-modal` +
  `aria-label`, backdrop click to dismiss. New overlays copy that contract.
- Components render; engines compute. No business logic, no role checks,
  no status→color decisions inside a component.

## Buttons

`ui/button.tsx` — one component, six variants, four sizes:

| Variant | Use |
|---|---|
| `default` | The one primary action per view (`bg-primary`) |
| `secondary` | Supporting actions (`bg-muted`) |
| `outline` | Toolbar/filter actions on cards |
| `ghost` | Icon buttons, low-emphasis chrome |
| `destructive` | Irreversible/dangerous actions only |
| `success` | Positive confirmations (release, approve) |

- Sizes: `sm` (h-8, text-xs), `md` (h-9, default), `lg` (h-10,
  `rounded-xl`), `icon` (h-9 square). Radius comes from the tokens —
  `--radius-lg: 0.625rem`, `--radius-xl: 0.875rem` — never arbitrary.
- Every button: `focus-visible:outline-2 outline-ring outline-offset-2`,
  `disabled:opacity-50 pointer-events-none`, `transition-colors`,
  `cursor-pointer`. Icon-only buttons carry `aria-label`.
- Icons inside buttons are `h-3.5 w-3.5`–`h-4 w-4`, gap from the built-in
  `gap-2`.

## Forms

- `Input`, `Select`, `Textarea` from `ui/input.tsx`: `h-9 w-full rounded-lg
  border-input bg-card text-sm shadow-sm`, placeholder in
  `text-muted-foreground`, `focus-visible` ring, `disabled:opacity-50`.
- `Label` is `text-xs font-medium text-muted-foreground`, placed above the
  control.
- Validation is zod at the boundary (constitution); the UI shows the
  server's message, it does not re-invent rules.
- Errors render inline next to the form as `text-xs font-medium
  text-destructive` (see `(auth)/sign-in`), and the copy tells the user
  what to do next — never a bare "Invalid".
- Multi-step flows (Import wizard, org create) show a step rail with
  completed steps marked by a `text-success` check.

## Tables

- `ui/table.tsx` only. `Table` wraps itself in `overflow-x-auto` — wide
  tables scroll in their own container, never the page.
- Headers: `TH` is `h-9 px-3 text-xs font-medium text-muted-foreground
  whitespace-nowrap`, left-aligned. Rows: `TR` has `border-b border-border`
  and `hover:bg-muted/40`; cells `px-3 py-2.5`.
- Status cells use `<StatusBadge>`; money is right-of-decimal-honest
  (`formatCurrency`), timestamps `date-fns`.
- Every table has an empty state (see Empty states) — a header row above
  nothing is a bug.

## Cards

- `ui/card.tsx`: `rounded-xl border border-border bg-card` with a soft,
  navy-tinted elevation
  (`0 1px 3px rgb(11 36 71 / 0.06), 0 1px 2px rgb(11 36 71 / 0.04)`) — the
  same navy shadow family the marketing site uses on its screenshot frames
  (`rgb(11 36 71 / …)`), scaled down to stay calm and operator-dense. Depth
  still comes mostly from the border; the shadow only warms the lift. `rgb()`
  brand-navy in an arbitrary shadow value is sanctioned here (it is not a
  color token consumers read, and it mirrors the marketing frame shadow).
- Anatomy: `CardHeader` (title + optional description + optional action
  button, `flex-row justify-between` when both) → `CardContent`.
- Stat tiles are the compact variant: `CardContent p-4`, `text-[11px]
  text-muted-foreground` label over `text-lg font-semibold` value (see
  Reports, Dashboard).
- Cards are the unit of page composition inside `grid-cols-1 →
  md/lg/xl:grid-cols-N` grids.

## Icons

- **lucide-react, exclusively.** No second icon set exists in the codebase;
  keep it that way.
- Sizes: `h-4 w-4` default (buttons, nav, topbar), `h-3.5 w-3.5` in dense
  chrome, `h-5 w-5` in the mobile bottom nav, `h-10`–`h-12` only in
  success/empty illustrations.
- Icons inherit color: `text-muted-foreground` at rest, the semantic token
  when meaningful (`text-success` check, `text-warning` weather). Decorative
  icons never carry their own hex.
- Icons accompany text; icon-only controls require `aria-label`.

## Charts

- **Recharts** is the charting library (`recharts` in `package.json`; the
  reference implementation is `src/app/(app)/reports/reports-client.tsx`).
  FullCalendar is scheduling, not charting — don't confuse the two.
- Chart shape: `ResponsiveContainer` inside a fixed-height `CardContent`
  (`h-60`); dashed horizontal-only `CartesianGrid`; no axis lines or tick
  lines; ticks at `fontSize: 10` in the muted text color; compact tick
  formatters (`$1.2k`).
- Tooltips are styled with CSS variables (`var(--color-card)`,
  `var(--color-border)`, `var(--color-foreground)`) so they follow the
  theme automatically.
- Series colors are theme-aware pairs (light/dark hex, since SVG can't
  read Tailwind classes), one hue per meaning, watched via the `.dark`
  class MutationObserver pattern. A shared chart-palette module in
  `src/lib` so every future chart draws from one source — today the pair
  lives inline in `reports-client.tsx` **(aspirational — not yet
  enforced)**.
- Status-driven marks (calendar blocks, Mission Control SVG) use
  `statusHex()` — never a locally chosen color.

## Empty states

- Empty states are part of the feature, not follow-ups (CLAUDE.md §4).
- The primitive is `EmptyState` (`ui/misc.tsx`): an optional icon set in a
  soft `bg-accent` rounded circle (calm, intentional — not a bare muted
  glyph), `text-sm font-medium` title, `text-xs text-muted-foreground`
  description. API (`icon`/`title`/`description`/`action`) is unchanged.
- Copy states what will appear here and what action creates it: "No imports
  yet — your first import will appear here with its full row-by-row
  report", "No leads yet — share the public form to start the pipeline".
  Never a bare "No data".
- All list/table empty states go through the `EmptyState` primitive
  **(aspirational — not yet enforced: several pages render ad-hoc muted
  `<p>` empties instead; new code uses the primitive)**.

## Loading states

- **Skeletons over spinners.** `Skeleton` (`ui/misc.tsx`) is
  `animate-pulse rounded-lg bg-muted`; route-level loading mirrors the
  destination layout (see `src/app/(app)/loading.tsx`: header lines + stat
  grid + content panels) and carries `aria-busy` + `aria-label="Loading"`.
- Skeleton grids match the real page's responsive grid so nothing jumps on
  arrival.
- Route-level `loading.tsx` for the platform portal and other slow
  segments, matching the `(app)` pattern **(aspirational — only `(app)`
  has one today)**.

## Error states

- Errors tell the user what to do next (CLAUDE.md §4) — every user-facing
  error string is actionable, matching the API standard.
- Inline form errors: `text-xs font-medium text-destructive` adjacent to
  the failing control or above the submit.
- Optimistic interactions revert and explain: the schedule calendar's
  drag-move reverts on 409 and toasts the first conflict message ("Move
  blocked: …").
- Destructive/danger text uses the `destructive` token only — never a
  literal red class in app code.
- Route-level `error.tsx` boundaries with a retry affordance
  **(aspirational — none exist yet; errors are handled inline in client
  components today)**.

## Success states

- Quiet confirmation, not celebration: `text-success` with a lucide
  `Check`/`CheckCircle2`, or a short toast ("Booking created.",
  "Booking updated.").
- Toasts are bottom-right, `animate-fade-up`, auto-dismiss (~5 s), token
  colors (see `schedule-calendar.tsx`). A shared toast primitive in
  `src/components/ui` **(aspirational — the implementation is local to the
  schedule today; a second consumer must extract it, per the second-copy
  rule)**.
- Multi-step completions land on a `text-success` icon + summary screen
  (Import wizard commit, join-request sent).

## Responsive layouts

- Every page works on desktop, tablet, and mobile — non-negotiable
  (do-not-break rule 7).
- Grids start single-column: base `grid-cols-1` track, columns added at
  `md`/`lg`/`xl` (constitution conventions). Never design desktop-first
  and subtract.
- Wide content (tables, calendars) scrolls inside its own
  `overflow-x-auto` container; the page never scrolls horizontally.
- The desktop sidebar (`w-56`, `bg-sidebar`) appears at `lg`; it collapses
  to a 4 rem icon rail via `html[data-sidebar="collapsed"]` (CSS in
  `globals.css`, ≥64 rem only), persisted in `localStorage`
  (`aerops-sidebar`) and applied pre-paint by the root layout's init
  script. It must **always remain reopenable**: edge handle pinned to the
  border, the logo expands it, and `[` toggles from anywhere.
- Topbar affordances degrade gracefully: search hides below `md`, weather
  chip below `xl` — nothing essential lives only in optional chrome.

## Mobile design

- Below `lg`, navigation is the fixed bottom bar (`shell/mobile-nav.tsx`):
  the four most-used destinations pinned, everything else behind a "More"
  sheet (3-column grid, `rounded-t-2xl`, backdrop blur).
- Touch targets: bar items `min-h-14`, sheet tiles `min-h-[4.5rem]` —
  never smaller.
- Safe areas respected: `pb-[env(safe-area-inset-bottom)]`; the viewport is
  `viewportFit: "cover"` and PWA-ready (manifest, service worker,
  `themeColor` navy in both schemes).
- Active state on mobile is `text-primary` + `aria-current="page"`; nav
  items are permission-filtered exactly like the sidebar (same
  `NAV_ITEMS` / `SECTION_PERMISSIONS` source).

## Print layouts

- Print is a first-class surface: the marketing site doubles as
  presentation/PDF material (`@media print` in `globals.css`; verify with
  `node scripts/verify-print.mjs`).
- The rules: `print-color-adjust: exact` everywhere (brand colors survive
  paper); sticky headers become static; `.print-hidden` drops purely
  interactive chrome (nav CTAs, tour controls); `.print-flatten` removes
  decorative transforms (translated elements paint across page boundaries
  otherwise); `.print-break-before` gives the hero screenshot its own page;
  `img, figure, .rounded-xl, .rounded-2xl` avoid `break-inside` so product
  screenshots never split; sections avoid page breaks; links lose
  underlines.
- Marketing pages use real product screenshots from `public/marketing/` —
  regenerate with `node scripts/capture-marketing.mjs` after UI changes so
  print never shows a stale interface.
- The brand mark prints via the `mono` variant (single `currentColor`)
  where gradients would dither.

## Accessibility

- **WCAG AA contrast in both themes.** Status hexes keep ≥3:1 against
  their surface by construction (`status-colors.ts`).
- Everything keyboard reachable: ⌘K command palette, `[` sidebar toggle
  (suppressed while typing), focus-trapped drawers with ESC + focus
  restore.
- Visible focus: `focus-visible:outline-2 outline-ring` on every control;
  the FullCalendar bridge re-applies the ring to calendar buttons.
- Semantics: dialogs carry `role="dialog"` + `aria-modal` + `aria-label`;
  nav uses `aria-current="page"`; icon-only buttons have `aria-label`;
  loading regions set `aria-busy`; the logo SVG is `role="img"` with an
  accessible name.
- `prefers-reduced-motion` honored globally (see Motion).
- Automated a11y checks in CI **(aspirational — not yet enforced;
  see ENGINEERING_HANDBOOK.md)**.

## Motion and animation

- One entrance animation: `animate-fade-up` (0.25 s ease-out, 4 px rise) —
  used for drawers, popovers, sheets, toasts. Nothing else animates in.
- State changes use `transition-colors` (and `transition-[width]` for the
  sidebar, `transition-all` for progress bars) at default durations.
  Loading pulses via `animate-pulse` skeletons.
- `@media (prefers-reduced-motion: reduce)` collapses **all** animation and
  transition durations to 0.01 ms and disables smooth scroll, globally, in
  `globals.css`. Never opt an element out of this block.
- No parallax, no spring physics, no attention-seeking motion — this is an
  operations console.

## Branding consistency

- **`src/components/brand/logo.tsx` is the only source of brand marks**
  (with the exported SVGs in `public/brand`). `AeroOpsMark` (square A +
  contrail + jet), `AeroOpsLogo` (horizontal lockup), `AeroOpsLogoStacked`
  (auth/loading). Never redraw, recolor, or approximate the mark.
- Two variants: `color` (navy→royal→sky gradient A, silver contrail — the
  one sanctioned gradient in the product) and `mono` (`currentColor`, for
  embossing, print, favicons).
- Wordmark: AERO in `text-brand-navy` (foreground in dark) + OPS in
  `text-brand-sky`, `tracking-[0.08em]`. Tagline: "The Operating System
  for Aviation", uppercase, `tracking-[0.22em]`, muted.
- The sidebar is deep navy in both themes — it is the brand anchor of the
  app shell; the browser/PWA theme color is `#0B2447`.
- Marketing ↔ app separation is do-not-break rule 8, but both speak the
  same visual language: same tokens, same primitives where sensible, same
  screenshots pipeline.
- Tone everywhere: aviation-professional, enterprise-calm. If a treatment
  would look at home on a crypto landing page, it doesn't ship here.

### App ↔ marketing alignment (same brand, operator mode)

The tenant app and the public marketing site are one brand expressed at two
densities — the app is "operator mode," not a landing page. These are the
governed alignment decisions; keep both surfaces on them.

- **Elevation.** Marketing frames use the navy shadow family
  `rgb(11 36 71 / …)`. The app `Card` mirrors it, scaled down
  (`0 1px 3px / 0.06 + 0 1px 2px / 0.04`) so operator density survives while
  the surface stops reading flat. No app card gets marketing-scale drop
  shadows.
- **Headings + eyebrows.** Page titles and top-level section headings use the
  marketing heading color `text-brand-navy dark:text-foreground` with
  `tracking-tight`. The uppercase-tracked eyebrow
  (`tracking-[0.16em] text-brand-royal dark:text-brand-sky`) is the shared
  kicker; in the app it is opt-in (`PageHeader`'s `eyebrow`, the dashboard
  greeting) and stays rare so it signals a page, not every card.
- **Brightness.** The app shell carries a very subtle top wash of
  `--color-primary` (`.app-shell` in `globals.css`, ~6% via `color-mix`, both
  themes) so the operator surface shares the marketing site's brightness.
  Opaque `bg-card` sits above it, so only gutters pick up the tint — contrast,
  density, and readability are unchanged.
- **Header family.** The topbar (`bg-background/85 backdrop-blur`) matches the
  marketing `SiteHeader` treatment; identity/role chrome is grouped behind a
  hairline divider so the two headers read as one system.
- **What stays operator-mode.** Body/control sizes, table and card density,
  `font-medium` buttons, and compact stat tiles are unchanged — the alignment
  is brand-level (color, elevation, brightness, kickers), never a loosening of
  operational density.

## Related documents

- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) — system shape, engines, surfaces
- [ENGINEERING_HANDBOOK.md](../engineering/ENGINEERING_HANDBOOK.md) — styling, accessibility, and responsive working practice
- [AI_REVIEW_BOARD.md](../engineering/AI_REVIEW_BOARD.md) — the UX reviewer's gate enforces this document
- [CLAUDE.md](../../CLAUDE.md) — session-start digest (§4 UI/UX standards)
- [CONSTITUTION.md](../../CONSTITUTION.md) — enforced rules (status colors ⚖, nav permission-mapping ⚖)
