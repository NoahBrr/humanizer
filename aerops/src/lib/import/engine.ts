import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { type ImportSpec, type ImportField, type DuplicateStrategy } from "@/lib/import/spec";

/**
 * Import engine: validation, duplicate detection, dry-run, commit, rollback.
 *
 * Contract:
 * - Rows never fail silently — every skipped/failed row carries its row
 *   number (1-based, counting the header as row 1) and a reason.
 * - Everything is organization-scoped through the caller's session; lookups
 *   (tails, emails) only ever resolve inside the target organization.
 * - A dry run executes the exact same code path inside a transaction that is
 *   rolled back at the end, so "test import" results match the real thing.
 * - Commits record every CREATED record id per model — the rollback
 *   manifest. Updates are not reversible; a job that updated records rolls
 *   back to ROLLBACK_PARTIAL and says so.
 */

export type RowError = { row: number; message: string };

export type ImportReport = {
  totals: { total: number; created: number; updated: number; skipped: number; failed: number };
  errors: RowError[];
  createdRecords: Record<string, string[]>;
};

export type PreparedRow = { row: number; values: Record<string, unknown>; errors: string[] };

// --------------------------------------------------------------------------
// Value coercion & validation
// --------------------------------------------------------------------------

function coerce(field: ImportField, raw: string): { value: unknown; error?: string } {
  const v = raw.trim();
  if (v === "") return { value: undefined };
  switch (field.type) {
    case "number": {
      const n = Number(v.replace(/[$,]/g, ""));
      return Number.isFinite(n) ? { value: n } : { value: undefined, error: `"${raw}" is not a number` };
    }
    case "date": {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? { value: undefined, error: `"${raw}" is not a date` } : { value: d };
    }
    case "boolean": {
      const t = ["yes", "true", "y", "1", "x"].includes(v.toLowerCase());
      const f = ["no", "false", "n", "0", ""].includes(v.toLowerCase());
      return t || f ? { value: t } : { value: undefined, error: `"${raw}" is not yes/no` };
    }
    case "email": {
      const email = v.toLowerCase();
      return /.+@.+\..+/.test(email) ? { value: email } : { value: undefined, error: `"${raw}" is not an email address` };
    }
    default: {
      if (field.oneOf) {
        const norm = v.toUpperCase().replace(/[\s-]+/g, "_");
        const hit = field.oneOf.find((o) => o === norm);
        return hit ? { value: hit } : { value: undefined, error: `"${raw}" must be one of ${field.oneOf.join(", ")}` };
      }
      return { value: v };
    }
  }
}

/** Apply the mapping and validate every row. Row numbers count the header as row 1. */
export function prepareRows(spec: ImportSpec, rows: Record<string, string>[], mapping: Record<string, string>): PreparedRow[] {
  return rows.map((raw, i) => {
    const rowNo = i + 2;
    const values: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const field of spec.fields) {
      const col = mapping[field.key];
      const rawValue = col ? raw[col] ?? "" : "";
      const { value, error } = coerce(field, rawValue);
      if (error) errors.push(`${field.label}: ${error}`);
      if (value !== undefined) values[field.key] = value;
    }

    // fullName → first/last fallback for person types
    if (!values.firstName && !values.lastName && typeof values.fullName === "string") {
      const parts = (values.fullName as string).trim().split(/\s+/);
      values.firstName = parts.slice(0, -1).join(" ") || parts[0];
      values.lastName = parts.length > 1 ? parts[parts.length - 1] : "—";
    }

    for (const field of spec.fields) {
      if (!field.required) continue;
      if (field.key === "firstName" || field.key === "lastName") {
        if (values[field.key] === undefined) errors.push(`${field.label} is required (map it or map Full name)`);
      } else if (values[field.key] === undefined) {
        errors.push(`${field.label} is required`);
      }
    }
    return { row: rowNo, values, errors };
  });
}

