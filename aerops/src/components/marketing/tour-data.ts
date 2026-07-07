/**
 * Product Tour catalog: every major AeroOps workspace with a real screenshot
 * captured from the seeded application (public/marketing/*). Client-safe.
 */
export type TourStop = {
  key: string;
  title: string;
  description: string;
  image: string;
  href: string;
};

export const PRODUCT_TOUR: TourStop[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    description: "Today's operating picture the moment you sign in — flights, availability, revenue, balances, weather, and what needs attention.",
    image: "/marketing/dashboard.png",
    href: "/features#operations",
  },
  {
    key: "schedule",
    title: "Scheduling Workspace",
    description: "Aircraft-timeline calendar with drag-to-book, conflict detection, alternative-slot suggestions, requests, and waitlists.",
    image: "/marketing/schedule.png",
    href: "/features#scheduling",
  },
  {
    key: "operations",
    title: "Operations Command Center",
    description: "The live flight board: departures, arrivals, alerts, and aircraft status across every location.",
    image: "/marketing/operations.png",
    href: "/features#operations",
  },
  {
    key: "dispatch",
    title: "Dispatch Center",
    description: "Pre-flight release checklists, post-flight closeout with hobbs/tach capture, and automatic invoicing in one transaction.",
    image: "/marketing/dispatch.png",
    href: "/features#operations",
  },
  {
    key: "mission-control",
    title: "Mission Control",
    description: "A full-screen, continuously-updating wall for the front desk, the owner's office, or the big screen at the trade show.",
    image: "/marketing/mission-control.png",
    href: "/features#mission-control",
  },
  {
    key: "maintenance",
    title: "Fleet Maintenance",
    description: "Squawks with airworthiness impact, work-order lifecycle, signed return-to-service, inspections radar, and parts inventory.",
    image: "/marketing/maintenance.png",
    href: "/features#maintenance",
  },
  {
    key: "training",
    title: "Student Training",
    description: "Part 61/141 syllabi, stage checks, endorsements, checkride readiness, and complete digital training records.",
    image: "/marketing/training.png",
    href: "/solutions/flight-schools",
  },
  {
    key: "instructors",
    title: "CFI Command Center",
    description: "The chief instructor's view: training pipeline, instructor load, stage-check queue, and checkride readiness board.",
    image: "/marketing/students.png",
    href: "/solutions/flight-schools",
  },
  {
    key: "executive",
    title: "Executive Workspace",
    description: "Financial KPIs, fleet profitability rankings, utilization, and an operation health score — with the reasons behind every number.",
    image: "/marketing/executive.png",
    href: "/features#analytics",
  },
  {
    key: "billing",
    title: "Business & Finance",
    description: "Auto-generated invoices from every closed flight, payments, receivables aging, and exportable financial reporting.",
    image: "/marketing/billing.png",
    href: "/features#analytics",
  },
  {
    key: "crm",
    title: "CRM & Admissions",
    description: "Lead pipeline from web form to enrollment, discovery-flight booking, and one-click conversion into students or members.",
    image: "/marketing/crm.png",
    href: "/features#growth",
  },
  {
    key: "intelligence",
    title: "AI Copilot",
    description: "Ask questions in plain English and get operational insights with their reasoning — utilization trends, revenue risks, maintenance forecasts.",
    image: "/marketing/intelligence.png",
    href: "/features#intelligence",
  },
  {
    key: "platform",
    title: "Platform Administration",
    description: "For owners of multiple operations: organization management, plans, audit trail, and support tooling.",
    image: "/marketing/platform.png",
    href: "/features",
  },
];
