/**
 * AeroOps demo seed. Creates one flight school with a realistic operating
 * picture: fleet, staff, students, a two-week schedule window centered on
 * today, dispatches, invoices, squawks, and notifications.
 *
 * All demo logins use the password `demo1234`.
 */
import { PrismaClient, Role, EventType, EventStatus, SquawkSeverity, SquawkStatus, MaintenanceStatus, DispatchStatus, InvoiceStatus, LineItemKind, PaymentMethod, NotificationKind, CertificateType, TrainingPart, CheckrideStatus, LessonGrade, DocumentKind, AircraftStatus, PlatformRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import path from "path";
import { hashToken } from "../src/lib/tokens";
import { systemOrgRoleSeed } from "../src/lib/permissions";

const db = new PrismaClient();

/**
 * Provision Membership rows + ACCOUNT_OWNER ownership for all seeded users by
 * running the exact deterministic D2 backfill migration, so demo data always
 * satisfies the ownership invariant (owner has an active ACCOUNT_OWNER
 * membership) without duplicating the logic here.
 */
async function backfillSeedMemberships() {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20260710032000_backfill_memberships_ownership/migration.sql"),
    "utf8",
  );
  const statements = sql
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await db.$executeRawUnsafe(stmt);
}

const day = (offset: number, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const months = (n: number) => day(Math.round(n * 30.44));

async function main() {
  console.log("Seeding AeroOps demo data...");
  // TRUNCATE ... CASCADE clears every dependent table regardless of FK order.
  await db.$executeRawUnsafe('TRUNCATE TABLE "Organization", "AircraftType", "PlatformUser", "SubscriptionPlan", "AuditLog" CASCADE');

  const password = await bcrypt.hash("demo1234", 10);

  // --- Subscription plans -------------------------------------------------
  const allModules = ["scheduling", "dispatch", "maintenance", "billing", "reports", "documents", "weather"];
  const [starter, professional] = await Promise.all([
    db.subscriptionPlan.create({ data: { name: "Starter", priceMonthly: 149, maxUsers: 25, maxAircraft: 5, maxLocations: 1, storageGb: 10, supportTier: "Standard", modules: ["scheduling", "dispatch", "billing", "documents"] } }),
    db.subscriptionPlan.create({ data: { name: "Professional", priceMonthly: 399, maxUsers: 150, maxAircraft: 25, maxLocations: 5, storageGb: 100, supportTier: "Priority", modules: allModules } }),
  ]);
  await db.subscriptionPlan.create({ data: { name: "Enterprise", priceMonthly: 999, maxUsers: 1000, maxAircraft: 200, maxLocations: 25, storageGb: 1000, supportTier: "Dedicated", modules: [...allModules, "ai_copilot", "inventory", "flight_following"] } });
  await db.subscriptionPlan.create({ data: { name: "University", priceMonthly: 1499, maxUsers: 2500, maxAircraft: 300, maxLocations: 10, storageGb: 2000, supportTier: "Dedicated", modules: [...allModules, "ai_copilot", "inventory", "flight_following"] } });

  // --- Platform staff (AeroOps employees — separate identity space) --------
  await db.platformUser.createMany({
    data: [
      { email: "founder@aerops.io", passwordHash: password, firstName: "Jordan", lastName: "Hale", role: PlatformRole.FOUNDER },
      { email: "support@aerops.io", passwordHash: password, firstName: "Riley", lastName: "Kim", role: PlatformRole.SUPPORT_ENGINEER },
      { email: "auditor@aerops.io", passwordHash: password, firstName: "Sam", lastName: "Osei", role: PlatformRole.AUDITOR },
    ],
  });

  const systemRoles = systemOrgRoleSeed();

  const org = await db.organization.create({
    data: {
      name: "Golden Gate Aviation Academy",
      slug: "golden-gate",
      brandColor: "#2563eb",
      timeZone: "America/Los_Angeles",
      planId: professional.id,
      businessProfiles: ["part_141", "part_61", "aircraft_rental", "discovery_flights"],
      orgRoles: {
        create: [
          ...systemRoles,
          { name: "Front Desk", description: "Custom role: scheduling and payments only", permissions: ["schedule.view", "schedule.create", "schedule.edit", "billing.record_payments", "notifications.view", "documents.view", "students.view"] },
        ],
      },
      departments: { create: [{ name: "Dispatch" }, { name: "Maintenance" }, { name: "Training" }, { name: "Administration" }] },
    },
  });

  const [kpao, ksql] = await Promise.all([
    db.location.create({ data: { organizationId: org.id, name: "Palo Alto Airport", icao: "KPAO", address: "1901 Embarcadero Rd, Palo Alto, CA", timeZone: "America/Los_Angeles" } }),
    db.location.create({ data: { organizationId: org.id, name: "San Carlos Airport", icao: "KSQL", address: "620 Airport Dr, San Carlos, CA", timeZone: "America/Los_Angeles" } }),
  ]);

  // --- Users -----------------------------------------------------------
  const mkUser = (email: string, first: string, last: string, role: Role, phone?: string) =>
    db.user.create({ data: { organizationId: org.id, email, passwordHash: password, firstName: first, lastName: last, role, phone } });

  const ggAdmin = await mkUser("admin@aerops.demo", "Alex", "Morgan", Role.SCHOOL_ADMIN, "650-555-0100");
  await db.organization.update({ where: { id: org.id }, data: { ownerId: ggAdmin.id } });
  await mkUser("dispatch@aerops.demo", "Dana", "Reyes", Role.DISPATCHER, "650-555-0101");
  await mkUser("maintenance@aerops.demo", "Miguel", "Ortiz", Role.MAINTENANCE, "650-555-0102");
  await mkUser("accounting@aerops.demo", "Priya", "Shah", Role.ACCOUNTANT, "650-555-0103");

  const instructorSpecs = [
    { email: "sarah.cfi@aerops.demo", first: "Sarah", last: "Chen", certs: "CFI,CFII", rate: 75 },
    { email: "james.cfi@aerops.demo", first: "James", last: "Walker", certs: "CFI,CFII,MEI", rate: 85 },
    { email: "elena.cfi@aerops.demo", first: "Elena", last: "Petrov", certs: "CFI", rate: 68 },
  ];
  const instructors = [];
  for (const s of instructorSpecs) {
    const u = await mkUser(s.email, s.first, s.last, Role.INSTRUCTOR);
    const i = await db.instructor.create({
      data: {
        userId: u.id, certificates: s.certs, cfiNumber: `4${Math.floor(100000 + Math.random() * 899999)}CFI`,
        cfiExpiration: months(14), medicalExpiration: months(9), hourlyRate: s.rate,
        availability: { create: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "18:00" })) },
      },
    });
    instructors.push({ ...i, user: u });
  }

  const studentSpecs = [
    { email: "student@aerops.demo", first: "Taylor", last: "Nguyen", goal: "Private Pilot", cert: CertificateType.STUDENT_PILOT, hours: 32.4, solo: 4.2, balance: -420.5, cfi: 0 },
    { email: "marcus.s@aerops.demo", first: "Marcus", last: "Bell", goal: "Private Pilot", cert: CertificateType.STUDENT_PILOT, hours: 14.8, solo: 0, balance: 250.0, cfi: 0 },
    { email: "aisha.s@aerops.demo", first: "Aisha", last: "Khan", goal: "Instrument Rating", cert: CertificateType.PRIVATE, hours: 96.2, solo: 0, balance: -1180.25, cfi: 1 },
    { email: "diego.s@aerops.demo", first: "Diego", last: "Fuentes", goal: "Private Pilot", cert: CertificateType.NONE, hours: 3.1, solo: 0, balance: 500.0, cfi: 2 },
    { email: "lily.s@aerops.demo", first: "Lily", last: "Anderson", goal: "Commercial Pilot", cert: CertificateType.INSTRUMENT, hours: 168.7, solo: 0, balance: 0, cfi: 1 },
    { email: "sam.s@aerops.demo", first: "Sam", last: "Whitfield", goal: "Private Pilot", cert: CertificateType.STUDENT_PILOT, hours: 41.9, solo: 8.6, balance: -95.0, cfi: 2 },
  ];
  const students = [];
  for (const s of studentSpecs) {
    const u = await mkUser(s.email, s.first, s.last, Role.STUDENT);
    const st = await db.student.create({
      data: {
        userId: u.id, trainingGoal: s.goal, certificateHeld: s.cert, trainingPart: TrainingPart.PART_141,
        medicalClass: "Third", medicalExpiration: months(6 + Math.floor(Math.random() * 18)),
        assignedInstructorId: instructors[s.cfi].id, accountBalance: s.balance,
        totalHours: s.hours, soloHours: s.solo, tsaVerified: true,
        leadSource: "referral",
        ftnNumber: `A${Math.floor(1000000 + Math.random() * 8999999)}`,
        writtenTestPassed: s.hours > 30 ? true : null,
        writtenTestScore: s.hours > 30 ? 85 + Math.floor(Math.random() * 10) : null,
        writtenTestDate: s.hours > 30 ? day(-45) : null,
        emergencyContact: "Family contact", emergencyPhone: "650-555-0199",
      },
    });
    students.push({ ...st, user: u });
  }

  // --- Fleet -----------------------------------------------------------
  const c172 = await db.aircraftType.create({ data: { manufacturer: "Cessna", model: "172S Skyhawk", seats: 4 } });
  const pa28 = await db.aircraftType.create({ data: { manufacturer: "Piper", model: "PA-28-181 Archer", seats: 4 } });
  const da40 = await db.aircraftType.create({ data: { manufacturer: "Diamond", model: "DA40 NG", seats: 4 } });
  const simType = await db.aircraftType.create({ data: { manufacturer: "Redbird", model: "FMX AATD", engineType: "Simulator", seats: 2 } });

  const mkComponents = (hobbs: number) => [
    { name: "Annual Inspection", intervalMonths: 12, lastDoneDate: months(-7), dueAtDate: months(5) },
    { name: "100 Hour Inspection", intervalHours: 100, lastDoneHours: hobbs - 62, dueAtHours: hobbs + 38 },
    { name: "Oil Change", intervalHours: 50, lastDoneHours: hobbs - 31, dueAtHours: hobbs + 19 },
    { name: "ELT Battery", intervalMonths: 24, dueAtDate: months(11) },
    { name: "Transponder Check", intervalMonths: 24, dueAtDate: months(16) },
    { name: "Pitot-Static Check", intervalMonths: 24, dueAtDate: months(16) },
    { name: "ADS-B Verification", intervalMonths: 24, dueAtDate: months(20) },
  ];

  const fleetSpecs = [
    { tail: "N735GG", type: c172.id, year: 2018, wet: 189, dry: 145, hobbs: 3412.6, tach: 3298.1, status: AircraftStatus.AVAILABLE, loc: kpao.id },
    { tail: "N204SP", type: c172.id, year: 2016, wet: 179, dry: 139, hobbs: 4820.3, tach: 4691.7, status: AircraftStatus.AVAILABLE, loc: kpao.id },
    { tail: "N88AR", type: pa28.id, year: 2019, wet: 195, dry: 152, hobbs: 2101.4, tach: 2044.9, status: AircraftStatus.AVAILABLE, loc: ksql.id },
    { tail: "N417DA", type: da40.id, year: 2022, wet: 239, dry: 189, hobbs: 892.5, tach: 861.2, status: AircraftStatus.IN_MAINTENANCE, loc: kpao.id },
    { tail: "N156GG", type: c172.id, year: 2014, wet: 169, dry: 132, hobbs: 6234.8, tach: 6100.4, status: AircraftStatus.GROUNDED, loc: ksql.id },
    { tail: "SIM-1", type: simType.id, year: 2021, wet: 95, dry: 95, hobbs: 1420.0, tach: 1420.0, status: AircraftStatus.AVAILABLE, loc: kpao.id, sim: true },
  ];
  const fleet = [];
  for (const f of fleetSpecs) {
    const a = await db.aircraft.create({
      data: {
        organizationId: org.id, locationId: f.loc, aircraftTypeId: f.type, tailNumber: f.tail,
        nickname: f.sim ? "The Box" : undefined,
        serialNumber: `17S${Math.floor(10000 + Math.random() * 89999)}`,
        ownershipType: f.tail === "N88AR" ? "LEASEBACK" : "SCHOOL_OWNED",
        ownerName: f.tail === "N88AR" ? "Archer Partners LLC" : undefined,
        engineModel: f.sim ? undefined : "Lycoming IO-360-L2A", engineSerial: f.sim ? undefined : `L-${Math.floor(10000 + Math.random() * 89999)}-51E`,
        propManufacturer: f.sim ? undefined : "McCauley", propSerial: f.sim ? undefined : `MC${Math.floor(100000 + Math.random() * 899999)}`,
        emptyWeightLbs: f.sim ? undefined : 1680, maxGrossWeightLbs: f.sim ? undefined : 2558,
        fuelCapacityGal: f.sim ? undefined : 53, cruiseSpeedKts: f.sim ? undefined : 122,
        fuelSurchargePerHr: f.sim ? undefined : 8, insuranceCostMonthly: f.sim ? 150 : 620,
        estimatedHourlyCost: f.sim ? 25 : 92,
        year: f.year, hourlyRateWet: f.wet, hourlyRateDry: f.dry, status: f.status,
        currentHobbs: f.hobbs, currentTach: f.tach, engineTimeSmoh: f.hobbs * 0.4, propTimeSpoh: f.hobbs * 0.3,
        usefulLoadLbs: f.sim ? null : 878, fuelType: f.sim ? "N/A" : "100LL", isSimulator: !!f.sim,
        insuranceExpiration: months(8), registrationExpiration: months(22),
        components: f.sim ? undefined : { create: mkComponents(f.hobbs) },
      },
    });
    fleet.push(a);
  }

  // Squawks
  await db.squawk.createMany({
    data: [
      { aircraftId: fleet[4].id, title: "Right magneto drop 300 RPM", description: "Excessive mag drop on runup, aborted flight.", severity: SquawkSeverity.GROUNDING, status: SquawkStatus.IN_PROGRESS, createdAt: day(-2, 10) },
      { aircraftId: fleet[3].id, title: "G1000 MFD intermittent blank", description: "MFD flickers off in cruise, returns after ~10s.", category: "Avionics", assignedTo: "Miguel Ortiz", severity: SquawkSeverity.MAJOR, status: SquawkStatus.WAITING_PARTS, createdAt: day(-1, 15) },
      { aircraftId: fleet[0].id, title: "Pilot-side sun visor loose", severity: SquawkSeverity.MINOR, status: SquawkStatus.OPEN, createdAt: day(-3, 12) },
      { aircraftId: fleet[1].id, title: "Nose strut low", description: "Serviced with nitrogen, monitoring.", severity: SquawkSeverity.MINOR, status: SquawkStatus.RESOLVED, createdAt: day(-9, 9), resolvedAt: day(-7, 14), resolution: "Strut serviced, leak check OK." },
      { aircraftId: fleet[2].id, title: "Comm 2 static on transmit", severity: SquawkSeverity.MINOR, status: SquawkStatus.OPEN, createdAt: day(-1, 8) },
    ],
  });

  await db.maintenanceOrder.createMany({
    data: [
      { aircraftId: fleet[3].id, number: "WO-100481", title: "100-hour inspection", description: "Routine 100-hour with oil change and compression check.", category: "Routine Inspection", priority: "HIGH", status: MaintenanceStatus.IN_PROGRESS, assignedTo: "Miguel Ortiz", startDate: day(-1, 8), estimatedCompletion: day(1, 17) },
      { aircraftId: fleet[4].id, number: "WO-100482", title: "Magneto replacement", description: "Replace right magneto, timing check both.", category: "Engine", priority: "AOG", status: MaintenanceStatus.AWAITING_INSPECTION, assignedTo: "Miguel Ortiz", startDate: day(-2, 13), estimatedCompletion: day(1, 12), costParts: 1450, costLabor: 680, laborHours: 6.5 },
      { aircraftId: fleet[0].id, title: "Oil change", status: MaintenanceStatus.SCHEDULED, startDate: day(6, 8), endDate: day(6, 12) },
      { aircraftId: fleet[1].id, title: "Annual inspection", status: MaintenanceStatus.SCHEDULED, startDate: day(18, 8), endDate: day(22, 17) },
      { aircraftId: fleet[1].id, title: "Nose strut service", status: MaintenanceStatus.COMPLETED, startDate: day(-8, 9), endDate: day(-7, 14), costParts: 40, costLabor: 190 },
    ],
  });

  // --- Parts inventory (Section 15B) ------------------------------------
  const oil = await db.part.create({
    data: { organizationId: org.id, partNumber: "PH-20W50", manufacturer: "Phillips 66", description: "X/C 20W-50 aviation oil (qt)", category: "Consumable", unitCost: 9.85, quantity: 34, minQuantity: 24, maxQuantity: 96, location: "A1-3" },
  });
  await db.part.createMany({
    data: [
      { organizationId: org.id, partNumber: "REM40E", manufacturer: "Champion", description: "REM40E spark plug", category: "Engine", unitCost: 32.5, quantity: 6, minQuantity: 8, maxQuantity: 32, location: "B2-1" },
      { organizationId: org.id, partNumber: "AA48108-2", manufacturer: "Tempest", description: "Oil filter", category: "Consumable", unitCost: 28.9, quantity: 11, minQuantity: 6, maxQuantity: 24, location: "A1-4" },
      { organizationId: org.id, partNumber: "606C61-8", manufacturer: "Michelin", description: "Air 6.00-6 6-ply main tire", category: "Landing Gear", unitCost: 189, quantity: 4, minQuantity: 2, maxQuantity: 8, location: "C4-2" },
      { organizationId: org.id, partNumber: "RA66-106", manufacturer: "Rapco", description: "Brake pad set", category: "Landing Gear", unitCost: 42, quantity: 3, minQuantity: 4, location: "C4-5" },
      { organizationId: org.id, partNumber: "10-357290", manufacturer: "Slick", description: "4371 magneto", condition: "OVERHAULED", category: "Engine", unitCost: 1450, quantity: 1, minQuantity: 1, location: "SEC-1" },
    ],
  });
  await db.inventoryMovement.createMany({
    data: [
      { partId: oil.id, type: "RECEIVE", quantity: 48, notes: "PO-2214 — Aircraft Spruce", performedBy: "Miguel Ortiz", createdAt: day(-12, 10) },
      { partId: oil.id, type: "INSTALL", quantity: -8, notes: "100-hr oil change N204SP", performedBy: "Miguel Ortiz", createdAt: day(-8, 15) },
      { partId: oil.id, type: "INSTALL", quantity: -6, notes: "Oil change N735GG", performedBy: "Dana Wells", createdAt: day(-3, 11) },
    ],
  });

  // --- Lesson types & syllabus ------------------------------------------
  const ltFlight = await db.lessonType.create({ data: { organizationId: org.id, name: "Dual Flight Lesson", color: "#2563eb", durationMin: 120 } });
  const ltSolo = await db.lessonType.create({ data: { organizationId: org.id, name: "Solo Flight", color: "#0891b2", durationMin: 120, requiresInstructor: false } });
  const ltGround = await db.lessonType.create({ data: { organizationId: org.id, name: "Ground Lesson", color: "#7c3aed", durationMin: 60, requiresAircraft: false } });
  const ltSim = await db.lessonType.create({ data: { organizationId: org.id, name: "Simulator Session", color: "#db2777", durationMin: 90 } });
  const ltCheckride = await db.lessonType.create({ data: { organizationId: org.id, name: "Checkride", color: "#ea580c", durationMin: 240 } });

  const syllabus = await db.syllabus.create({
    data: {
      organizationId: org.id, name: "Private Pilot — Part 141", trainingPart: TrainingPart.PART_141, requiredHours: 35,
      description: "FAA-approved Part 141 private pilot certification course.",
      stages: {
        create: [
          { name: "Stage 1 — Pre-Solo", order: 1, lessons: { create: [
            { name: "L1: Familiarization & Basic Maneuvers", order: 1, minHours: 1.5, objective: "Aircraft familiarization, straight and level, climbs, descents." },
            { name: "L2: Slow Flight & Stalls", order: 2, minHours: 1.5, objective: "MCA flight, power-off and power-on stalls." },
            { name: "L3: Ground Reference Maneuvers", order: 3, minHours: 1.5, objective: "Turns around a point, S-turns, rectangular course." },
            { name: "L4: Traffic Pattern Operations", order: 4, minHours: 1.5, objective: "Normal takeoffs and landings, go-arounds." },
            { name: "L5: Emergency Procedures", order: 5, minHours: 1.5, objective: "Engine-out procedures, emergency descents." },
            { name: "L6: Pre-Solo Review", order: 6, minHours: 1.5, objective: "Solo readiness evaluation." },
          ] } },
          { name: "Stage 1 Check", order: 2, isStageCheck: true, lessons: { create: [
            { name: "Stage 1 Check Flight", order: 1, minHours: 1.5, objective: "Demonstrate pre-solo proficiency to chief instructor." },
          ] } },
          { name: "Stage 2 — Cross Country", order: 3, lessons: { create: [
            { name: "L7: First Solo & Pattern Work", order: 1, minHours: 1.0 },
            { name: "L8: Navigation & Pilotage", order: 2, minHours: 2.0 },
            { name: "L9: Dual Cross-Country", order: 3, minHours: 2.5 },
            { name: "L10: Night Flying", order: 4, minHours: 2.0 },
            { name: "L11: Solo Cross-Country", order: 5, minHours: 2.5 },
          ] } },
          { name: "Stage 3 — Checkride Prep", order: 4, lessons: { create: [
            { name: "L12: Maneuver Polish", order: 1, minHours: 1.5 },
            { name: "L13: Mock Checkride", order: 2, minHours: 2.0 },
          ] } },
        ],
      },
    },
    include: { stages: { include: { lessons: true }, orderBy: { order: "asc" } } },
  });
  const allLessons = syllabus.stages.flatMap((s) => s.lessons.sort((a, b) => a.order - b.order));

  for (const st of [students[0], students[1], students[3], students[5]]) {
    await db.syllabusEnrollment.create({ data: { studentId: st.id, syllabusId: syllabus.id } });
  }

  // Lesson records for the primary demo student (Taylor)
  const taylor = students[0];
  for (let i = 0; i < 8; i++) {
    await db.lessonRecord.create({
      data: {
        studentId: taylor.id, instructorId: instructors[0].id, syllabusLessonId: allLessons[Math.min(i, allLessons.length - 1)].id,
        date: day(-60 + i * 7, 10), grade: i === 4 ? LessonGrade.NEEDS_IMPROVEMENT : LessonGrade.SATISFACTORY,
        flightHours: 1.4 + (i % 3) * 0.2, groundHours: 0.5,
        notes: i === 4 ? "Landings flat; more energy management work needed. Repeat L5 elements next lesson." : "Met lesson objectives. Good progress on coordination and checklist discipline.",
        signedByInstructor: true, signedByStudent: true,
      },
    });
  }

  await db.endorsement.create({
    data: {
      studentId: taylor.id, instructorId: instructors[0].id, title: "Pre-solo aeronautical knowledge", farReference: "61.87(b)",
      text: "I certify that Taylor Nguyen has satisfactorily completed the pre-solo knowledge test of 61.87(b) for the Cessna 172S.",
      signedAt: day(-35),
    },
  });
  await db.endorsement.create({
    data: {
      studentId: taylor.id, instructorId: instructors[0].id, title: "Solo flight (90-day)", farReference: "61.87(n)",
      text: "I certify that Taylor Nguyen has received the required training to qualify for solo flying in the Cessna 172S.",
      signedAt: day(-20), expiresAt: day(70),
    },
  });
  await db.studentRating.create({ data: { studentId: students[2].id, rating: CertificateType.PRIVATE, earnedAt: day(-400) } });
  await db.studentRating.create({ data: { studentId: students[4].id, rating: CertificateType.PRIVATE, earnedAt: day(-700) } });
  await db.studentRating.create({ data: { studentId: students[4].id, rating: CertificateType.INSTRUMENT, earnedAt: day(-200) } });

  await db.checkride.createMany({
    data: [
      { studentId: taylor.id, instructorId: instructors[0].id, rating: CertificateType.PRIVATE, examinerName: "DPE Robert Hayes", date: day(12, 9), status: CheckrideStatus.SCHEDULED },
      { studentId: students[4].id, instructorId: instructors[1].id, rating: CertificateType.COMMERCIAL, examinerName: "DPE Maria Santos", date: day(21, 8), status: CheckrideStatus.SCHEDULED },
      { studentId: students[2].id, instructorId: instructors[1].id, rating: CertificateType.PRIVATE, examinerName: "DPE Robert Hayes", date: day(-400), status: CheckrideStatus.PASSED },
    ],
  });

  // --- Schedule: -7 days .. +7 days -------------------------------------
  type Slot = { d: number; h: number; dur: number; st: number; cfi: number | null; ac: number | null; type: EventType; lt: string; status?: EventStatus; cancel?: string };
  const slots: Slot[] = [];
  // Past week: completed flights
  for (let d = -7; d < 0; d++) {
    if (d % 7 === -3) continue;
    slots.push({ d, h: 8, dur: 2, st: 0, cfi: 0, ac: 0, type: EventType.FLIGHT_LESSON, lt: ltFlight.id, status: EventStatus.COMPLETED });
    slots.push({ d, h: 11, dur: 2, st: 2, cfi: 1, ac: 1, type: EventType.FLIGHT_LESSON, lt: ltFlight.id, status: EventStatus.COMPLETED });
    slots.push({ d, h: 14, dur: 2, st: 5, cfi: 2, ac: 2, type: EventType.FLIGHT_LESSON, lt: ltFlight.id, status: d === -2 ? EventStatus.WEATHER_CANCELLED : EventStatus.COMPLETED, cancel: d === -2 ? "IFR ceilings below minimums" : undefined });
    if (d % 2 === 0) slots.push({ d, h: 16, dur: 1, st: 3, cfi: 2, ac: null, type: EventType.GROUND_LESSON, lt: ltGround.id, status: EventStatus.COMPLETED });
  }
  // Today
  slots.push({ d: 0, h: 7, dur: 2, st: 0, cfi: 0, ac: 0, type: EventType.FLIGHT_LESSON, lt: ltFlight.id, status: EventStatus.COMPLETED });
  slots.push({ d: 0, h: 9, dur: 2, st: 1, cfi: 0, ac: 1, type: EventType.FLIGHT_LESSON, lt: ltFlight.id, status: EventStatus.DISPATCHED });
  slots.push({ d: 0, h: 10, dur: 2, st: 5, cfi: null, ac: 2, type: EventType.SOLO_FLIGHT, lt: ltSolo.id, status: EventStatus.IN_FLIGHT });
  slots.push({ d: 0, h: 13, dur: 2, st: 2, cfi: 1, ac: 0, type: EventType.FLIGHT_LESSON, lt: ltFlight.id });
  slots.push({ d: 0, h: 14, dur: 1.5, st: 3, cfi: 2, ac: 5, type: EventType.SIMULATOR, lt: ltSim.id });
  slots.push({ d: 0, h: 16, dur: 2, st: 4, cfi: 1, ac: 1, type: EventType.FLIGHT_LESSON, lt: ltFlight.id });
  // Upcoming week
  for (let d = 1; d <= 7; d++) {
    if (d % 7 === 4) continue;
    slots.push({ d, h: 8, dur: 2, st: (d + 1) % 6, cfi: d % 3, ac: d % 3, type: EventType.FLIGHT_LESSON, lt: ltFlight.id });
    slots.push({ d, h: 11, dur: 2, st: (d + 3) % 6, cfi: (d + 1) % 3, ac: (d + 1) % 3, type: EventType.FLIGHT_LESSON, lt: ltFlight.id });
    if (d % 2 === 1) slots.push({ d, h: 14, dur: 1.5, st: (d + 2) % 6, cfi: (d + 2) % 3, ac: 5, type: EventType.SIMULATOR, lt: ltSim.id });
    if (d % 2 === 0) slots.push({ d, h: 15, dur: 1, st: (d + 4) % 6, cfi: d % 3, ac: null, type: EventType.GROUND_LESSON, lt: ltGround.id });
  }
  slots.push({ d: 12, h: 9, dur: 4, st: 0, cfi: 0, ac: 0, type: EventType.CHECKRIDE, lt: ltCheckride.id });

  const events = [];
  for (const s of slots) {
    const ev = await db.scheduleEvent.create({
      data: {
        organizationId: org.id, locationId: kpao.id, type: s.type, status: s.status ?? EventStatus.SCHEDULED,
        start: day(s.d, s.h), end: day(s.d, s.h + Math.floor(s.dur), (s.dur % 1) * 60),
        aircraftId: s.ac === null ? null : fleet[s.ac].id,
        instructorId: s.cfi === null ? null : instructors[s.cfi].id,
        studentId: students[s.st].id, lessonTypeId: s.lt,
        cancellationReason: s.cancel,
      },
    });
    events.push({ ev, s });
  }

  // Dispatches: closed for completed flights, released for the dispatched one
  let invoiceCounter = 1041;
  for (const { ev, s } of events) {
    if (!ev.aircraftId || s.type === EventType.GROUND_LESSON) continue;
    const ac = fleet[s.ac!];
    if (ev.status === EventStatus.COMPLETED) {
      const hobbsOut = Number(ac.currentHobbs) - Math.random() * 40 - 5;
      const flightTime = Math.round((1.1 + Math.random() * 0.7) * 10) / 10;
      await db.dispatch.create({
        data: {
          scheduleEventId: ev.id, aircraftId: ev.aircraftId, studentId: ev.studentId, instructorId: ev.instructorId,
          status: DispatchStatus.CLOSED, fuelQty: "Full tanks (53 gal)", oilQty: "7 qt",
          weatherAcknowledged: true, documentsVerified: true, instructorApproved: true, studentApproved: true,
          releasedAt: ev.start, releasedBy: "Dana Reyes", closedAt: ev.end,
          hobbsOut: Math.round(hobbsOut * 10) / 10, hobbsIn: Math.round((hobbsOut + flightTime) * 10) / 10,
          tachOut: Math.round((hobbsOut - 110) * 10) / 10, tachIn: Math.round((hobbsOut - 110 + flightTime * 0.9) * 10) / 10,
          flightTime, landings: 3 + Math.floor(Math.random() * 6),
          dualReceived: ev.instructorId ? flightTime : null, dualGiven: ev.instructorId ? flightTime : null,
          picTime: ev.instructorId ? null : flightTime, fuelAddedGal: Math.round(Math.random() * 15 * 10) / 10,
        },
      });
      // Invoice generated from the completed flight
      const stRec = students[s.st];
      const cfiRate = s.cfi !== null ? Number(instructors[s.cfi].hourlyRate) : 0;
      const inv = await db.invoice.create({
        data: {
          organizationId: org.id, studentId: stRec.id, number: `INV-${invoiceCounter++}`,
          status: Math.random() > 0.35 ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
          issuedAt: ev.end, dueAt: day(s.d + 14, 17),
          lines: {
            create: [
              { kind: LineItemKind.AIRCRAFT_RENTAL, description: `${ac.tailNumber} rental (wet) — ${flightTime.toFixed(1)} hrs`, quantity: flightTime, unitPrice: ac.hourlyRateWet },
              ...(s.cfi !== null ? [{ kind: LineItemKind.INSTRUCTOR_TIME, description: `Flight instruction — ${(flightTime + 0.5).toFixed(1)} hrs`, quantity: flightTime + 0.5, unitPrice: cfiRate }] : []),
            ],
          },
        },
        include: { lines: true },
      });
      if (inv.status === InvoiceStatus.PAID) {
        const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
        await db.payment.create({ data: { invoiceId: inv.id, amount: Math.round(total * 100) / 100, method: PaymentMethod.CARD, reference: `pi_${Math.random().toString(36).slice(2, 12)}`, paidAt: ev.end } });
      }
    } else if (ev.status === EventStatus.DISPATCHED || ev.status === EventStatus.IN_FLIGHT) {
      await db.dispatch.create({
        data: {
          scheduleEventId: ev.id, aircraftId: ev.aircraftId, studentId: ev.studentId, instructorId: ev.instructorId,
          status: DispatchStatus.RELEASED, fuelQty: "Full tanks (53 gal)", oilQty: "7 qt",
          weatherAcknowledged: true, documentsVerified: true, instructorApproved: true, studentApproved: true,
          releasedAt: ev.start, releasedBy: "Dana Reyes",
          hobbsOut: Number(ac.currentHobbs), tachOut: Number(ac.currentTach),
        },
      });
    } else if (ev.status === EventStatus.SCHEDULED && s.d === 0) {
      await db.dispatch.create({
        data: { scheduleEventId: ev.id, aircraftId: ev.aircraftId, studentId: ev.studentId, instructorId: ev.instructorId, status: DispatchStatus.PENDING },
      });
    }
  }

  // A standing membership invoice that is overdue
  await db.invoice.create({
    data: {
      organizationId: org.id, studentId: students[2].id, number: `INV-${invoiceCounter++}`, status: InvoiceStatus.OVERDUE,
      issuedAt: day(-40), dueAt: day(-10), memo: "Monthly club membership",
      lines: { create: [{ kind: LineItemKind.MEMBERSHIP_FEE, description: "Club membership — monthly", quantity: 1, unitPrice: 89 }, { kind: LineItemKind.LATE_FEE, description: "Late fee", quantity: 1, unitPrice: 15 }] },
    },
  });

  // Discovery-flight lead (lifecycle demo)
  const leadUser = await mkUser("lead@aerops.demo", "Jordan", "Reyes", Role.STUDENT);
  await db.student.create({
    data: {
      userId: leadUser.id, status: "DISCOVERY_FLIGHT", leadSource: "airshow booth",
      discoveryFlightAt: day(-4, 14), discoveryOutcome: "interested — follow up next week",
      trainingGoal: "Private Pilot", trainingPart: TrainingPart.PART_61,
    },
  });

  // --- CRM leads --------------------------------------------------------------
  await db.lead.createMany({
    data: [
      { organizationId: org.id, name: "Chris Alvarez", email: "chris.a@example.com", phone: "650-555-0142", source: "website", interest: "Private Pilot", status: "NEW", estValue: 14000, priority: 2, nextFollowUp: day(0, 12) },
      { organizationId: org.id, name: "Dana Whitmore", email: "dana.w@example.com", source: "google", interest: "Discovery flight", status: "CONTACTED", estValue: 250, priority: 3, nextFollowUp: day(1, 10) },
      { organizationId: org.id, name: "Pat Okafor", email: "pat.o@example.com", source: "referral", interest: "Instrument Rating", status: "DISCOVERY_SCHEDULED", estValue: 9000, priority: 1, nextFollowUp: day(2, 9) },
      { organizationId: org.id, name: "Kim Nakamura", email: "kim.n@example.com", source: "airshow", interest: "Private Pilot", status: "DISCOVERY_COMPLETED", estValue: 14000, priority: 1, notes: "Loved the flight — ready to enroll, asked about financing.", nextFollowUp: day(-1, 15) },
      { organizationId: org.id, name: "Lee Fontaine", email: "lee.f@example.com", source: "facebook", interest: "Discovery flight", status: "LOST", priority: 4 },
    ],
  });

  // --- Lesson requests & waitlist ------------------------------------------
  await db.lessonRequest.create({
    data: {
      organizationId: org.id, studentId: students[1].id, preferredStart: day(3, 15), durationMin: 120,
      lessonTypeId: ltFlight.id, instructorId: instructors[0].id, notes: "Would love pattern work before my stage check.",
    },
  });
  await db.lessonRequest.create({
    data: { organizationId: org.id, studentId: students[3].id, preferredStart: day(5, 9), durationMin: 90, lessonTypeId: ltGround.id },
  });
  await db.waitlistEntry.create({
    data: { organizationId: org.id, studentId: students[5].id, date: day(1, 0), notes: "Any aircraft, any CFI." },
  });

  // --- Notifications ------------------------------------------------------
  await db.notification.createMany({
    data: [
      { organizationId: org.id, kind: NotificationKind.AIRCRAFT_GROUNDED, title: "N156GG grounded", body: "Right magneto failure — removed from schedule until repair is complete.", createdAt: day(-2, 10, 30) },
      { organizationId: org.id, kind: NotificationKind.MAINTENANCE_DUE, title: "N204SP 100-hour due in 38 hrs", body: "Plan the inspection around next week's schedule.", createdAt: day(-1, 9) },
      { organizationId: org.id, kind: NotificationKind.SQUAWK_REPORTED, title: "New squawk on N417DA", body: "G1000 MFD intermittent blank — reported by James Walker.", createdAt: day(-1, 15, 5) },
      { organizationId: org.id, kind: NotificationKind.WEATHER_CANCELLATION, title: "Weather cancellation", body: "1400 lesson with Sam Whitfield cancelled — IFR ceilings.", createdAt: day(-2, 12) },
      { organizationId: org.id, kind: NotificationKind.BALANCE_DUE, title: "Overdue balance: Aisha Khan", body: "INV overdue by 10 days ($104.00). Reminder email sent.", createdAt: day(0, 8) },
      { organizationId: org.id, kind: NotificationKind.UPCOMING_FLIGHT, title: "Checkride in 12 days", body: "Taylor Nguyen — Private Pilot checkride with DPE Robert Hayes.", createdAt: day(0, 7) },
      { organizationId: org.id, kind: NotificationKind.DOCUMENT_EXPIRING, title: "Medical expiring soon", body: "Sarah Chen's medical certificate expires in under 9 months.", createdAt: day(-4, 11) },
    ],
  });

  await db.document.createMany({
    data: [
      { organizationId: org.id, ownerId: taylor.userId, kind: DocumentKind.MEDICAL_CERTIFICATE, name: "Third Class Medical — Taylor Nguyen.pdf", fileUrl: "/documents/demo-medical.pdf", expiresAt: months(14) },
      { organizationId: org.id, ownerId: taylor.userId, kind: DocumentKind.GOVERNMENT_ID, name: "Driver License — Taylor Nguyen.pdf", fileUrl: "/documents/demo-id.pdf", expiresAt: months(30) },
      { organizationId: org.id, aircraftId: fleet[0].id, kind: DocumentKind.INSURANCE, name: "N735GG Hull & Liability Policy.pdf", fileUrl: "/documents/demo-insurance.pdf", expiresAt: months(8) },
      { organizationId: org.id, aircraftId: fleet[0].id, kind: DocumentKind.MAINTENANCE_LOG, name: "N735GG Engine Logbook Extract.pdf", fileUrl: "/documents/demo-mx.pdf" },
    ],
  });

  // --- Second organization: proves tenant isolation end to end -------------
  const blueRidge = await db.organization.create({
    data: {
      name: "Blue Ridge Flying Club",
      slug: "blue-ridge",
      brandColor: "#0891b2",
      timeZone: "America/New_York",
      planId: starter.id,
      businessProfiles: ["flying_club", "aircraft_rental"],
      orgRoles: { create: systemRoles },
      locations: { create: { name: "Asheville Regional", icao: "KAVL", timeZone: "America/New_York" } },
    },
    include: { locations: true },
  });
  const brAdmin = await db.user.create({
    data: { organizationId: blueRidge.id, email: "admin@blueridge.demo", passwordHash: password, firstName: "Casey", lastName: "Turner", role: Role.SCHOOL_ADMIN },
  });
  await db.organization.update({ where: { id: blueRidge.id }, data: { ownerId: brAdmin.id } });
  const brCfiUser = await db.user.create({
    data: { organizationId: blueRidge.id, email: "cfi@blueridge.demo", passwordHash: password, firstName: "Morgan", lastName: "Lee", role: Role.INSTRUCTOR },
  });
  await db.instructor.create({ data: { userId: brCfiUser.id, certificates: "CFI", hourlyRate: 60 } });
  const c152 = await db.aircraftType.create({ data: { manufacturer: "Cessna", model: "152", seats: 2 } });
  await db.aircraft.create({
    data: {
      organizationId: blueRidge.id, locationId: blueRidge.locations[0].id, aircraftTypeId: c152.id,
      tailNumber: "N67235", year: 1979, hourlyRateWet: 119, status: AircraftStatus.AVAILABLE,
      currentHobbs: 9182.4, currentTach: 8990.1,
    },
  });
  await db.invitation.create({
    data: {
      organizationId: blueRidge.id, email: "newmember@blueridge.demo", role: Role.STUDENT,
      // Raw token "demo-invite-blueridge" → sha256 (ADR-020: never store raw).
      tokenHash: hashToken("demo-invite-blueridge"), invitedBy: "Casey Turner", expiresAt: day(14),
    },
  });
  await db.auditLog.createMany({
    data: [
      { organizationId: blueRidge.id, actorUserId: brAdmin.id, actorLabel: "Casey Turner", action: "users.invite", entityType: "Invitation", newValue: { email: "newmember@blueridge.demo", role: "STUDENT" }, createdAt: day(-1, 10) },
      { organizationId: org.id, actorLabel: "System", action: "org.plan_assigned", entityType: "Organization", entityId: org.id, newValue: { plan: "Professional" }, createdAt: day(-30, 9) },
    ],
  });

  await backfillSeedMemberships();

  console.log("Seed complete.");
  console.log("Platform staff (password: demo1234): founder@aerops.io · support@aerops.io · auditor@aerops.io");
  console.log("Second tenant: admin@blueridge.demo / demo1234");
  console.log("Logins (password: demo1234):");
  console.log("  admin@aerops.demo (School Admin)  dispatch@aerops.demo (Dispatcher)");
  console.log("  sarah.cfi@aerops.demo (Instructor)  student@aerops.demo (Student)");
  console.log("  maintenance@aerops.demo (Maintenance)  accounting@aerops.demo (Accountant)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
