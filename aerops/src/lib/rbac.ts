import type { Role } from "@prisma/client";

/**
 * Route-level access control. Each app section lists the roles allowed in.
 * SUPER_ADMIN and SCHOOL_ADMIN are implicitly allowed everywhere.
 */
const SECTION_ACCESS: Record<string, Role[]> = {
  "/dashboard": ["DISPATCHER", "INSTRUCTOR", "STUDENT", "MAINTENANCE", "ACCOUNTANT"],
  "/schedule": ["DISPATCHER", "INSTRUCTOR", "STUDENT"],
  "/dispatch": ["DISPATCHER", "INSTRUCTOR"],
  "/aircraft": ["DISPATCHER", "INSTRUCTOR", "MAINTENANCE"],
  "/students": ["DISPATCHER", "INSTRUCTOR"],
  "/instructors": ["DISPATCHER"],
  "/maintenance": ["MAINTENANCE", "DISPATCHER"],
  "/billing": ["ACCOUNTANT"],
  "/reports": ["ACCOUNTANT", "DISPATCHER"],
  "/notifications": ["DISPATCHER", "INSTRUCTOR", "STUDENT", "MAINTENANCE", "ACCOUNTANT"],
  "/documents": ["DISPATCHER", "INSTRUCTOR", "STUDENT", "MAINTENANCE", "ACCOUNTANT"],
  "/settings": [],
};

const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "SCHOOL_ADMIN"];

export function canAccess(role: Role, pathname: string): boolean {
  if (ADMIN_ROLES.includes(role)) return true;
  const section = Object.keys(SECTION_ACCESS).find((s) => pathname === s || pathname.startsWith(s + "/"));
  if (!section) return true;
  return SECTION_ACCESS[section].includes(role);
}

export function isAdmin(role: Role) {
  return ADMIN_ROLES.includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Administrator",
  SCHOOL_ADMIN: "School Administrator",
  DISPATCHER: "Dispatcher",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
  MAINTENANCE: "Maintenance",
  ACCOUNTANT: "Accountant",
};