/** In-file duplicate detection (same key appearing on multiple rows). */
export function findInFileDuplicates(spec: ImportSpec, prepared: PreparedRow[]): RowError[] {
  const errors: RowError[] = [];
  for (const keys of spec.duplicateKeys) {
    const seen = new Map<string, number>();
    for (const p of prepared) {
      const parts = keys.map((k) => p.values[k]).filter((v) => v !== undefined);
      if (parts.length !== keys.length) continue;
      const sig = parts.map((v) => String(v).toLowerCase()).join("|");
      const first = seen.get(sig);
      if (first) errors.push({ row: p.row, message: `Duplicate of row ${first} (same ${keys.join(" + ")})` });
      else seen.set(sig, p.row);
    }
  }
  return errors;
}

// --------------------------------------------------------------------------
// Import execution
// --------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

type Ctx = {
  tx: Tx;
  organizationId: string;
  strategy: DuplicateStrategy;
  report: ImportReport;
  passwordHash: string;
};

function track(ctx: Ctx, model: string, id: string) {
  (ctx.report.createdRecords[model] ??= []).push(id);
}

const defined = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

async function importPerson(ctx: Ctx, v: Record<string, unknown>, kind: "students" | "members" | "instructors"): Promise<"create" | "update" | "skip"> {
  const email = v.email as string;
  const existing = await ctx.tx.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
  if (existing && existing.organizationId !== ctx.organizationId) {
    throw new Error(`${email} already has an AeroOps account in another organization — have them join via Settings → Join Requests instead`);
  }

  const profileData = kind === "instructors"
    ? undefined
    : defined({
        trainingGoal: kind === "members" ? (v.membershipLevel as string | undefined) ?? "Club member" : v.trainingGoal,
        certificateHeld: v.certificateHeld,
        medicalClass: v.medicalClass,
        medicalExpiration: v.medicalExpiration,
        accountBalance: v.accountBalance,
        totalHours: v.totalHours,
        soloHours: v.soloHours,
      });
  const instructorData = kind === "instructors"
    ? defined({
        certificates: (v.certificates as string | undefined) ?? "CFI",
        hourlyRate: v.hourlyRate,
        cfiNumber: v.cfiNumber,
        cfiExpiration: v.cfiExpiration,
        medicalExpiration: v.medicalExpiration,
      })
    : undefined;

  if (existing) {
    if (ctx.strategy === "skip") return "skip";
    if (ctx.strategy === "update") {
      await ctx.tx.user.update({
        where: { id: existing.id },
        data: defined({ firstName: v.firstName, lastName: v.lastName, phone: v.phone }),
      });
      if (profileData) {
        await ctx.tx.student.upsert({ where: { userId: existing.id }, update: profileData, create: { userId: existing.id, ...profileData } });
      }
      if (instructorData) {
        await ctx.tx.instructor.upsert({
          where: { userId: existing.id },
          update: instructorData,
          create: { userId: existing.id, certificates: "CFI", ...instructorData },
        });
      }
      return "update";
    }
    throw new Error(`${email} already exists — emails are unique, so "create anyway" cannot apply to people`);
  }

  const user = await ctx.tx.user.create({
    data: {
      organizationId: ctx.organizationId,
      email,
      passwordHash: ctx.passwordHash,
      firstName: v.firstName as string,
      lastName: v.lastName as string,
      phone: (v.phone as string | undefined) ?? null,
      role: kind === "instructors" ? "INSTRUCTOR" : "STUDENT",
    },
  });
  track(ctx, "user", user.id);
  if (profileData) await ctx.tx.student.create({ data: { userId: user.id, ...profileData } });
  if (instructorData) await ctx.tx.instructor.create({ data: { userId: user.id, certificates: "CFI", ...instructorData } });
  return "create";
}

