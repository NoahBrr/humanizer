import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Organization snapshots: capture the complete operational dataset of a
 * tenant as JSON, and restore it later (wiping current data first). Row IDs
 * are preserved so all internal relations survive the round trip.
 *
 * Not captured (by design): AircraftType rows (global, shared across
 * tenants), and infrastructure/forensic rows — Invitation, AuditLog,
 * LoginEvent, ApiKey, Webhook(+deliveries), MissionControlScene,
 * PlatformNote. The audit trail in particular must never be rewritten by
 * a restore.
 */

type TableKey =
  | "orgRoles" | "departments" | "users" | "instructors" | "availability" | "students"
  | "locations" | "aircraft" | "components" | "squawks" | "maintenanceOrders"
  | "lessonTypes" | "syllabi" | "stages" | "lessons" | "enrollments" | "lessonRecords"
  | "endorsements" | "ratings" | "checkrides" | "scheduleEvents" | "dispatches"
  | "invoices" | "invoiceLines" | "payments" | "notifications" | "documents"
  | "leads" | "lessonRequests" | "waitlistEntries" | "parts" | "inventoryMovements";

type SnapshotData = {
  version: 1;
  capturedAt: string;
  org: Record<string, unknown>;
  tables: Record<TableKey, unknown[]>;
};

export async function captureSnapshot(organizationId: string, name: string, createdBy: string, description?: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const userWhere = { user: { organizationId } };

  const [orgRoles, departments, leads, lessonRequests, waitlistEntries, parts] = await Promise.all([
    db.orgRole.findMany({ where: { organizationId } }),
    db.department.findMany({ where: { organizationId } }),
    db.lead.findMany({ where: { organizationId } }),
    db.lessonRequest.findMany({ where: { organizationId } }),
    db.waitlistEntry.findMany({ where: { organizationId } }),
    db.part.findMany({ where: { organizationId } }),
  ]);
  const inventoryMovements = await db.inventoryMovement.findMany({ where: { partId: { in: parts.map((p) => p.id) } } });

  const [users, instructors, students, locations, aircraft, lessonTypes, syllabi, scheduleEvents, invoices, notifications, documents] = await Promise.all([
    db.user.findMany({ where: { organizationId } }),
    db.instructor.findMany({ where: userWhere }),
    db.student.findMany({ where: userWhere }),
    db.location.findMany({ where: { organizationId } }),
    db.aircraft.findMany({ where: { organizationId } }),
    db.lessonType.findMany({ where: { organizationId } }),
    db.syllabus.findMany({ where: { organizationId } }),
    db.scheduleEvent.findMany({ where: { organizationId } }),
    db.invoice.findMany({ where: { organizationId } }),
    db.notification.findMany({ where: { organizationId } }),
    db.document.findMany({ where: { organizationId } }),
  ]);

  const instructorIds = instructors.map((i) => i.id);
  const studentIds = students.map((s) => s.id);
  const aircraftIds = aircraft.map((a) => a.id);
  const syllabusIds = syllabi.map((s) => s.id);
  const eventIds = scheduleEvents.map((e) => e.id);
  const invoiceIds = invoices.map((i) => i.id);

  const [availability, components, squawks, maintenanceOrders, stages, enrollments, lessonRecords, endorsements, ratings, checkrides, dispatches, invoiceLines, payments] = await Promise.all([
    db.instructorAvailability.findMany({ where: { instructorId: { in: instructorIds } } }),
    db.aircraftComponent.findMany({ where: { aircraftId: { in: aircraftIds } } }),
    db.squawk.findMany({ where: { aircraftId: { in: aircraftIds } } }),
    db.maintenanceOrder.findMany({ where: { aircraftId: { in: aircraftIds } } }),
    db.syllabusStage.findMany({ where: { syllabusId: { in: syllabusIds } } }),
    db.syllabusEnrollment.findMany({ where: { studentId: { in: studentIds } } }),
    db.lessonRecord.findMany({ where: { studentId: { in: studentIds } } }),
    db.endorsement.findMany({ where: { studentId: { in: studentIds } } }),
    db.studentRating.findMany({ where: { studentId: { in: studentIds } } }),
    db.checkride.findMany({ where: { studentId: { in: studentIds } } }),
    db.dispatch.findMany({ where: { scheduleEventId: { in: eventIds } } }),
    db.invoiceLine.findMany({ where: { invoiceId: { in: invoiceIds } } }),
    db.payment.findMany({ where: { invoiceId: { in: invoiceIds } } }),
  ]);
  const lessons = await db.syllabusLesson.findMany({ where: { stageId: { in: stages.map((s) => s.id) } } });

  const data: SnapshotData = JSON.parse(JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    org: {
      name: org.name, logoUrl: org.logoUrl, brandColor: org.brandColor, timeZone: org.timeZone,
      status: org.status, planId: org.planId, isDemo: org.isDemo, ownerId: org.ownerId,
      businessProfiles: org.businessProfiles, disabledModules: org.disabledModules,
      disabledAutomations: org.disabledAutomations,
    },
    tables: {
      orgRoles, departments, users, instructors, availability, students, locations,
      aircraft, components, squawks, maintenanceOrders, lessonTypes, syllabi, stages,
      lessons, enrollments, lessonRecords, endorsements, ratings, checkrides,
      scheduleEvents, dispatches, invoices, invoiceLines, payments, notifications,
      documents, leads, lessonRequests, waitlistEntries, parts, inventoryMovements,
    },
  }));

  const json = JSON.stringify(data);
  return db.orgSnapshot.create({
    data: {
      organizationId, name, description, createdBy,
      data: data as unknown as Prisma.InputJsonValue,
      sizeBytes: Buffer.byteLength(json),
    },
    select: { id: true, name: true, sizeBytes: true, createdAt: true },
  });
}

