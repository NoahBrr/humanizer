import bcrypt from "bcryptjs";
import {
  Role, EventType, EventStatus, SquawkSeverity, SquawkStatus, MaintenanceStatus,
  DispatchStatus, InvoiceStatus, LineItemKind, PaymentMethod, NotificationKind,
  CertificateType, TrainingPart, AircraftStatus, LeadStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";
import { ORG_TEMPLATES, type OrgTemplateKey, type FleetMixEntry } from "@/lib/org-templates";
export { ORG_TEMPLATES, FLEET_SIZE_PRESETS, type OrgTemplateKey } from "@/lib/org-templates";

/**
 * Demo organization generator for the Founder Platform.
 *
 * Builds a fully-populated, isolated tenant from a business template: fleet,
 * staff, students/members, a two-week schedule window centered on today,
 * dispatch history, invoices & payments, squawks, maintenance, notifications
 * and documents. Everything is scoped to the new Organization, so generated
 * tenants never interfere with each other or with real customers.
 */



// --------------------------------------------------------------------------
// Name / identity pools
// --------------------------------------------------------------------------

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Hayden", "Peyton",
  "Sarah", "James", "Elena", "Marcus", "Aisha", "Diego", "Lily", "Sam", "Noah", "Emma",
  "Liam", "Olivia", "Ethan", "Ava", "Mason", "Sophia", "Lucas", "Isabella", "Henry", "Mia",
  "Priya", "Wei", "Kenji", "Fatima", "Omar", "Ingrid", "Mateo", "Nadia", "Viktor", "Amara",
  "Grace", "Owen", "Chloe", "Isaac", "Zoe", "Caleb", "Ruby", "Felix", "Nora", "Julian",
];
const LAST_NAMES = [
  "Morgan", "Reyes", "Ortiz", "Shah", "Chen", "Walker", "Petrov", "Nguyen", "Bell", "Khan",
  "Fuentes", "Anderson", "Whitfield", "Brooks", "Carter", "Diaz", "Ellis", "Foster", "Grant", "Hayes",
  "Ibarra", "Jensen", "Kim", "Lopez", "Murray", "Novak", "Osei", "Park", "Romero", "Silva",
  "Turner", "Ueda", "Vargas", "Watts", "Xiong", "Yates", "Zimmerman", "Okafor", "Lindqvist", "Marchetti",
];
const AIRPORTS = [
  { name: "Palo Alto Airport", icao: "KPAO", tz: "America/Los_Angeles" },
  { name: "Raleigh Executive Jetport", icao: "KTTA", tz: "America/New_York" },
  { name: "Centennial Airport", icao: "KAPA", tz: "America/Denver" },
  { name: "Addison Airport", icao: "KADS", tz: "America/Chicago" },
  { name: "Scottsdale Airport", icao: "KSDL", tz: "America/Phoenix" },
  { name: "DeKalb-Peachtree Airport", icao: "KPDK", tz: "America/New_York" },
  { name: "Boeing Field", icao: "KBFI", tz: "America/Los_Angeles" },
  { name: "Chesterfield County Airport", icao: "KFCI", tz: "America/New_York" },
];
const MX_TITLES = [
  "Oil change & filter", "100-hour inspection", "Annual inspection", "Brake pad replacement",
  "Tire replacement (main)", "ELT battery replacement", "Pitot-static certification",
  "Magneto inspection", "Alternator replacement", "Avionics database update",
];
const SQUAWK_TITLES: [string, SquawkSeverity][] = [
  ["Right magneto drop excessive", SquawkSeverity.GROUNDING],
  ["Nose strut low", SquawkSeverity.MINOR],
  ["Comm 2 static on transmit", SquawkSeverity.MINOR],
  ["Attitude indicator slow to erect", SquawkSeverity.MAJOR],
  ["MFD intermittent blank", SquawkSeverity.MAJOR],
  ["Beacon light inoperative", SquawkSeverity.MINOR],
  ["Left brake spongy", SquawkSeverity.MAJOR],
  ["Cabin door seal worn", SquawkSeverity.MINOR],
  ["Fuel gauge erratic (left)", SquawkSeverity.MINOR],
  ["Alternator overcharging", SquawkSeverity.GROUNDING],
];

