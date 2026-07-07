import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Accepts numbers, numeric strings, and Prisma Decimal values. */
type Numeric = number | string | { toString(): string } | null | undefined;

export function formatCurrency(value: Numeric) {
  return usd.format(Number(value ?? 0));
}

export function formatHours(value: Numeric) {
  return `${Number(value ?? 0).toFixed(1)} hrs`;
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(date: Date | string) {
  return new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "—";
  return `${formatDate(date)} · ${formatTime(new Date(date))}`;
}

export function initials(first?: string | null, last?: string | null) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
}

export function fullName(user: { firstName: string; lastName: string } | null | undefined) {
  return user ? `${user.firstName} ${user.lastName}` : "—";
}

/** Days until a date; negative if past. Null-safe. */
export function daysUntil(date: Date | string | null | undefined) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

/**
 * Normalize an API `error` payload to one human sentence. Our routes return
 * either a string (`{ error: "…" }`) or a zod `flatten()` object
 * (`{ error: { fieldErrors, formErrors } }`); forms show the first message.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    for (const msgs of Object.values(e.fieldErrors ?? {})) if (msgs?.[0]) return msgs[0];
    if (e.formErrors?.[0]) return e.formErrors[0];
  }
  return fallback;
}
