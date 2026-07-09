/**
 * Single source of truth for the AeroOps sales deck. Consumed by
 * build-deck.mjs (premium HTML → PDF) and build-pptx.mjs (editable .pptx).
 * Copy is transcribed from sales/DECK_CONTENT.md; roadmap items stay labelled.
 *
 * Image refs are { dir, file }: dir ∈ marketing | screens | assets. Each
 * builder resolves the real path (relative for HTML, absolute for pptx).
 */

export const BRAND = {
  navy: "#0b2447",
  royal: "#1e63d0",
  sky: "#38a1e8",
  silver: "#c6cfd8",
  ink: "#0b2447",
  slate: "#5b6b7e",
};

const img = (dir, file) => ({ dir, file });

export const SLIDES = [
  {
    layout: "cover",
    eyebrow: "The Operating System for Aviation",
    headline: "AeroOps",
    subhead: "Run the operation, not the paperwork.",
    bg: img("marketing", "dashboard.png"),
  },
  {
    layout: "diagram",
    eyebrow: "Mission",
    headline: "One system. One truth.",
    body: "Small aviation runs on whiteboards, dispatch binders, and five tools that don't talk to each other. AeroOps makes the connected version the easy version.",
    bullets: [
      "The schedule doesn't know the airplane is grounded.",
      "The invoice doesn't know the flight closed.",
      "The chief instructor recalls checkride readiness from memory.",
    ],
    visual: img("assets", "ecosystem.svg"),
  },
  {
    layout: "cards",
    eyebrow: "The problem",
    headline: "Fragmentation is the enemy",
    subhead: "Every seam between tools is where money and safety leak out.",
    cards: [
      { t: "Revenue leaks", d: "Flights that closed but were never billed." },
      { t: "Airworthiness by memory", d: "The overdue inspection no spreadsheet flagged." },
      { t: "Training opacity", d: "Readiness as tribal knowledge, not a record." },
      { t: "Compliance anxiety", d: "The FSDO conversation starts from recollection." },
    ],
  },
  {
    layout: "diagram",
    eyebrow: "Why AeroOps",
    headline: "An operating system, not an app",
    body: "Scheduling, dispatch, maintenance, training, and money as one continuous, auditable motion — what airlines have had for decades.",
    bullets: [
      "One data model, not five products and a spreadsheet.",
      "Every computed answer carries its reasons.",
      "An immutable audit trail under every action.",
    ],
    visual: img("assets", "ecosystem.svg"),
  },
  {
    layout: "split",
    eyebrow: "Platform overview",
    headline: "Everything the operation touches",
    subhead: "One login. One picture. One record.",
    bullets: [
      "Fly — Scheduling · Dispatch · Operations · Mission Control",
      "Maintain — Squawks · Work orders · Return-to-service · Parts",
      "Teach — Students · Instructors · Checkride readiness",
      "Bill — Invoices · Payments · Receivables",
      "Know — Reports · Executive view · Explainable insights",
    ],
    visual: img("marketing", "dashboard.png"),
  },
  {
    layout: "split",
    eyebrow: "Dashboard",
    headline: "What needs me today",
    subhead: "The morning triage, answered before the first click.",
    bullets: [
      "Today's flights, at a glance.",
      "Needs Attention — squawks, inspections, checkrides, activity.",
      "Fleet status and weather for the active location.",
      "Personalized: every viewer sees only what their role should.",
    ],
    visual: img("marketing", "dashboard.png"),
  },
  {
    layout: "split",
    eyebrow: "Mission Control",
    headline: "The operation on the wall",
    subhead: "A live, full-screen operations picture for the front desk and the ops room.",
    bullets: [
      "Real-time flight, fleet, and weather panels.",
      "The audit timeline as a first-class surface — not a log file.",
      "TV mode and scenes for the dispatch wall.",
    ],
    visual: img("marketing", "mission-control.png"),
    dark: true,
  },
  {
    layout: "split",
    eyebrow: "Scheduling",
    headline: "Book it once, everywhere",
    subhead: "The schedule that knows the airplane, the instructor, and the student.",
    bullets: [
      "Conflicts caught before they're saved.",
      "Aircraft, instructor, student, and resource on one axis.",
      "Grounded aircraft can't quietly stay on the schedule.",
    ],
    visual: img("marketing", "schedule.png"),
  },
  {
    layout: "split",
    eyebrow: "Training",
    headline: "The training pipeline, in the system",
    subhead: "Readiness with reasons — not reconstructed from memory.",
    bullets: [
      "Students, instructors, stage checks, and checkride queue in one place.",
      "Endorsements and currency on the record, not in a spreadsheet.",
      "Lesson records that follow the student through the syllabus.",
    ],
    visual: img("marketing", "training.png"),
  },
  {
    layout: "split",
    eyebrow: "Fleet & Maintenance",
    headline: "Airworthiness the system enforces",
    subhead: "Squawk → work order → return-to-service, with parts you can audit.",
    bullets: [
      "Squawks ranked by airworthiness impact.",
      "Signed return-to-service on the record.",
      "Parts movement as a typed, traceable ledger.",
      "Ground an aircraft and see the blast radius.",
    ],
    visual: img("marketing", "maintenance.png"),
  },
  {
    layout: "split",
    eyebrow: "Operations",
    headline: "The day, in motion",
    subhead: "Release, watch, resolve, close out — without phone-tag.",
    bullets: [
      "Live releases and returns from one board.",
      "Status that's always truthful across schedule and maintenance.",
      "Conflicts and grounding impact surfaced before they bite.",
    ],
    visual: img("marketing", "operations.png"),
  },
  {
    layout: "split",
    eyebrow: "Billing",
    headline: "Money that reconciles itself",
    subhead: "Invoices, payments, and receivables built into the operation — not bolted on.",
    bullets: [
      "One invoice per flight, generated at closeout.",
      "Money is exact by construction (Decimal, never float).",
      "Receivables aging and payment records in the tenant.",
    ],
    footnote: "Card processing on invoices is on the roadmap (Stripe adapter).",
    visual: img("marketing", "billing.png"),
  },
  {
    layout: "diagram",
    eyebrow: "The feature moment",
    headline: "One motion. No leak.",
    body: "The flight closes. The meters move. The invoice exists — atomically. If any step fails, none of it commits.",
    visual: img("assets", "workflow.svg"),
  },
  {
    layout: "split",
    eyebrow: "Reports",
    headline: "Numbers you can defend",
    subhead: "Executive reporting with the reasons behind every figure.",
    bullets: [
      "Revenue, utilization, and instructor productivity.",
      "Executive view for the owner and the board.",
      "An immutable audit trail underneath every number.",
    ],
    visual: img("marketing", "executive.png"),
  },
  {
    layout: "roleGrid",
    eyebrow: "Role-based experience",
    headline: "One product. Every seat.",
    subhead: "Personalized by permission — never hardcoded by title. No one sees data their role shouldn't.",
    roles: [
      { label: "Account Owner", file: "role-owner.png" },
      { label: "Operations Director", file: "role-dispatcher.png" },
      { label: "Chief / Flight Instructor", file: "role-instructor.png" },
      { label: "Flight Dispatcher", file: "role-dispatcher.png" },
      { label: "Maintenance Manager", file: "role-maintenance.png" },
      { label: "Student Pilot", file: "role-student.png" },
    ],
  },
  {
    layout: "split",
    eyebrow: "Customization",
    headline: "Fits your operation",
    subhead: "Configure the product to the operation without a consultant.",
    bullets: [
      "Toggle dashboard widgets per user.",
      "Role-driven navigation and custom-role templates (Registrar, Front Office, Safety Officer…).",
      "School branding, time zone, and multiple locations.",
    ],
    visual: img("screens", "role-finance.png"),
  },
  {
    layout: "split",
    eyebrow: "Migration",
    headline: "Bring your data. Roll it back.",
    subhead: "The Import Center is why switching isn't scary.",
    bullets: [
      "Presets for Flight Circle, Flight Schedule Pro, FlightLogger, QuickBooks.",
      "Map → test (a real, rolled-back run) → commit → rollback manifest.",
      "Public API v1 and signed webhooks for what comes next.",
    ],
    visual: img("marketing", "import.png"),
  },
  {
    layout: "split",
    eyebrow: "Mobile",
    headline: "The operation in your pocket",
    subhead: "A responsive, installable app — for the ramp, the desk, and the couch.",
    bullets: [
      "Installable PWA: add to home screen, works on phone and tablet.",
      "Bottom navigation and full light/dark parity.",
      "Every role's view, sized for the device.",
    ],
    footnote: "Installable PWA today; native app-store wrappers are on the roadmap.",
    visual: img("marketing", "mobile-dashboard.png"),
    phone: true,
  },
  {
    layout: "cards",
    eyebrow: "Why schools choose AeroOps",
    headline: "Adopt it in an afternoon",
    subhead: "Built for the owner who is also the operations department.",
    cards: [
      { t: "One place", d: "No re-entering a flight into three systems." },
      { t: "Billing by itself", d: "Invoices happen at closeout, automatically." },
      { t: "Know tonight", d: "What today made, before you go home." },
      { t: "No overhead", d: "No manual, no consultant, no back office." },
    ],
  },
  {
    layout: "split",
    eyebrow: "Proof & trust",
    headline: "Explainable by construction",
    subhead: "Trust is the product.",
    bullets: [
      "Every conflict, readiness score, and insight shows its reasons.",
      "The audit trail is immutable — never rewritten, never skipped.",
      "AI advises; it never acts. Mutations require a permissioned human.",
      "Multi-tenant isolation enforced from the session, never the client.",
    ],
    visual: img("marketing", "intelligence.png"),
  },
  {
    layout: "diagram",
    eyebrow: "Security & architecture",
    headline: "Enterprise-grade underneath",
    body: "Multi-tenant by construction, one authorization gate, an immutable audit trail, and an atomic money path.",
    visual: img("assets", "architecture.svg"),
  },
  {
    layout: "roadmap",
    eyebrow: "Roadmap — clearly future",
    headline: "The seams are already built",
    subhead: "We're plugging adapters into existing seams. Everything here is roadmap.",
    tiers: [
      { t: "Delivery", d: "Email & SMS notifications, web push." },
      { t: "Payments", d: "Stripe subscriptions and card-on-invoice." },
      { t: "Live weather", d: "Real METAR/TAF (simulated today)." },
      { t: "Documents", d: "Cloud file storage with signed URLs." },
      { t: "Operational intelligence", d: "Airworthiness forecasting, currency guards, live AI narration." },
    ],
  },
  {
    layout: "pricing",
    eyebrow: "Pricing philosophy",
    headline: "Priced for the operation you are",
    subhead: "Modern SaaS economics — no consultant, no hostage fees.",
    tiles: [
      { t: "Transparent", d: "Per-aircraft / per-seat, published — not negotiated in the dark." },
      { t: "Self-serve", d: "Onboard in an afternoon; a real import path out of any competitor." },
      { t: "Grows with you", d: "Scale shouldn't punish you — pricing grows with the operation." },
    ],
    cta: "Transparent pricing — contact us.",
  },
  {
    layout: "close",
    eyebrow: "",
    headline: "Run the operation, not the paperwork.",
    subhead: "See your school on AeroOps.",
    cta: "Request a demo · aerops.io",
    bg: img("marketing", "mission-control.png"),
  },
];

// Customer-specific variants — swap the cover eyebrow + reorder emphasis.
export const VARIANTS = {
  part61: {
    name: "Part 61 Flight School",
    coverEyebrow: "For your Part 61 flight school",
    coverSub: "Book, dispatch, bill, and know tonight what today made.",
  },
  part141: {
    name: "Part 141 Flight School",
    coverEyebrow: "For your Part 141 academy",
    coverSub: "Stage checks, checkride readiness, and audit-ready training records.",
  },
  university: {
    name: "University Aviation Program",
    coverEyebrow: "For your collegiate aviation program",
    coverSub: "Cohort-scale training records, fleet utilization, accreditation-grade trails.",
  },
};