async function importAircraft(ctx: Ctx, v: Record<string, unknown>): Promise<"create" | "update" | "skip"> {
  const tail = (v.tailNumber as string).toUpperCase();
  const existing = await ctx.tx.aircraft.findUnique({ where: { tailNumber: tail }, select: { id: true, organizationId: true } });
  if (existing && existing.organizationId !== ctx.organizationId) {
    throw new Error(`${tail} is registered to another organization on AeroOps`);
  }

  let locationId: string | undefined;
  if (v.locationIcao) {
    const loc = await ctx.tx.location.findFirst({
      where: { organizationId: ctx.organizationId, OR: [{ icao: (v.locationIcao as string).toUpperCase() }, { name: { equals: v.locationIcao as string, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (!loc) throw new Error(`Location "${v.locationIcao}" not found — import locations first or clear the column`);
    locationId = loc.id;
  }

  const data = defined({
    year: v.year, hourlyRateWet: v.hourlyRateWet, hourlyRateDry: v.hourlyRateDry,
    currentHobbs: v.currentHobbs, currentTach: v.currentTach,
    fuelType: v.fuelType, status: v.status, serialNumber: v.serialNumber, locationId,
  });

  if (existing) {
    if (ctx.strategy === "skip") return "skip";
    if (ctx.strategy === "update") { await ctx.tx.aircraft.update({ where: { id: existing.id }, data }); return "update"; }
    throw new Error(`${tail} already exists — tail numbers are unique, so "create anyway" cannot apply`);
  }

  const type = await ctx.tx.aircraftType.upsert({
    where: { manufacturer_model: { manufacturer: v.manufacturer as string, model: v.model as string } },
    update: {},
    create: { manufacturer: v.manufacturer as string, model: v.model as string },
  });
  const aircraft = await ctx.tx.aircraft.create({
    data: {
      organizationId: ctx.organizationId,
      aircraftTypeId: type.id,
      tailNumber: tail,
      hourlyRateWet: (v.hourlyRateWet as number | undefined) ?? 0,
      ...data,
    },
  });
  track(ctx, "aircraft", aircraft.id);
  return "create";
}

async function importSimpleOrgRecord(
  ctx: Ctx,
  v: Record<string, unknown>,
  spec: ImportSpec,
): Promise<"create" | "update" | "skip"> {
  switch (spec.key) {
    case "locations": {
      const existing = await ctx.tx.location.findFirst({
        where: {
          organizationId: ctx.organizationId,
          OR: [
            ...(v.icao ? [{ icao: (v.icao as string).toUpperCase() }] : []),
            { name: { equals: v.name as string, mode: "insensitive" } },
          ],
        },
      });
      const data = defined({ name: v.name, icao: v.icao ? (v.icao as string).toUpperCase() : undefined, address: v.address, timeZone: v.timeZone });
      if (existing) {
        if (ctx.strategy === "skip") return "skip";
        if (ctx.strategy === "update") { await ctx.tx.location.update({ where: { id: existing.id }, data }); return "update"; }
      }
      const loc = await ctx.tx.location.create({ data: { organizationId: ctx.organizationId, name: v.name as string, ...data } });
      track(ctx, "location", loc.id);
      return "create";
    }
    case "lesson-types": {
      const existing = await ctx.tx.lessonType.findFirst({ where: { organizationId: ctx.organizationId, name: { equals: v.name as string, mode: "insensitive" } } });
      const data = defined({ durationMin: v.durationMin, color: v.color, requiresAircraft: v.requiresAircraft, requiresInstructor: v.requiresInstructor });
      if (existing) {
        if (ctx.strategy === "skip") return "skip";
        if (ctx.strategy === "update") { await ctx.tx.lessonType.update({ where: { id: existing.id }, data }); return "update"; }
      }
      const lt = await ctx.tx.lessonType.create({ data: { organizationId: ctx.organizationId, name: v.name as string, ...data } });
      track(ctx, "lessonType", lt.id);
      return "create";
    }
    case "leads": {
      const existing = await ctx.tx.lead.findFirst({
        where: { organizationId: ctx.organizationId, OR: [{ email: v.email as string }, ...(v.phone ? [{ name: v.name as string, phone: v.phone as string }] : [])] },
      });
      const data = defined({
        name: v.name, email: v.email, phone: v.phone, source: v.source, interest: v.interest,
        status: v.status, estValue: v.estValue, discoveryFlightAt: v.discoveryFlightAt, notes: v.notes,
      });
      if (existing) {
        if (ctx.strategy === "skip") return "skip";
        if (ctx.strategy === "update") { await ctx.tx.lead.update({ where: { id: existing.id }, data }); return "update"; }
      }
      const lead = await ctx.tx.lead.create({ data: { organizationId: ctx.organizationId, name: v.name as string, email: v.email as string, ...data } });
      track(ctx, "lead", lead.id);
      return "create";
    }
    case "parts": {
      const existing = await ctx.tx.part.findUnique({
        where: { organizationId_partNumber: { organizationId: ctx.organizationId, partNumber: v.partNumber as string } },
      });
      const data = defined({ description: v.description, category: v.category, manufacturer: v.manufacturer, quantity: v.quantity, minQuantity: v.minQuantity, unitCost: v.unitCost, location: v.location });
      if (existing) {
        if (ctx.strategy === "skip") return "skip";
        if (ctx.strategy === "update") { await ctx.tx.part.update({ where: { id: existing.id }, data }); return "update"; }
        throw new Error(`Part ${v.partNumber} already exists — part numbers are unique per organization`);
      }
      const part = await ctx.tx.part.create({
        data: { organizationId: ctx.organizationId, partNumber: v.partNumber as string, description: v.description as string, ...data },
      });
      track(ctx, "part", part.id);
      if (((v.quantity as number | undefined) ?? 0) > 0) {
        const mv = await ctx.tx.inventoryMovement.create({
          data: { partId: part.id, type: "RECEIVE", quantity: (v.quantity as number) ?? 0, notes: "Opening stock (imported)", performedBy: "Import Center" },
        });
        track(ctx, "inventoryMovement", mv.id);
      }
      return "create";
    }
    default:
      throw new Error(`Unsupported data type ${spec.key}`);
  }
}

async function aircraftByTail(ctx: Ctx, tail: string) {
  const a = await ctx.tx.aircraft.findFirst({ where: { organizationId: ctx.organizationId, tailNumber: tail.toUpperCase() }, select: { id: true } });
  if (!a) throw new Error(`Aircraft ${tail.toUpperCase()} not found — import aircraft first`);
  return a.id;
}

async function importFleetRecord(ctx: Ctx, v: Record<string, unknown>, spec: ImportSpec): Promise<"create" | "update" | "skip"> {
  if (spec.key === "squawks") {
    const aircraftId = await aircraftByTail(ctx, v.tailNumber as string);
    const existing = await ctx.tx.squawk.findFirst({ where: { aircraftId, title: v.title as string, ...(v.reportedAt ? { createdAt: v.reportedAt as Date } : {}) } });
    if (existing) {
      if (ctx.strategy === "skip") return "skip";
      if (ctx.strategy === "update") {
        await ctx.tx.squawk.update({ where: { id: existing.id }, data: defined({ severity: v.severity, status: v.status, resolution: v.resolution }) });
        return "update";
      }
    }
    const sq = await ctx.tx.squawk.create({
      data: defined({
        aircraftId, title: v.title as string, severity: v.severity, status: v.status,
        createdAt: v.reportedAt, resolution: v.resolution,
        resolvedAt: v.status === "RESOLVED" ? (v.reportedAt as Date | undefined) ?? new Date() : undefined,
      }) as Prisma.SquawkUncheckedCreateInput,
    });
    track(ctx, "squawk", sq.id);
    return "create";
  }

  if (spec.key === "maintenance-orders") {
    const aircraftId = await aircraftByTail(ctx, v.tailNumber as string);
    const existing = await ctx.tx.maintenanceOrder.findFirst({ where: { aircraftId, title: v.title as string, startDate: v.startDate as Date } });
    const data = defined({ category: v.category, status: v.status, endDate: v.endDate, costParts: v.costParts, costLabor: v.costLabor, assignedTo: v.assignedTo, correctiveAction: v.correctiveAction });
    if (existing) {
      if (ctx.strategy === "skip") return "skip";
      if (ctx.strategy === "update") { await ctx.tx.maintenanceOrder.update({ where: { id: existing.id }, data }); return "update"; }
    }
    const wo = await ctx.tx.maintenanceOrder.create({
      data: { aircraftId, title: v.title as string, startDate: v.startDate as Date, ...data },
    });
    track(ctx, "maintenanceOrder", wo.id);
    return "create";
  }

  // schedule
  const start = v.start as Date;
  const end = v.end as Date;
  if (end <= start) throw new Error("End must be after start");
  let aircraftId: string | null = null;
  if (v.tailNumber) aircraftId = await aircraftByTail(ctx, v.tailNumber as string);
  let studentId: string | null = null;
  if (v.studentEmail) {
    const u = await ctx.tx.user.findFirst({
      where: { email: v.studentEmail as string, organizationId: ctx.organizationId },
      select: { id: true, studentProfile: { select: { id: true } } },
    });
    if (!u) throw new Error(`No member with email ${v.studentEmail} — import students/members first`);
    studentId = u.studentProfile?.id ?? (await ctx.tx.student.create({ data: { userId: u.id } })).id;
  }
  let instructorId: string | null = null;
  if (v.instructorEmail) {
    const u = await ctx.tx.user.findFirst({
      where: { email: v.instructorEmail as string, organizationId: ctx.organizationId },
      select: { instructorProfile: { select: { id: true } } },
    });
    if (!u?.instructorProfile) throw new Error(`No instructor with email ${v.instructorEmail} — import instructors first`);
    instructorId = u.instructorProfile.id;
  }

  const existing = await ctx.tx.scheduleEvent.findFirst({
    where: { organizationId: ctx.organizationId, start, ...(aircraftId ? { aircraftId } : {}), ...(studentId ? { studentId } : {}) },
  });
  if (existing) {
    if (ctx.strategy === "skip") return "skip";
    if (ctx.strategy === "update") {
      await ctx.tx.scheduleEvent.update({ where: { id: existing.id }, data: defined({ end, type: v.type, status: v.status, notes: v.notes, instructorId }) });
      return "update";
    }
  }
  const status = (v.status as string | undefined) ?? (end < new Date() ? "COMPLETED" : "SCHEDULED");
  const ev = await ctx.tx.scheduleEvent.create({
    data: defined({
      organizationId: ctx.organizationId, start, end, aircraftId, studentId, instructorId,
      type: v.type ?? "FLIGHT_LESSON", status, notes: v.notes,
    }) as Prisma.ScheduleEventUncheckedCreateInput,
  });
  track(ctx, "scheduleEvent", ev.id);
  return "create";
}

async function importInvoice(ctx: Ctx, v: Record<string, unknown>): Promise<"create" | "update" | "skip"> {
  const number = v.number as string;
  const existing = await ctx.tx.invoice.findUnique({ where: { number }, select: { id: true, organizationId: true } });
  if (existing && existing.organizationId !== ctx.organizationId) throw new Error(`Invoice number ${number} is used by another organization — prefix your numbers`);
  if (existing) {
    if (ctx.strategy === "skip") return "skip";
    if (ctx.strategy === "update") {
      await ctx.tx.invoice.update({ where: { id: existing.id }, data: defined({ status: v.status, dueAt: v.dueAt }) });
      return "update";
    }
    throw new Error(`Invoice ${number} already exists — invoice numbers are unique`);
  }

  const user = await ctx.tx.user.findFirst({
    where: { email: v.customerEmail as string, organizationId: ctx.organizationId },
    select: { id: true, studentProfile: { select: { id: true } } },
  });
  if (!user) throw new Error(`No member with email ${v.customerEmail} — import students/members first`);
  const studentId = user.studentProfile?.id ?? (await ctx.tx.student.create({ data: { userId: user.id } })).id;

  const total = v.total as number;
  const paid = (v.amountPaid as number | undefined) ?? 0;
  const status = (v.status as string | undefined) ??
    (paid >= total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : (v.dueAt && (v.dueAt as Date) < new Date()) ? "OVERDUE" : "OPEN");

  const invoice = await ctx.tx.invoice.create({
    data: defined({
      organizationId: ctx.organizationId, studentId, number, status,
      issuedAt: v.issuedAt, dueAt: v.dueAt,
      lines: { create: [{ kind: "OTHER", description: (v.description as string | undefined) ?? `Imported invoice ${number}`, quantity: 1, unitPrice: total }] },
    }) as Prisma.InvoiceUncheckedCreateInput,
  });
  track(ctx, "invoice", invoice.id);
  if (paid > 0) {
    await ctx.tx.payment.create({
      data: { invoiceId: invoice.id, amount: Math.min(paid, total), method: "CARD", reference: "Imported payment", paidAt: (v.issuedAt as Date | undefined) ?? new Date() },
    });
  }
  return "create";
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

export async function runImport(opts: {
  organizationId: string;
  spec: ImportSpec;
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  strategy: DuplicateStrategy;
  dryRun: boolean;
}): Promise<ImportReport> {
  const prepared = prepareRows(opts.spec, opts.rows, opts.mapping);
  const inFileDupes = new Map(findInFileDuplicates(opts.spec, prepared).map((e) => [e.row, e.message]));

  const report: ImportReport = {
    totals: { total: prepared.length, created: 0, updated: 0, skipped: 0, failed: 0 },
    errors: [],
    createdRecords: {},
  };
  const passwordHash = await bcrypt.hash(randomBytes(18).toString("base64url"), 10);

  class DryRunDone extends Error {}

  const work = async (tx: Tx) => {
    const ctx: Ctx = { tx, organizationId: opts.organizationId, strategy: opts.strategy, report, passwordHash };
    for (const p of prepared) {
      if (p.errors.length) {
        report.totals.failed++;
        report.errors.push({ row: p.row, message: p.errors.join("; ") });
        continue;
      }
      const dupe = inFileDupes.get(p.row);
      if (dupe && opts.strategy !== "create") {
        report.totals.skipped++;
        report.errors.push({ row: p.row, message: `${dupe} — row skipped` });
        continue;
      }
      try {
        let action: "create" | "update" | "skip";
        if (opts.spec.key === "students" || opts.spec.key === "members" || opts.spec.key === "instructors") {
          action = await importPerson(ctx, p.values, opts.spec.key);
        } else if (opts.spec.key === "aircraft") {
          action = await importAircraft(ctx, p.values);
        } else if (opts.spec.key === "invoices") {
          action = await importInvoice(ctx, p.values);
        } else if (opts.spec.key === "schedule" || opts.spec.key === "squawks" || opts.spec.key === "maintenance-orders") {
          action = await importFleetRecord(ctx, p.values, opts.spec);
        } else {
          action = await importSimpleOrgRecord(ctx, p.values, opts.spec);
        }
        if (action === "create") report.totals.created++;
        else if (action === "update") report.totals.updated++;
        else {
          report.totals.skipped++;
          report.errors.push({ row: p.row, message: "Duplicate of an existing record — skipped (strategy: skip)" });
        }
      } catch (e) {
        report.totals.failed++;
        report.errors.push({ row: p.row, message: e instanceof Error ? e.message : "Import failed" });
      }
    }
    if (opts.dryRun) throw new DryRunDone();
  };

  try {
    await db.$transaction(work, { timeout: 120_000 });
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
    // Dry run: transaction rolled back on purpose; the report stands, but
    // nothing was created — clear the manifest so nobody trusts those ids.
    report.createdRecords = {};
  }
  return report;
}

/** Rollback a committed job: delete the records it CREATED (children first). */
export async function rollbackImport(job: { id: string; organizationId: string; createdRecords: unknown; totals: unknown }) {
  const created = (job.createdRecords ?? {}) as Record<string, string[]>;
  const totals = (job.totals ?? {}) as { updated?: number };

  await db.$transaction(async (tx) => {
    const del = async (ids: string[] | undefined, run: (ids: string[]) => Promise<unknown>) => {
      if (ids?.length) await run(ids);
    };
    await del(created.invoice, (ids) => tx.invoice.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.scheduleEvent, (ids) => tx.scheduleEvent.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.squawk, (ids) => tx.squawk.deleteMany({ where: { id: { in: ids }, aircraft: { organizationId: job.organizationId } } }));
    await del(created.maintenanceOrder, (ids) => tx.maintenanceOrder.deleteMany({ where: { id: { in: ids }, aircraft: { organizationId: job.organizationId } } }));
    await del(created.inventoryMovement, (ids) => tx.inventoryMovement.deleteMany({ where: { id: { in: ids }, part: { organizationId: job.organizationId } } }));
    await del(created.part, (ids) => tx.part.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.aircraft, (ids) => tx.aircraft.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.lessonType, (ids) => tx.lessonType.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.location, (ids) => tx.location.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await del(created.user, (ids) => tx.user.deleteMany({ where: { id: { in: ids }, organizationId: job.organizationId } }));
    await tx.importJob.update({
      where: { id: job.id },
      data: { status: (totals.updated ?? 0) > 0 ? "ROLLBACK_PARTIAL" : "ROLLED_BACK", rolledBackAt: new Date() },
    });
  }, { timeout: 120_000 });

  return { partial: (totals.updated ?? 0) > 0 };
}