// --------------------------------------------------------------------------
// Small utilities
// --------------------------------------------------------------------------

const rand = Math.random;
const rint = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const rnum = (min: number, max: number, dp = 1) => Math.round((rand() * (max - min) + min) * 10 ** dp) / 10 ** dp;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

const day = (offset: number, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const months = (n: number) => day(Math.round(n * 30.44));

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

async function uniqueSlug(base: string) {
  let slug = base;
  for (let i = 2; ; i++) {
    const existing = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
}

function randomTail() {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  return `N${rint(10, 999)}${pick([...letters])}${pick([...letters])}`;
}

async function uniqueTailNumbers(count: number) {
  const tails = new Set<string>();
  while (tails.size < count) tails.add(randomTail());
  const clashes = await db.aircraft.findMany({ where: { tailNumber: { in: [...tails] } }, select: { tailNumber: true } });
  for (const c of clashes) {
    tails.delete(c.tailNumber);
    while (true) {
      const t = randomTail();
      if (!tails.has(t)) { tails.add(t); break; }
    }
  }
  return [...tails];
}

// --------------------------------------------------------------------------
// Generator
// --------------------------------------------------------------------------

export type GenerateOptions = {
  name: string;
  template: OrgTemplateKey;
  fleetSize?: number;
  brandColor?: string;
  timeZone?: string;
  isDemo?: boolean;
  ownerEmail?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPassword?: string;
  /** Skip operational data — used by the wizard's "empty org" path. */
  seedData?: boolean;
  locations?: { name: string; icao?: string }[];
};

export type GenerateResult = {
  orgId: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  counts: Record<string, number>;
};

export async function generateOrganization(opts: GenerateOptions): Promise<GenerateResult> {
  const template = ORG_TEMPLATES[opts.template];
  const fleetSize = Math.min(Math.max(opts.fleetSize ?? template.defaultFleetSize, 1), 500);
  const seedData = opts.seedData !== false;
  const slug = await uniqueSlug(slugify(opts.name));
  const counts: Record<string, number> = {};

  const ownerPassword = opts.ownerPassword || "demo1234";
  const passwordHash = await bcrypt.hash(ownerPassword, 10);

  const plan = await db.subscriptionPlan.findFirst({ where: { name: template.plan } });
  const systemRoles = Object.entries(DEFAULT_ROLE_PERMISSIONS)
    .filter(([name]) => name !== "SUPER_ADMIN")
    .map(([name, permissions]) => ({ name, permissions: [...permissions], isSystem: true }));

  const org = await db.organization.create({
    data: {
      name: opts.name,
      slug,
      brandColor: opts.brandColor || "#1E63D0",
      timeZone: opts.timeZone || "America/New_York",
      planId: plan?.id,
      businessProfiles: template.businessProfiles,
      isDemo: opts.isDemo ?? true,
      orgRoles: { create: systemRoles },
      departments: { create: [{ name: "Dispatch" }, { name: "Maintenance" }, { name: "Training" }, { name: "Administration" }] },
    },
  });

  // --- Locations ----------------------------------------------------------
  const locationSpecs = opts.locations?.length
    ? opts.locations
    : (() => {
        const n = fleetSize >= 100 ? 3 : fleetSize >= 25 ? 2 : 1;
        const pool = [...AIRPORTS].sort(() => rand() - 0.5).slice(0, n);
        return pool.map((a) => ({ name: a.name, icao: a.icao }));
      })();
  const locations: { id: string }[] = [];
  for (const l of locationSpecs) {
    locations.push(await db.location.create({
      data: { organizationId: org.id, name: l.name, icao: l.icao, timeZone: opts.timeZone || "America/New_York" },
    }));
  }
  counts.locations = locations.length;

  // --- Owner + staff ------------------------------------------------------
  const ownerEmail = (opts.ownerEmail || `owner@${slug}.aerops.demo`).toLowerCase();
  const owner = await db.user.create({
    data: {
      organizationId: org.id, email: ownerEmail, passwordHash,
      firstName: opts.ownerFirstName || pick(FIRST_NAMES), lastName: opts.ownerLastName || pick(LAST_NAMES),
      role: Role.SCHOOL_ADMIN,
    },
  });
  await db.organization.update({ where: { id: org.id }, data: { ownerId: owner.id } });

  const usedEmails = new Set<string>([ownerEmail]);
  const mkEmail = (first: string, last: string) => {
    const base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
    let email = `${base}@${slug}.aerops.demo`;
    for (let i = 2; usedEmails.has(email); i++) email = `${base}${i}@${slug}.aerops.demo`;
    usedEmails.add(email);
    return email;
  };

  const staffRoles: Role[] = fleetSize >= 25
    ? [Role.DISPATCHER, Role.DISPATCHER, Role.MAINTENANCE, Role.MAINTENANCE, Role.ACCOUNTANT]
    : [Role.DISPATCHER, Role.MAINTENANCE, Role.ACCOUNTANT];
  for (const role of staffRoles) {
    const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
    await db.user.create({ data: { organizationId: org.id, email: mkEmail(first, last), passwordHash, firstName: first, lastName: last, role } });
  }
  counts.staff = staffRoles.length + 1;

  if (!seedData) {
    return { orgId: org.id, slug, ownerEmail, ownerPassword, counts };
  }

  // --- Instructors --------------------------------------------------------
  const instructorCount = Math.min(Math.max(Math.round(fleetSize * template.instructorRatio), template.training ? 2 : 1), 80);
  const instructors: { id: string; hourlyRate: number; name: string }[] = [];
  for (let i = 0; i < instructorCount; i++) {
    const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
    const u = await db.user.create({ data: { organizationId: org.id, email: mkEmail(first, last), passwordHash, firstName: first, lastName: last, role: Role.INSTRUCTOR } });
    const rate = rint(60, 110);
    const inst = await db.instructor.create({
      data: {
        userId: u.id,
        certificates: pick(["CFI", "CFI,CFII", "CFI,CFII,MEI"]),
        cfiNumber: `${rint(3, 4)}${rint(100000, 999999)}CFI`,
        cfiExpiration: months(rint(3, 22)), medicalExpiration: months(rint(2, 11)),
        hourlyRate: rate,
        availability: { create: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "18:00" })) },
      },
    });
    instructors.push({ id: inst.id, hourlyRate: rate, name: `${first} ${last}` });
  }
  counts.instructors = instructors.length;

  // --- Students / members / clients ---------------------------------------
  const studentCount = Math.min(Math.max(Math.round(fleetSize * template.peopleRatio), 6), 1200);
  const studentUserRows = Array.from({ length: studentCount }, () => {
    const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
    return { organizationId: org.id, email: mkEmail(first, last), passwordHash, firstName: first, lastName: last, role: Role.STUDENT };
  });
  await db.user.createMany({ data: studentUserRows });
  const studentUsers = await db.user.findMany({ where: { organizationId: org.id, role: Role.STUDENT }, select: { id: true } });
  await db.student.createMany({
    data: studentUsers.map((u) => ({
      userId: u.id,
      trainingGoal: pick(template.personaGoals),
      certificateHeld: template.training
        ? pick([CertificateType.NONE, CertificateType.STUDENT_PILOT, CertificateType.STUDENT_PILOT, CertificateType.PRIVATE, CertificateType.INSTRUMENT])
        : pick([CertificateType.NONE, CertificateType.PRIVATE]),
      trainingPart: template.key === "large-university" || template.key === "medium-flight-school" ? TrainingPart.PART_141 : TrainingPart.PART_61,
      medicalClass: pick(["First", "Second", "Third", "BasicMed"]),
      medicalExpiration: months(rint(1, 24)),
      tsaVerified: rand() > 0.1,
      assignedInstructorId: instructors.length && template.training ? pick(instructors).id : null,
      accountBalance: rnum(-1500, 800, 2),
      totalHours: rnum(0, template.training ? 250 : 1200, 1),
      soloHours: rnum(0, 20, 1),
    })),
  });
  const students = await db.student.findMany({ where: { user: { organizationId: org.id } }, select: { id: true, userId: true } });
  counts.students = students.length;

  // --- Fleet ---------------------------------------------------------------
  // Resolve/ create shared aircraft type rows
  const typeIds: { entry: FleetMixEntry; id: string }[] = [];
  for (const entry of template.fleetMix) {
    const t = await db.aircraftType.upsert({
      where: { manufacturer_model: { manufacturer: entry.manufacturer, model: entry.model } },
      update: {},
      create: { manufacturer: entry.manufacturer, model: entry.model, seats: entry.seats, engineType: entry.engineType ?? "Piston" },
    });
    typeIds.push({ entry, id: t.id });
  }

  const tails = await uniqueTailNumbers(fleetSize);
  const aircraftRows = tails.map((tail, i) => {
    // distribute across mix by cumulative share
    let acc = 0; const roll = (i + 0.5) / fleetSize;
    let chosen = typeIds[typeIds.length - 1];
    for (const t of typeIds) { acc += t.entry.share; if (roll <= acc) { chosen = t; break; } }
    const hobbs = rnum(400, 8000, 1);
    const statusRoll = rand();
    return {
      organizationId: org.id,
      locationId: pick(locations).id,
      aircraftTypeId: chosen.id,
      tailNumber: chosen.entry.sim ? `SIM-${i + 1}` : tail,
      year: rint(2005, 2024),
      hourlyRateWet: rnum(chosen.entry.wet[0], chosen.entry.wet[1], 0),
      hourlyRateDry: rnum(chosen.entry.wet[0] * 0.75, chosen.entry.wet[1] * 0.78, 0),
      fuelType: chosen.entry.sim ? "N/A" : chosen.entry.engineType === "Jet" || chosen.entry.engineType === "Turboprop" ? "Jet A" : "100LL",
      status: statusRoll > 0.94 ? AircraftStatus.GROUNDED : statusRoll > 0.86 ? AircraftStatus.IN_MAINTENANCE : AircraftStatus.AVAILABLE,
      currentHobbs: hobbs,
      currentTach: rnum(hobbs * 0.93, hobbs * 0.97, 1),
      engineTimeSmoh: rnum(hobbs * 0.2, hobbs * 0.6, 1),
      propTimeSpoh: rnum(hobbs * 0.1, hobbs * 0.5, 1),
      usefulLoadLbs: chosen.entry.sim ? null : rint(750, 2400),
      isSimulator: !!chosen.entry.sim,
      insuranceExpiration: months(rint(2, 11)),
      registrationExpiration: months(rint(6, 30)),
    };
  });
  await db.aircraft.createMany({ data: aircraftRows });
  const fleet = await db.aircraft.findMany({ where: { organizationId: org.id }, select: { id: true, tailNumber: true, hourlyRateWet: true, currentHobbs: true, isSimulator: true } });
  counts.aircraft = fleet.length;

  // Inspection components (skip simulators)
  const componentRows = fleet.filter((a) => !a.isSimulator).flatMap((a) => {
    const hobbs = Number(a.currentHobbs);
    return [
      { aircraftId: a.id, name: "Annual Inspection", intervalMonths: 12, lastDoneDate: months(-rint(1, 11)), dueAtDate: months(rint(1, 11)) },
      { aircraftId: a.id, name: "100 Hour Inspection", intervalHours: 100, lastDoneHours: hobbs - rint(10, 95), dueAtHours: hobbs + rint(5, 90) },
      { aircraftId: a.id, name: "Oil Change", intervalHours: 50, lastDoneHours: hobbs - rint(5, 45), dueAtHours: hobbs + rint(5, 45) },
      { aircraftId: a.id, name: "ELT Battery", intervalMonths: 24, dueAtDate: months(rint(2, 22)) },
      { aircraftId: a.id, name: "Transponder Check", intervalMonths: 24, dueAtDate: months(rint(2, 22)) },
    ];
  });
  await db.aircraftComponent.createMany({ data: componentRows });

  // --- Lesson types ---------------------------------------------------------
  const lessonTypeSpecs = template.training
    ? [
        { name: "Dual Flight Lesson", color: "#1E63D0", durationMin: 120 },
        { name: "Solo Flight", color: "#38A1E8", durationMin: 120, requiresInstructor: false },
        { name: "Ground Lesson", color: "#2E3A46", durationMin: 60, requiresAircraft: false },
        { name: "Simulator Session", color: "#7c3aed", durationMin: 90 },
        { name: "Checkride", color: "#ea580c", durationMin: 240 },
        { name: "Discovery Flight", color: "#0891b2", durationMin: 60 },
      ]
    : [
        { name: "Trip Leg", color: "#1E63D0", durationMin: 180, requiresInstructor: false },
        { name: "Owner Flight", color: "#38A1E8", durationMin: 120, requiresInstructor: false },
        { name: "Maintenance Reposition", color: "#2E3A46", durationMin: 60, requiresInstructor: false },
        { name: "Training / Currency", color: "#7c3aed", durationMin: 120 },
      ];
  const lessonTypes = [];
  for (const lt of lessonTypeSpecs) {
    lessonTypes.push(await db.lessonType.create({ data: { organizationId: org.id, ...lt } }));
  }

  // --- Syllabus (training orgs) ---------------------------------------------
  if (template.training) {
    const syllabus = await db.syllabus.create({
      data: {
        organizationId: org.id,
        name: "Private Pilot Certification Course",
        trainingPart: template.key === "large-university" || template.key === "medium-flight-school" ? TrainingPart.PART_141 : TrainingPart.PART_61,
        requiredHours: 40,
        description: "Structured private pilot course from first flight through checkride.",
        stages: {
          create: [
            { name: "Stage 1 — Pre-Solo", order: 1, lessons: { create: [
              { name: "L1: Familiarization & Basic Maneuvers", order: 1, minHours: 1.5 },
              { name: "L2: Slow Flight & Stalls", order: 2, minHours: 1.5 },
              { name: "L3: Traffic Pattern Operations", order: 3, minHours: 1.5 },
              { name: "L4: Emergency Procedures", order: 4, minHours: 1.5 },
            ] } },
            { name: "Stage 2 — Cross Country", order: 2, lessons: { create: [
              { name: "L5: First Solo", order: 1, minHours: 1.0 },
              { name: "L6: Navigation & Pilotage", order: 2, minHours: 2.0 },
              { name: "L7: Solo Cross-Country", order: 3, minHours: 2.5 },
            ] } },
            { name: "Stage 3 — Checkride Prep", order: 3, lessons: { create: [
              { name: "L8: Maneuver Polish", order: 1, minHours: 1.5 },
              { name: "L9: Mock Checkride", order: 2, minHours: 2.0 },
            ] } },
          ],
        },
      },
    });
    const enrollees = students.filter(() => rand() > 0.5).slice(0, 400);
    await db.syllabusEnrollment.createMany({ data: enrollees.map((s) => ({ studentId: s.id, syllabusId: syllabus.id })) });
    counts.enrollments = enrollees.length;
  }

  // --- Schedule window: -7 .. +7 days ---------------------------------------
  const flyable = fleet.filter((a) => !a.isSimulator);
  type EventRow = {
    organizationId: string; locationId: string; type: EventType; status: EventStatus;
    start: Date; end: Date; aircraftId: string | null; instructorId: string | null;
    studentId: string; lessonTypeId: string; title?: string; cancellationReason?: string;
  };
  const eventRows: EventRow[] = [];
  const flightsPerDay = Math.min(Math.max(Math.round(flyable.length * template.utilization), 4), 260);
  const primaryLt = lessonTypes[0];

  for (let d = -7; d <= 7; d++) {
    const dayCount = Math.round(flightsPerDay * (d === 0 ? 1 : rnum(0.7, 1.1, 2)));
    for (let i = 0; i < dayCount; i++) {
      const startHour = rint(7, 17);
      const durH = template.training ? pick([1.5, 2, 2]) : pick([1.5, 2.5, 3]);
      const ac = pick(flyable);
      const st = pick(students);
      const withInstructor = template.training ? rand() > 0.25 : rand() > 0.75;
      const inst = withInstructor && instructors.length ? pick(instructors) : null;
      const lt = template.training && rand() > 0.9 ? pick(lessonTypes) : primaryLt;
      let status: EventStatus;
      let cancellationReason: string | undefined;
      if (d < 0) {
        const roll = rand();
        status = roll > 0.93 ? EventStatus.WEATHER_CANCELLED : roll > 0.88 ? EventStatus.NO_SHOW : EventStatus.COMPLETED;
        if (status === EventStatus.WEATHER_CANCELLED) cancellationReason = pick(["IFR ceilings below minimums", "Gusts 28G38 across runway", "Thunderstorms within 10nm"]);
      } else if (d === 0) {
        status = startHour < 9 ? EventStatus.COMPLETED : startHour < 11 ? pick([EventStatus.DISPATCHED, EventStatus.IN_FLIGHT]) : EventStatus.SCHEDULED;
      } else {
        status = EventStatus.SCHEDULED;
      }
      eventRows.push({
        organizationId: org.id,
        locationId: pick(locations).id,
        type: template.training ? (inst ? EventType.FLIGHT_LESSON : EventType.SOLO_FLIGHT) : EventType.RENTAL,
        status,
        start: day(d, startHour), end: day(d, startHour + Math.floor(durH), (durH % 1) * 60),
        aircraftId: ac.id, instructorId: inst?.id ?? null, studentId: st.id, lessonTypeId: lt.id,
        cancellationReason,
      });
    }
  }
  await db.scheduleEvent.createMany({ data: eventRows });
  counts.scheduleEvents = eventRows.length;

  // --- Dispatch + billing for a bounded sample of completed flights ---------
  const completed = await db.scheduleEvent.findMany({
    where: { organizationId: org.id, status: EventStatus.COMPLETED },
    take: 250,
    orderBy: { start: "desc" },
    select: { id: true, start: true, end: true, aircraftId: true, instructorId: true, studentId: true },
  });
  const acById = new Map(fleet.map((a) => [a.id, a]));
  const instById = new Map(instructors.map((i) => [i.id, i]));
  const invoicePrefix = slug.replace(/[^a-z0-9]/g, "").slice(0, 6).toUpperCase();
  let invoiceNo = 1000;
  let paidRevenue = 0;

  for (const ev of completed) {
    if (!ev.aircraftId || !ev.studentId) continue;
    const ac = acById.get(ev.aircraftId)!;
    const flightTime = rnum(0.9, 2.4, 1);
    const hobbsOut = Math.max(Number(ac.currentHobbs) - rnum(5, 60, 1), 10);
    await db.dispatch.create({
      data: {
        scheduleEventId: ev.id, aircraftId: ev.aircraftId, studentId: ev.studentId, instructorId: ev.instructorId,
        status: DispatchStatus.CLOSED, fuelQty: "Full tanks", oilQty: `${rint(6, 8)} qt`,
        weatherAcknowledged: true, documentsVerified: true, instructorApproved: !!ev.instructorId, studentApproved: true,
        releasedAt: ev.start, releasedBy: "Dispatch", closedAt: ev.end,
        hobbsOut, hobbsIn: rnum(hobbsOut + flightTime, hobbsOut + flightTime, 1),
        flightTime, landings: rint(1, 8),
        dualReceived: ev.instructorId ? flightTime : null, dualGiven: ev.instructorId ? flightTime : null,
        picTime: ev.instructorId ? null : flightTime, fuelAddedGal: rnum(0, 30, 1),
      },
    });
    const cfiRate = ev.instructorId ? instById.get(ev.instructorId)?.hourlyRate ?? 70 : 0;
    const status = rand() > 0.3 ? InvoiceStatus.PAID : rand() > 0.5 ? InvoiceStatus.OPEN : InvoiceStatus.OVERDUE;
    const inv = await db.invoice.create({
      data: {
        organizationId: org.id, studentId: ev.studentId, number: `INV-${invoicePrefix}-${invoiceNo++}`,
        status, issuedAt: ev.end, dueAt: new Date(ev.end.getTime() + 14 * 86400_000),
        lines: {
          create: [
            { kind: LineItemKind.AIRCRAFT_RENTAL, description: `${ac.tailNumber} rental (wet) — ${flightTime.toFixed(1)} hrs`, quantity: flightTime, unitPrice: ac.hourlyRateWet },
            ...(ev.instructorId ? [{ kind: LineItemKind.INSTRUCTOR_TIME, description: `Instruction — ${(flightTime + 0.4).toFixed(1)} hrs`, quantity: flightTime + 0.4, unitPrice: cfiRate }] : []),
          ],
        },
      },
      include: { lines: true },
    });
    if (status === InvoiceStatus.PAID) {
      const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
      paidRevenue += total;
      await db.payment.create({
        data: { invoiceId: inv.id, amount: Math.round(total * 100) / 100, method: pick([PaymentMethod.CARD, PaymentMethod.CARD, PaymentMethod.ACH, PaymentMethod.ACCOUNT_CREDIT]), reference: `pi_${Math.random().toString(36).slice(2, 12)}`, paidAt: ev.end },
      });
    }
  }
  counts.dispatches = completed.length;
  counts.invoices = completed.length;

  // --- Squawks & maintenance -------------------------------------------------
  const squawkCount = Math.min(Math.max(Math.round(fleetSize * 0.6), 3), 45);
  await db.squawk.createMany({
    data: Array.from({ length: squawkCount }, () => {
      const [title, severity] = pick(SQUAWK_TITLES);
      const resolved = rand() > 0.6;
      return {
        aircraftId: pick(fleet).id, title, severity,
        status: resolved ? SquawkStatus.RESOLVED : pick([SquawkStatus.OPEN, SquawkStatus.OPEN, SquawkStatus.IN_PROGRESS, SquawkStatus.DEFERRED]),
        createdAt: day(-rint(0, 12), rint(7, 18)),
        resolvedAt: resolved ? day(-rint(0, 3), rint(8, 17)) : null,
        resolution: resolved ? "Repaired and ops-checked good." : null,
      };
    }),
  });
  counts.squawks = squawkCount;

  const mxCount = Math.min(Math.max(Math.round(fleetSize * 0.4), 3), 35);
  await db.maintenanceOrder.createMany({
    data: Array.from({ length: mxCount }, () => {
      const status = pick([MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.COMPLETED, MaintenanceStatus.COMPLETED]);
      const startOffset = status === MaintenanceStatus.SCHEDULED ? rint(1, 14) : -rint(1, 14);
      return {
        aircraftId: pick(fleet).id, title: pick(MX_TITLES), status,
        assignedTo: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        startDate: day(startOffset, 8), endDate: day(startOffset + rint(0, 3), 17),
        costParts: status === MaintenanceStatus.COMPLETED ? rnum(40, 2400, 2) : null,
        costLabor: status === MaintenanceStatus.COMPLETED ? rnum(80, 1600, 2) : null,
      };
    }),
  });
  counts.maintenanceOrders = mxCount;

  // --- Notifications -----------------------------------------------------------
  const notif = (kind: NotificationKind, title: string, body: string, d: number, h: number) =>
    ({ organizationId: org.id, kind, title, body, createdAt: day(d, h) });
  await db.notification.createMany({
    data: [
      notif(NotificationKind.MAINTENANCE_DUE, `${pick(fleet).tailNumber} 100-hour due soon`, "Plan the inspection around next week's schedule.", -1, 9),
      notif(NotificationKind.SQUAWK_REPORTED, `New squawk on ${pick(fleet).tailNumber}`, "Reported after morning flight — see maintenance queue.", -1, 15),
      notif(NotificationKind.BALANCE_DUE, "Overdue balances require attention", "Several accounts are past due — reminders sent.", 0, 8),
      notif(NotificationKind.WEATHER_CANCELLATION, "Weather cancellations yesterday", "Afternoon flights cancelled for IFR conditions.", -1, 12),
      notif(NotificationKind.UPCOMING_FLIGHT, "Busy day on the schedule", `${Math.round(flightsPerDay)} operations planned today.`, 0, 7),
      notif(NotificationKind.GENERAL, `Welcome to AeroOps, ${opts.name}!`, "Your organization has been provisioned.", 0, 6),
    ],
  });
  counts.notifications = 6;

  // --- Documents ------------------------------------------------------------
  await db.document.createMany({
    data: [
      { organizationId: org.id, ownerId: owner.id, kind: "RENTAL_AGREEMENT" as const, name: "Master Rental Agreement.pdf", fileUrl: "/documents/demo-rental.pdf" },
      { organizationId: org.id, aircraftId: fleet[0]?.id, kind: "INSURANCE" as const, name: `${fleet[0]?.tailNumber} Hull & Liability Policy.pdf`, fileUrl: "/documents/demo-insurance.pdf", expiresAt: months(rint(4, 11)) },
      { organizationId: org.id, aircraftId: fleet[0]?.id, kind: "MAINTENANCE_LOG" as const, name: `${fleet[0]?.tailNumber} Engine Logbook Extract.pdf`, fileUrl: "/documents/demo-mx.pdf" },
    ],
  });
  counts.documents = 3;
  counts.paidRevenue = Math.round(paidRevenue);

  // --- CRM leads -------------------------------------------------------------
  const leadCount = rint(6, 14);
  await db.lead.createMany({
    data: Array.from({ length: leadCount }, () => {
      const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
      return {
        organizationId: org.id,
        name: `${first} ${last}`,
        email: `${first}.${last}@example.com`.toLowerCase(),
        phone: `919-555-0${rint(100, 199)}`,
        source: pick(["website", "walk-in", "referral", "airshow", "instagram"]),
        interest: pick(template.personaGoals),
        status: pick([LeadStatus.NEW, LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.DISCOVERY_SCHEDULED, LeadStatus.DISCOVERY_COMPLETED]),
        estValue: rnum(500, 14000, 2),
        priority: rint(1, 5),
        nextFollowUp: day(rint(1, 10), 10),
      };
    }),
  });
  counts.leads = leadCount;

  // --- Parts inventory (orgs with a maintenance operation) --------------------
  if (fleetSize >= 5) {
    const partSpecs = [
      ["Aeroshell W100 Plus", "Oil", 14.5, 24], ["CH48110-1 Oil Filter", "Engine", 32, 12],
      ["Main Tire 6.00-6", "Tires", 145, 6], ["Brake Pad RA66-106", "Brakes", 38, 10],
      ["Spark Plug REM40E", "Engine", 29, 16], ["ELT Battery BP-2040", "Avionics", 89, 4],
      ["Vacuum Filter D9-18-1", "Instruments", 21, 8], ["Landing Light PAR36", "Electrical", 54, 6],
    ] as const;
    for (const [description, category, cost, qty] of partSpecs) {
      const part = await db.part.create({
        data: {
          organizationId: org.id,
          partNumber: `${category.slice(0, 2).toUpperCase()}-${rint(1000, 9999)}`,
          manufacturer: pick(["Champion", "Tempest", "Goodyear", "Cleveland", "Concorde"]),
          description, category, unitCost: cost,
          quantity: qty, minQuantity: Math.max(2, Math.floor(qty / 4)),
        },
      });
      await db.inventoryMovement.create({
        data: { partId: part.id, type: "RECEIVE", quantity: qty, notes: "Initial stock", performedBy: "Demo seed" },
      });
    }
    counts.parts = partSpecs.length;
  }

  return { orgId: org.id, slug, ownerEmail, ownerPassword, counts };
}
