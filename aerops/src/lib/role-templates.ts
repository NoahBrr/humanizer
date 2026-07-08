import type { Role } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

/**
 * Aviation-native long-tail role templates.
 *
 * These are NOT new enum values and NOT an auth change. The RBAC contract is
 * unchanged: the seven `Role` enum primitives and their `DEFAULT_ROLE_PERMISSIONS`
 * bundles in `lib/permissions.ts` remain the source of truth. Real operations,
 * though, staff far more than seven job titles — an assistant chief instructor,
 * a registrar, a front-office lead, a maintenance technician who is not the DOM.
 *
 * AeroOps already models that reality data-side: the `OrgRole` table stores
 * per-org custom roles as plain permission arrays, and `User.customRole` /
 * `Invitation.customRole` bind a member to one. This catalog is the seed set for
 * those rows — each template is a least-privilege bundle, expressed only in
 * `Permission` keys that exist in `PERMISSIONS`, that an org (or the onboarding
 * seeder) can materialize as a system `OrgRole`. `basedOn` records the nearest
 * base enum the template is scoped from, so the UI can group it and so a member
 * without a custom role still has a sane enum fallback.
 *
 * Data only — no logic. Adding, renaming, or reshaping a template here changes
 * no route, no gate, and no migration: routes authorize on permission keys, never
 * on role names (`CLAUDE.md` §3, constitution-tested). Governance and the full
 * role/workspace analysis live in `docs/company/ROLES_AND_WORKSPACES.md`.
 */
export type RoleTemplate = {
  /** Display name shown to operators (aviation-native, title case). */
  label: string;
  /** One-line persona description — who holds this seat and why. */
  description: string;
  /** Nearest base `Role` this template is scoped from (grouping + fallback). */
  basedOn: Role;
  /** Least-privilege bundle. Every entry must be a valid `Permission` key. */
  permissions: Permission[];
};

/**
 * The catalog. Order is roughly instruction → operations → maintenance →
 * front-office/records → oversight, matching how an org grows into these seats.
 * Every bundle includes `notifications.view` + `documents.view` (the baseline
 * every org member gets) and then only the capabilities the persona needs.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    label: "Assistant Chief Instructor",
    description:
      "Deputy to the chief instructor: owns stage checks, endorsement review, checkride readiness, and same-day CFI reassignment across the training pipeline.",
    basedOn: "INSTRUCTOR",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "schedule.create",
      "schedule.edit",
      "schedule.override_conflicts",
      "dispatch.release",
      "dispatch.close",
      "aircraft.view",
      "students.view",
      "students.manage",
      "instructors.view",
      "reports.view",
    ],
  },
  {
    label: "Independent Instructor",
    description:
      "Freelance CFI operating inside an org's roster (the org-member form of the individual-account persona): teaches, logs lessons and endorsements, manages their own students — no back-office reach.",
    basedOn: "INSTRUCTOR",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "schedule.create",
      "schedule.edit",
      "dispatch.release",
      "dispatch.close",
      "aircraft.view",
      "students.view",
      "students.manage",
      "instructors.view",
    ],
  },
  {
    label: "Operations Coordinator",
    description:
      "Runs the day's flying — bookings, conflict resolution, releases, and returns — one notch below the dispatcher: full schedule/dispatch control and grounding, but no payment handling.",
    basedOn: "DISPATCHER",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "schedule.create",
      "schedule.edit",
      "schedule.delete",
      "schedule.override_conflicts",
      "dispatch.release",
      "dispatch.close",
      "aircraft.view",
      "aircraft.ground",
      "maintenance.view",
      "students.view",
      "instructors.view",
      "reports.view",
    ],
  },
  {
    label: "Maintenance Technician",
    description:
      "Works the squawk and work-order queue under the Maintenance Manager. Records and completes work; grounding and return-to-service authority stay with the DOM (no aircraft.ground).",
    basedOn: "MAINTENANCE",
    permissions: [
      "notifications.view",
      "documents.view",
      "aircraft.view",
      "maintenance.view",
      "maintenance.manage",
    ],
  },
  {
    label: "Registrar",
    description:
      "Owns student records and enrollment paperwork: manages training records and documents, reads the schedule and reports — no flying, dispatch, or money.",
    basedOn: "SCHOOL_ADMIN",
    permissions: [
      "notifications.view",
      "documents.view",
      "documents.manage",
      "students.view",
      "students.manage",
      "schedule.view",
      "reports.view",
    ],
  },
  {
    label: "Admissions",
    description:
      "Works the prospect-to-enrollment pipeline: the CRM/Growth board and new-student setup. Reads the schedule to place first lessons.",
    basedOn: "SCHOOL_ADMIN",
    permissions: [
      "notifications.view",
      "documents.view",
      "students.view",
      "students.manage",
      "schedule.view",
      "reports.view",
    ],
  },
  {
    label: "Front Office",
    description:
      "The desk: books and reschedules lessons, answers billing questions and records payments, chases documents. First contact, first-line money and paperwork.",
    basedOn: "DISPATCHER",
    permissions: [
      "notifications.view",
      "documents.view",
      "documents.manage",
      "schedule.view",
      "schedule.create",
      "schedule.edit",
      "students.view",
      "aircraft.view",
      "billing.view",
      "billing.record_payments",
    ],
  },
  {
    label: "Teaching Assistant",
    description:
      "Ground-school or lab assistant: sees the schedule, students, and instructors to support instruction, but cannot sign lesson records or dispatch (read-mostly).",
    basedOn: "INSTRUCTOR",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "students.view",
      "instructors.view",
      "aircraft.view",
    ],
  },
  {
    label: "Safety Officer",
    description:
      "Reads across the whole operation — schedule, fleet, maintenance, training, and reports — to spot risk. Oversight only; makes no operational mutations.",
    basedOn: "SCHOOL_ADMIN",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "aircraft.view",
      "maintenance.view",
      "students.view",
      "instructors.view",
      "reports.view",
      "reports.export",
    ],
  },
  {
    label: "Marketing",
    description:
      "Owns the Growth/CRM funnel and pulls performance reports. Needs the lead pipeline and export, not operations or money.",
    basedOn: "SCHOOL_ADMIN",
    permissions: [
      "notifications.view",
      "documents.view",
      "students.view",
      "students.manage",
      "reports.view",
      "reports.export",
    ],
  },
  {
    label: "Read-Only Auditor",
    description:
      "Org-level read-only observer (board member, insurer, accreditor liaison): sees the operation, money, and records end-to-end but can change nothing. Distinct from the platform-staff PlatformRole of the same name.",
    basedOn: "SCHOOL_ADMIN",
    permissions: [
      "notifications.view",
      "documents.view",
      "schedule.view",
      "aircraft.view",
      "maintenance.view",
      "students.view",
      "instructors.view",
      "billing.view",
      "reports.view",
      "reports.export",
    ],
  },
];
