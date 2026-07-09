-- CreateEnum
CREATE TYPE "LessonRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_CHANGES', 'SCHEDULED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ScheduleEvent" ADD COLUMN     "seriesId" TEXT;

-- CreateTable
CREATE TABLE "LessonRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "preferredStart" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 120,
    "lessonTypeId" TEXT,
    "instructorId" TEXT,
    "notes" TEXT,
    "status" "LessonRequestStatus" NOT NULL DEFAULT 'PENDING',
    "staffNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonRequest_organizationId_status_idx" ON "LessonRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_organizationId_date_idx" ON "WaitlistEntry"("organizationId", "date");

-- CreateIndex
CREATE INDEX "ScheduleEvent_seriesId_idx" ON "ScheduleEvent"("seriesId");

-- AddForeignKey
ALTER TABLE "LessonRequest" ADD CONSTRAINT "LessonRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRequest" ADD CONSTRAINT "LessonRequest_lessonTypeId_fkey" FOREIGN KEY ("lessonTypeId") REFERENCES "LessonType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRequest" ADD CONSTRAINT "LessonRequest_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
