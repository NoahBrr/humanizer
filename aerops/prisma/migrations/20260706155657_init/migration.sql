-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'DISPATCHER', 'INSTRUCTOR', 'STUDENT', 'MAINTENANCE', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('NONE', 'STUDENT_PILOT', 'SPORT', 'RECREATIONAL', 'PRIVATE', 'INSTRUMENT', 'COMMERCIAL', 'CFI', 'CFII', 'MEI', 'ATP');

-- CreateEnum
CREATE TYPE "TrainingPart" AS ENUM ('PART_61', 'PART_141');

-- CreateEnum
CREATE TYPE "AircraftStatus" AS ENUM ('AVAILABLE', 'IN_MAINTENANCE', 'GROUNDED', 'RESERVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SquawkStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "SquawkSeverity" AS ENUM ('GROUNDING', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('FLIGHT_LESSON', 'SOLO_FLIGHT', 'GROUND_LESSON', 'SIMULATOR', 'CHECKRIDE', 'RENTAL', 'MAINTENANCE_BLOCK', 'MEETING');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'DISPATCHED', 'IN_FLIGHT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'WEATHER_CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'RELEASED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LessonGrade" AS ENUM ('EXCELLENT', 'SATISFACTORY', 'NEEDS_IMPROVEMENT', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "CheckrideStatus" AS ENUM ('SCHEDULED', 'PASSED', 'FAILED', 'DISCONTINUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'PARTIALLY_PAID', 'VOID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "LineItemKind" AS ENUM ('AIRCRAFT_RENTAL', 'INSTRUCTOR_TIME', 'GROUND_INSTRUCTION', 'SIMULATOR_TIME', 'FUEL_SURCHARGE', 'MEMBERSHIP_FEE', 'LATE_FEE', 'SUPPLY', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'ACH', 'CASH', 'CHECK', 'ACCOUNT_CREDIT', 'GIFT_CERTIFICATE');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('UPCOMING_FLIGHT', 'MAINTENANCE_DUE', 'DOCUMENT_EXPIRING', 'BALANCE_DUE', 'SCHEDULE_CHANGE', 'WEATHER_CANCELLATION', 'AIRCRAFT_GROUNDED', 'INSTRUCTOR_UNAVAILABLE', 'SQUAWK_REPORTED', 'GENERAL');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('MEDICAL_CERTIFICATE', 'PILOT_CERTIFICATE', 'GOVERNMENT_ID', 'INSURANCE', 'RENTAL_AGREEMENT', 'TRAINING_RECORD', 'MAINTENANCE_LOG', 'OTHER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#2563eb',
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icao" TEXT,
    "address" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "certificateHeld" "CertificateType" NOT NULL DEFAULT 'NONE',
    "medicalClass" TEXT,
    "medicalExpiration" TIMESTAMP(3),
    "studentCertNumber" TEXT,
    "tsaVerified" BOOLEAN NOT NULL DEFAULT false,
    "trainingGoal" TEXT,
    "trainingPart" "TrainingPart" NOT NULL DEFAULT 'PART_61',
    "assignedInstructorId" TEXT,
    "accountBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalHours" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "soloHours" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certificates" TEXT NOT NULL,
    "cfiNumber" TEXT,
    "cfiExpiration" TIMESTAMP(3),
    "medicalExpiration" TIMESTAMP(3),
    "hourlyRate" DECIMAL(8,2) NOT NULL DEFAULT 65,
    "bio" TEXT,
    "hiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorAvailability" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "InstructorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AircraftType" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "engineType" TEXT NOT NULL DEFAULT 'Piston',
    "seats" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "AircraftType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aircraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "aircraftTypeId" TEXT NOT NULL,
    "tailNumber" TEXT NOT NULL,
    "year" INTEGER,
    "hourlyRateWet" DECIMAL(8,2) NOT NULL,
    "hourlyRateDry" DECIMAL(8,2),
    "fuelType" TEXT NOT NULL DEFAULT '100LL',
    "usefulLoadLbs" INTEGER,
    "status" "AircraftStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentHobbs" DECIMAL(9,1) NOT NULL DEFAULT 0,
    "currentTach" DECIMAL(9,1) NOT NULL DEFAULT 0,
    "engineTimeSmoh" DECIMAL(9,1) NOT NULL DEFAULT 0,
    "propTimeSpoh" DECIMAL(9,1) NOT NULL DEFAULT 0,
    "insuranceExpiration" TIMESTAMP(3),
    "registrationExpiration" TIMESTAMP(3),
    "photoUrl" TEXT,
    "isSimulator" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "Aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AircraftComponent" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueAtHours" DECIMAL(9,1),
    "dueAtDate" TIMESTAMP(3),
    "lastDoneHours" DECIMAL(9,1),
    "lastDoneDate" TIMESTAMP(3),
    "intervalHours" INTEGER,
    "intervalMonths" INTEGER,
    "notes" TEXT,

    CONSTRAINT "AircraftComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Squawk" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "reportedById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "SquawkSeverity" NOT NULL DEFAULT 'MINOR',
    "status" "SquawkStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "Squawk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOrder" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assignedTo" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "costParts" DECIMAL(10,2),
    "costLabor" DECIMAL(10,2),
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "durationMin" INTEGER NOT NULL DEFAULT 120,
    "requiresAircraft" BOOLEAN NOT NULL DEFAULT true,
    "requiresInstructor" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LessonType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" "EventType" NOT NULL DEFAULT 'FLIGHT_LESSON',
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "title" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "aircraftId" TEXT,
    "instructorId" TEXT,
    "studentId" TEXT,
    "lessonTypeId" TEXT,
    "syllabusLessonId" TEXT,
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "scheduleEventId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "studentId" TEXT,
    "instructorId" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "fuelQty" TEXT,
    "oilQty" TEXT,
    "weatherAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "documentsVerified" BOOLEAN NOT NULL DEFAULT false,
    "instructorApproved" BOOLEAN NOT NULL DEFAULT false,
    "studentApproved" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "hobbsOut" DECIMAL(9,1),
    "hobbsIn" DECIMAL(9,1),
    "tachOut" DECIMAL(9,1),
    "tachIn" DECIMAL(9,1),
    "flightTime" DECIMAL(6,1),
    "landings" INTEGER,
    "nightTime" DECIMAL(6,1),
    "instrumentTime" DECIMAL(6,1),
    "dualReceived" DECIMAL(6,1),
    "dualGiven" DECIMAL(6,1),
    "picTime" DECIMAL(6,1),
    "fuelAddedGal" DECIMAL(6,1),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Syllabus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainingPart" "TrainingPart" NOT NULL DEFAULT 'PART_61',
    "description" TEXT,
    "requiredHours" DECIMAL(6,1) NOT NULL DEFAULT 40,

    CONSTRAINT "Syllabus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusStage" (
    "id" TEXT NOT NULL,
    "syllabusId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isStageCheck" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyllabusStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusLesson" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "objective" TEXT,
    "minHours" DECIMAL(5,1),

    CONSTRAINT "SyllabusLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusEnrollment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "syllabusId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SyllabusEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "syllabusLessonId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grade" "LessonGrade" NOT NULL DEFAULT 'SATISFACTORY',
    "flightHours" DECIMAL(5,1),
    "groundHours" DECIMAL(5,1),
    "notes" TEXT,
    "signedByInstructor" BOOLEAN NOT NULL DEFAULT false,
    "signedByStudent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LessonRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endorsement" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "farReference" TEXT,
    "text" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Endorsement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRating" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rating" "CertificateType" NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkride" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "instructorId" TEXT,
    "rating" "CertificateType" NOT NULL,
    "examinerName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "CheckrideStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,

    CONSTRAINT "Checkride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "memo" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "LineItemKind" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "NotificationKind" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "aircraftId" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_assignedInstructorId_idx" ON "Student"("assignedInstructorId");

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_userId_key" ON "Instructor"("userId");

-- CreateIndex
CREATE INDEX "InstructorAvailability_instructorId_idx" ON "InstructorAvailability"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "AircraftType_manufacturer_model_key" ON "AircraftType"("manufacturer", "model");

-- CreateIndex
CREATE UNIQUE INDEX "Aircraft_tailNumber_key" ON "Aircraft"("tailNumber");

-- CreateIndex
CREATE INDEX "Aircraft_organizationId_status_idx" ON "Aircraft"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AircraftComponent_aircraftId_idx" ON "AircraftComponent"("aircraftId");

-- CreateIndex
CREATE INDEX "Squawk_aircraftId_status_idx" ON "Squawk"("aircraftId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_aircraftId_status_idx" ON "MaintenanceOrder"("aircraftId", "status");

-- CreateIndex
CREATE INDEX "LessonType_organizationId_idx" ON "LessonType"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_organizationId_start_end_idx" ON "ScheduleEvent"("organizationId", "start", "end");

-- CreateIndex
CREATE INDEX "ScheduleEvent_aircraftId_start_idx" ON "ScheduleEvent"("aircraftId", "start");

-- CreateIndex
CREATE INDEX "ScheduleEvent_instructorId_start_idx" ON "ScheduleEvent"("instructorId", "start");

-- CreateIndex
CREATE INDEX "ScheduleEvent_studentId_start_idx" ON "ScheduleEvent"("studentId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_scheduleEventId_key" ON "Dispatch"("scheduleEventId");

-- CreateIndex
CREATE INDEX "Dispatch_status_idx" ON "Dispatch"("status");

-- CreateIndex
CREATE INDEX "Syllabus_organizationId_idx" ON "Syllabus"("organizationId");

-- CreateIndex
CREATE INDEX "SyllabusStage_syllabusId_idx" ON "SyllabusStage"("syllabusId");

-- CreateIndex
CREATE INDEX "SyllabusLesson_stageId_idx" ON "SyllabusLesson"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "SyllabusEnrollment_studentId_syllabusId_key" ON "SyllabusEnrollment"("studentId", "syllabusId");

-- CreateIndex
CREATE INDEX "LessonRecord_studentId_date_idx" ON "LessonRecord"("studentId", "date");

-- CreateIndex
CREATE INDEX "Endorsement_studentId_idx" ON "Endorsement"("studentId");

-- CreateIndex
CREATE INDEX "StudentRating_studentId_idx" ON "StudentRating"("studentId");

-- CreateIndex
CREATE INDEX "Checkride_studentId_date_idx" ON "Checkride"("studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Invoice_studentId_idx" ON "Invoice"("studentId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Document_organizationId_kind_idx" ON "Document"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "Document_ownerId_idx" ON "Document"("ownerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_assignedInstructorId_fkey" FOREIGN KEY ("assignedInstructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAvailability" ADD CONSTRAINT "InstructorAvailability_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_aircraftTypeId_fkey" FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftComponent" ADD CONSTRAINT "AircraftComponent_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squawk" ADD CONSTRAINT "Squawk_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonType" ADD CONSTRAINT "LessonType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_lessonTypeId_fkey" FOREIGN KEY ("lessonTypeId") REFERENCES "LessonType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_syllabusLessonId_fkey" FOREIGN KEY ("syllabusLessonId") REFERENCES "SyllabusLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_scheduleEventId_fkey" FOREIGN KEY ("scheduleEventId") REFERENCES "ScheduleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusStage" ADD CONSTRAINT "SyllabusStage_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES "Syllabus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusLesson" ADD CONSTRAINT "SyllabusLesson_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SyllabusStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusEnrollment" ADD CONSTRAINT "SyllabusEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusEnrollment" ADD CONSTRAINT "SyllabusEnrollment_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES "Syllabus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRecord" ADD CONSTRAINT "LessonRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRecord" ADD CONSTRAINT "LessonRecord_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRecord" ADD CONSTRAINT "LessonRecord_syllabusLessonId_fkey" FOREIGN KEY ("syllabusLessonId") REFERENCES "SyllabusLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRating" ADD CONSTRAINT "StudentRating_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkride" ADD CONSTRAINT "Checkride_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkride" ADD CONSTRAINT "Checkride_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