/**
 * Delete every operational row belonging to an organization, in FK-safe
 * order. Used before snapshot restore and for full organization deletion.
 */
export async function wipeOrganizationData(organizationId: string, tx: Prisma.TransactionClient = db) {
  const userWhere = { user: { organizationId } };
  // Rows with RESTRICT relations to instructors must go first.
  await tx.lessonRecord.deleteMany({ where: { student: userWhere } });
  await tx.endorsement.deleteMany({ where: { student: userWhere } });
  await tx.checkride.deleteMany({ where: { student: userWhere } });
  await tx.studentRating.deleteMany({ where: { student: userWhere } });
  await tx.scheduleEvent.deleteMany({ where: { organizationId } }); // cascades dispatches
  await tx.invoice.deleteMany({ where: { organizationId } }); // cascades lines + payments
  await tx.notification.deleteMany({ where: { organizationId } });
  await tx.document.deleteMany({ where: { organizationId } });
  await tx.syllabus.deleteMany({ where: { organizationId } }); // cascades stages/lessons/enrollments
  await tx.lessonRequest.deleteMany({ where: { organizationId } });
  await tx.waitlistEntry.deleteMany({ where: { organizationId } });
  await tx.lead.deleteMany({ where: { organizationId } });
  await tx.part.deleteMany({ where: { organizationId } }); // cascades inventory movements
  await tx.lessonType.deleteMany({ where: { organizationId } });
  await tx.aircraft.deleteMany({ where: { organizationId } }); // cascades components/squawks/mx
  await tx.location.deleteMany({ where: { organizationId } });
  await tx.user.deleteMany({ where: { organizationId } }); // cascades students/instructors/availability
  await tx.orgRole.deleteMany({ where: { organizationId } });
  await tx.department.deleteMany({ where: { organizationId } });
  // Revenue Engine config singletons (RevenueSettings, RevenueWorkflowPolicy,
  // DispatchPolicy, OrgPaymentPolicy, CheckoutRestrictionPolicy, AccountingMapping,
  // OrgSequence) are onDelete:Cascade children of Organization — full org
  // deletion removes them automatically. They are org SETTINGS, not operational
  // snapshot data, so (like AircraftType) they are intentionally not captured and
  // survive an operational snapshot restore untouched.
}

export async function restoreSnapshot(snapshotId: string) {
  const snap = await db.orgSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  const data = snap.data as unknown as SnapshotData;
  if (data?.version !== 1) throw new Error("Unsupported snapshot format");
  const organizationId = snap.organizationId;
  const t = data.tables;

  await db.$transaction(async (tx) => {
    await wipeOrganizationData(organizationId, tx);

    await tx.organization.update({
      where: { id: organizationId },
      data: data.org as Prisma.OrganizationUpdateInput,
    });

    // Recreate in dependency order, preserving original IDs.
    const insert = async (model: { createMany: (args: { data: never[] }) => Promise<unknown> }, rows: unknown[]) => {
      if (rows?.length) await model.createMany({ data: rows as never[] });
    };
    await insert(tx.orgRole, t.orgRoles);
    await insert(tx.department, t.departments);
    await insert(tx.location, t.locations);
    await insert(tx.user, t.users);
    await insert(tx.instructor, t.instructors);
    await insert(tx.instructorAvailability, t.availability);
    await insert(tx.student, t.students);
    await insert(tx.aircraft, t.aircraft);
    await insert(tx.aircraftComponent, t.components);
    await insert(tx.squawk, t.squawks);
    await insert(tx.maintenanceOrder, t.maintenanceOrders);
    await insert(tx.lessonType, t.lessonTypes);
    await insert(tx.syllabus, t.syllabi);
    await insert(tx.syllabusStage, t.stages);
    await insert(tx.syllabusLesson, t.lessons);
    await insert(tx.syllabusEnrollment, t.enrollments);
    await insert(tx.lessonRecord, t.lessonRecords);
    await insert(tx.endorsement, t.endorsements);
    await insert(tx.studentRating, t.ratings);
    await insert(tx.checkride, t.checkrides);
    await insert(tx.scheduleEvent, t.scheduleEvents);
    await insert(tx.dispatch, t.dispatches);
    await insert(tx.invoice, t.invoices);
    await insert(tx.invoiceLine, t.invoiceLines);
    await insert(tx.payment, t.payments);
    await insert(tx.notification, t.notifications);
    await insert(tx.document, t.documents);
    await insert(tx.lead, t.leads);
    await insert(tx.lessonRequest, t.lessonRequests);
    await insert(tx.waitlistEntry, t.waitlistEntries);
    await insert(tx.part, t.parts);
    await insert(tx.inventoryMovement, t.inventoryMovements);
  }, { timeout: 120_000 });

  return { organizationId, restoredFrom: snap.name };
}
