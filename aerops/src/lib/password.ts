/**
 * Password policy (Section 4): ≥12 chars with upper/lower/number/special,
 * and a breached/common-password check. The local blocklist covers the most
 * common breached passwords; production also queries the HaveIBeenPwned
 * k-anonymity API through an adapter so raw passwords never leave the host.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "letmein", "welcome", "welcome1", "admin", "administrator",
  "iloveyou", "sunshine", "monkey", "dragon", "football", "baseball", "master",
  "superman", "batman", "trustno1", "shadow", "aviation", "pilot123", "flying",
  "changeme", "default", "secret", "abc123", "passw0rd", "p@ssword", "p@ssw0rd",
]);

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function validatePassword(password: string): PasswordCheck {
  if (password.length < 12) return { ok: false, error: "Password must be at least 12 characters." };
  if (!/[A-Z]/.test(password)) return { ok: false, error: "Add at least one uppercase letter." };
  if (!/[a-z]/.test(password)) return { ok: false, error: "Add at least one lowercase letter." };
  if (!/[0-9]/.test(password)) return { ok: false, error: "Add at least one number." };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, error: "Add at least one special character." };
  const normalized = password.toLowerCase().replace(/[^a-z0-9@]/g, "");
  for (const common of COMMON_PASSWORDS) {
    if (normalized.includes(common)) {
      return { ok: false, error: "That password appears in known breach lists — choose something less common." };
    }
  }
  return { ok: true };
}
