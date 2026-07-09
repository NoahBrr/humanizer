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
};

export const SOLUTIONS: Solution[] = [
  {
    slug: "flight-schools",
    label: "Flight Schools",
    headline: "Run your flight school like an airline ops center",
    sub: "Part 61 and Part 141 training, dispatch discipline, automatic billing, and training records your examiner will respect — in one system.",
    image: "/marketing/training.png",
    pains: [
      "Double-booked aircraft and instructors on the whiteboard",
      "Paper training folders nobody can audit",
      "Invoices written up hours after the flight — or never",
      "No idea which students are close to checkride minimums",
    ],
    features: [
      { title: "Part 61/141 syllabi & stage checks", body: "Structured courses with lesson grading, instructor signatures, endorsements with FAR references, and stage-check gates." },
      { title: "Checkride readiness board", body: "See exactly who is within reach of minimums, what's missing, and which DPE dates are booked." },
      { title: "Dispatch with airworthiness gates", body: "Pre-flight release verifies documents, fuel, and approvals; grounding squawks pull tails off the schedule instantly." },
      { title: "Automatic invoicing", body: "Closing the flight computes billable time from hobbs and issues the invoice in the same transaction." },
      { title: "CFI command center", body: "Instructor load, training pipeline, and stage-check queue for the chief instructor." },
      { title: "CRM & admissions", body: "Discovery-flight leads convert to enrolled students in one click, history intact." },
    ],
    activities: ["Part 61 flight training", "Part 141 flight training", "Discovery flights", "Aircraft rental"],
  },
  {
    slug: "flying-clubs",
    label: "Flying Clubs",
    headline: "Give your members airline-quality booking",
    sub: "Self-service scheduling, fair-use visibility, dues and flying billing, and board-ready reports — without a volunteer buried in spreadsheets.",
    image: "/marketing/schedule.png",
    pains: [
      "Members calling the scheduler at dinner time",
      "The same two people always have the 182",
      "Dues chased by email, flying billed from memory",
      "The board asks for utilization numbers nobody has",
    ],
    features: [
      { title: "Member self-service booking", body: "Members book from any device; conflict detection keeps the schedule honest; waitlists notify when slots open." },
      { title: "Club billing", body: "Wet/dry rates, monthly dues, account ledgers, and automatic invoices when the flight closes." },
      { title: "Maintenance everyone can see", body: "Squawks, inspection countdowns, and grounded-aircraft visibility so nobody drives to the field for a downed plane." },
      { title: "Join requests & invite links", body: "Prospective members request to join online; officers approve, assign roles, and it's all audit-logged." },
      { title: "Board reporting", body: "Utilization by tail, flying hours by member, revenue and receivables — exportable for the meeting." },
      { title: "Proficiency tracking", body: "Currency and checkout tracking so members and safety officers know who's current in what." },
    ],
    activities: ["Flying club", "Aircraft rental"],
  },
  {
    slug: "aircraft-rental",
    label: "Aircraft Rental",
    headline: "Rental operations without the paperwork pile",
    sub: "Checkout requirements, honest scheduling, meter-accurate billing, and squawk capture on every return.",
    image: "/marketing/dispatch.png",
    pains: [
      "Renters booking aircraft they aren't checked out in",
      "Hobbs disputes and hand-written tickets",
      "Fuel surcharges applied inconsistently",
      "Squawks reported in the parking lot, lost by Monday",
    ],
    features: [
      { title: "Renter requirements", body: "Certificates, medicals, and checkout documents tracked with expirations — visible at booking time." },
      { title: "Meter-accurate billing", body: "Hobbs out/in captured at dispatch; rental invoices generated automatically with wet/dry rates and surcharges." },
      { title: "Squawk capture on close", body: "Every return asks about the airplane; grounding squawks remove the tail from the schedule immediately." },
      { title: "Live availability", body: "Renters see real availability — maintenance windows and groundings included — from their phone." },
      { title: "Documents vault", body: "Rental agreements, insurance, and IDs with expiration tracking." },
      { title: "Receivables that age", body: "Outstanding balances roll up in real time with reminders." },
    ],
    activities: ["Aircraft rental", "Discovery flights"],
  },
  {
    slug: "fbos",
    label: "FBOs",
    headline: "The FBO front desk, systematized",
    sub: "Discovery flights, rentals, training partners, parts and fuel inventory, and a live picture of the field — one login.",
    image: "/marketing/operations.png",
    pains: [
      "Walk-ins booked on sticky notes",
      "Line service and front desk on different pages",
      "Inventory counted once a year, wrong all year",
      "No single view of what's happening on the ramp",
    ],
    features: [
      { title: "Operations board", body: "Every departure, arrival, and alert across the field in one live view — plus Mission Control for the lobby screen." },
      { title: "Discovery flight pipeline", body: "Public booking form feeds the CRM; convert prospects to renters or students in one click." },
      { title: "Inventory & parts ledger", body: "Parts, consumables, and fuel-adjacent stock with movement history and low-stock alerts." },
      { title: "Multi-activity billing", body: "Rentals, instruction, fees, and surcharges — automatic invoices with typed line items." },
      { title: "Maintenance coordination", body: "Work orders and inspection tracking for the shop next door or your own hangar." },
      { title: "Roles for every counter", body: "Front desk, dispatch, line, accounting — data-driven permissions per role." },
    ],
    activities: ["FBO", "Aircraft rental", "Discovery flights", "Fuel sales"],
  },
  {
    slug: "maintenance",
    label: "Maintenance",
    headline: "A maintenance system your DOM will actually sign",
    sub: "Squawk lifecycle, work orders with return-to-service signatures, inspection countdowns, and a parts ledger with full traceability.",
    image: "/marketing/maintenance.png",
    pains: [
      "Squawks living in text messages",
      "Inspection due times tracked in a binder",
      "Parts pulled with no record of where they went",
      "Return-to-service on a verbal okay",
    ],
    features: [
      { title: "Squawk lifecycle", body: "Open → in progress → resolved/deferred, with severity and airworthiness impact that the schedule respects." },
      { title: "Work orders", body: "Priorities, categories, labor hours, parts costs, corrective action, and electronic return-to-service approval." },
      { title: "Inspection radar", body: "Annual, 100-hour, oil, ELT, transponder, pitot-static, AD-driven items — hours- and date-based countdowns." },
      { title: "Parts traceability", body: "Every receive, install, remove, and scrap in an immutable movement ledger tied to work orders and tails." },
      { title: "Fleet health score", body: "A computed health score per tail with the factors that drive it." },
      { title: "Shop metrics", body: "Turn times, workload, and cost tracking for the maintenance operation itself." },
    ],
    activities: ["Maintenance (Part 145)", "Aircraft management"],
  },
  {
    slug: "corporate-flight-departments",
    label: "Corporate Flight Departments",
    headline: "Flight-department discipline without flight-department overhead",
    sub: "Trip scheduling, crew coordination, maintenance tracking, and executive reporting for the department that flies the company.",
    image: "/marketing/executive.png",
    pains: [
      "Trip requests by email and calendar invites",
      "Maintenance status living in the chief pilot's head",
      "No consolidated cost picture per aircraft",
      "Reporting to the CFO assembled by hand",
    ],
    features: [
      { title: "Trip & leg scheduling", body: "Aircraft-timeline scheduling with conflict detection across trips, crew, and maintenance windows." },
      { title: "Crew currency", body: "Certificates, medicals, and recurrent training tracked with expirations." },
      { title: "Maintenance coordination", body: "Inspection forecasting, work orders, and airworthiness status the schedule enforces." },
      { title: "Cost & utilization reporting", body: "Direct operating costs, utilization, and per-tail profitability views for the executive suite." },
      { title: "Document vault", body: "Insurance, registrations, manuals, and crew records with expirations." },
      { title: "Audit trail", body: "Every dispatch, change, and approval recorded — useful for IS-BAO-style process discipline." },
    ],
    activities: ["Corporate flight department", "Aircraft management"],
  },
];
