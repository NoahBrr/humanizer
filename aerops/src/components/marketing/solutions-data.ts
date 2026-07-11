/** Content catalog for /solutions pages. Client-safe data only. */

export type Solution = {
  slug: string;
  label: string;
  headline: string;
  sub: string;
  image: string;
  pains: string[];
  features: { title: string; body: string }[];
  activities: string[];
  modules: string[];
  workflow: string[];
  journey: string[];
  status?: "available" | "coming-soon";
};

export const SOLUTIONS: Solution[] = [
  {
    slug: "flight-schools",
    label: "Flight Schools",
    headline: "The calm operating system for busy training organizations",
    sub: "Part 61 and Part 141 training, dispatch discipline, automatic billing, and training records your examiner will respect — in one system.",
    image: "/marketing/training.png",
    pains: [
      "Double-booked aircraft and instructors on the whiteboard",
      "Paper training folders nobody can audit",
      "Invoices written after the day is over",
      "No clear view of who is close to checkride minimums",
    ],
    features: [
      { title: "Part 61/141 syllabi & stage checks", body: "Structured courses with lesson grading, instructor signatures, endorsements with FAR references, and stage-check gates." },
      { title: "Checkride readiness board", body: "See exactly who is within reach of minimums, what's missing, and which DPE dates are booked." },
      { title: "Dispatch with airworthiness gates", body: "Pre-flight release verifies documents, fuel, and approvals; grounding squawks pull tails off the schedule instantly." },
      { title: "Automatic invoicing", body: "Closing the flight computes billable time from hobbs and issues the invoice in the same transaction." },
    ],
    activities: ["Part 61 flight training", "Part 141 flight training", "Discovery flights", "Aircraft rental"],
    modules: ["Scheduling", "Dispatch", "Training", "Billing", "Reports"],
    workflow: ["A student requests a lesson and the aircraft and instructor are checked in real time.", "The flight closes and the invoice is generated before the day ends.", "The chief instructor sees readiness milestones and stage-check bottlenecks at a glance."],
    journey: ["A school owner sees the system in a live demo and tests it against a real week of flying.", "The team imports fleet, staff, and syllabi in a guided setup.", "Operations shift from juggling spreadsheets to running from one modern dashboard."],
  },
  {
    slug: "flying-clubs",
    label: "Flying Clubs",
    headline: "Give your members a more polished experience",
    sub: "Self-service scheduling, clear member visibility, dues and flying billing, and board-ready reports — without a volunteer buried in spreadsheets.",
    image: "/marketing/schedule.png",
    pains: [
      "Members calling the scheduler at dinner time",
      "The same few aircraft always getting booked",
      "Dues chased by email, flying billed from memory",
      "The board asks for utilization numbers nobody has",
    ],
    features: [
      { title: "Member self-service booking", body: "Members book from any device; conflict detection keeps the schedule honest; waitlists notify when slots open." },
      { title: "Club billing", body: "Wet/dry rates, monthly dues, account ledgers, and automatic invoices when the flight closes." },
      { title: "Maintenance everyone can see", body: "Squawks, inspection countdowns, and grounded-aircraft visibility so nobody drives to the field for a downed plane." },
      { title: "Board reporting", body: "Utilization by tail, flying hours by member, revenue and receivables — exportable for the meeting." },
    ],
    activities: ["Flying club", "Aircraft rental"],
    modules: ["Scheduling", "Billing", "Maintenance", "Member Requests"],
    workflow: ["Members book from their phone and see the real aircraft availability instantly.", "The club treasurer closes flights and collects fuel and dues charges in one place.", "The board reviews utilization and service hours without chasing data."],
    journey: ["A club officer sees how much easier scheduling becomes during the demo.", "The club imports members and rates and starts booking within days.", "The operation feels more professional to members and leadership alike."],
  },
  {
    slug: "university-aviation-programs",
    label: "University Aviation Programs",
    headline: "A system that supports academic schedules and flight operations together",
    sub: "Coordinate academic calendars, aircraft availability, instructor loading, and program reporting without forcing your team through disconnected tools.",
    image: "/marketing/mission-control.png",
    pains: [
      "Training schedules and aircraft availability live in different systems",
      "Program admins need clarity across instructors, labs, and flight periods",
      "Reporting to department leadership takes hours to prepare",
      "Students and staff need a single place to see what is happening",
    ],
    features: [
      { title: "Program-scale scheduling", body: "Plan aircraft, instructors, labs, and checkrides across semesters and training blocks." },
      { title: "Shared visibility", body: "Students, instructors, and administrators see the same live status for sorties, maintenance, and readiness." },
      { title: "Operational reporting", body: "Roll up utilization, fleet status, and training progress for department leadership and finance." },
      { title: "Trusted controls", body: "Role-based dashboards and audit trails keep the operation precise and accountable." },
    ],
    activities: ["University aviation program", "Training management", "Fleet operations"],
    modules: ["Scheduling", "Training", "Dispatch", "Reports"],
    workflow: ["The program plans the semester with aircraft, instructors, and training windows in one view.", "Students and staff see the live schedule and any changes without waiting for email.", "Leadership reviews utilization and readiness in a clean, shareable report."],
    journey: ["A program director sees how the platform supports both flight operations and academic planning in one demo.", "The team sets up the program structure and the first training cycles with guidance.", "Leadership gets a reliable picture of the operation without a spreadsheet chase."],
  },
  {
    slug: "corporate-aviation",
    label: "Corporate Aviation",
    headline: "A polished command center for growing aviation organizations",
    sub: "Built for organizations that need dependable scheduling, maintenance visibility, and executive clarity as they expand.",
    image: "/marketing/executive.png",
    pains: [
      "Trip requests, crew availability, and maintenance status are spread across too many tools",
      "Flight departments need executive clarity without a heavy admin burden",
      "The operation grows faster than the manual reporting process",
      "The team needs a single source of truth for day-to-day coordination",
    ],
    features: [
      { title: "Trip and crew coordination", body: "Keep aircraft, crew, and maintenance windows aligned from one workspace." },
      { title: "Executive visibility", body: "Surface fleet health, utilization, and costs without building reports by hand." },
      { title: "Operational discipline", body: "Use shared workflows and audit trails to keep the operation consistent as it scales." },
      { title: "Future-ready foundation", body: "AeroOps grows naturally with your aviation organization as complexity increases." },
    ],
    activities: ["Corporate flight operations", "Aircraft management"],
    modules: ["Scheduling", "Dispatch", "Maintenance", "Reports"],
    workflow: ["Trip requests are reviewed against aircraft, crew, and maintenance constraints in the same workspace.", "The team uses the same data to understand availability and keep flights moving.", "Leadership sees operational health and costs without waiting on manual updates."],
    journey: ["A decision-maker sees how AeroOps provides structure without adding noise to the operation."],
    status: "coming-soon",
  },
];
