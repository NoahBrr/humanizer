/**
 * Secure, idempotent founder bootstrap (Phase D3-A).
 *
 * Provisions the two Founder Super Admins (Noah Shroff, Jack Frey) from
 * PROTECTED environment variables — never from hardcoded, seeded, logged, or
 * committed credentials. Only password hashes are stored; the plaintext is read
 * from the environment, hashed once, and never printed. Safe to rerun: an
 * existing founder is verified (its immutable `isFounder` marker and role are
 * repaired if missing) but its password is NEVER overwritten. Every action is
 * audited. `isFounder` is the immutable founder identity and is set only here —
 * founder power cannot be granted by editing a role in the UI.
 *
 * Usage (never commit real values — set them in a secrets manager / deploy env):
 *   FOUNDER_BOOTSTRAP=1 FOUNDER_NOAH_PASSWORD=… FOUNDER_JACK_PASSWORD=… \
 *     npm run bootstrap:founders
 *
 * After production initialization, UNSET `FOUNDER_BOOTSTRAP` so the process is
 * disabled. The founders must rotate their password on first sign-in
 * (mustChangePassword), so even the initial env password is single-use.
 */
import { PrismaClient, PlatformRole, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { validatePassword } from "../src/lib/password";

const db = new PrismaClient();

// The two founders receive EQUAL authority. Emails/names are identities (not
// secrets) and are the whole point of this bootstrap; passwords come only from
// the mapped protected env var.
const FOUNDERS = [
  { email: "noahkshroff@gmail.com", firstName: "Noah", lastName: "Shroff", passwordEnv: "FOUNDER_NOAH_PASSWORD" },
  { email: "freyjack2@gmail.com", firstName: "Jack", lastName: "Frey", passwordEnv: "FOUNDER_JACK_PASSWORD" },
] as const;

async function audit(action: string, entityId: string, newValue: Prisma.InputJsonValue) {
  await db.auditLog.create({
    data: { actorLabel: "Founder bootstrap (system)", action, entityType: "PlatformUser", entityId, newValue },
  });
}

async function main() {
  // Gate: disabled unless explicitly enabled with a truthy value, so it can be
  // switched off after production init. FOUNDER_BOOTSTRAP=0/false/off all DISABLE
  // it (a bare non-empty string like "0" must not accidentally enable it).
  const gate = (process.env.FOUNDER_BOOTSTRAP ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(gate)) {
    console.error("Refusing to run: set FOUNDER_BOOTSTRAP=1 to enable the founder bootstrap (then unset it after init).");
    process.exit(2);
  }

  let created = 0;
  let verified = 0;
  for (const f of FOUNDERS) {
    const email = f.email.toLowerCase();
    const existing = await db.platformUser.findUnique({ where: { email }, select: { id: true, isFounder: true, role: true } });

    if (existing) {
      // Idempotent identity/role repair — NEVER touches the password.
      const needsRepair = !existing.isFounder || existing.role !== PlatformRole.FOUNDER_SUPER_ADMIN;
      if (needsRepair) {
        await db.platformUser.update({ where: { id: existing.id }, data: { isFounder: true, role: PlatformRole.FOUNDER_SUPER_ADMIN } });
        await audit("founder.bootstrap_repaired", existing.id, { email, isFounder: true, role: "FOUNDER_SUPER_ADMIN" });
      }
      console.log(`  ✓ verified founder ${email}${needsRepair ? " (identity/role repaired)" : ""}`);
      verified++;
      continue;
    }

    // New founder — the initial password MUST come from the protected env var.
    const password = process.env[f.passwordEnv];
    if (!password) {
      console.error(`Refusing to create ${email}: set ${f.passwordEnv} (a protected env var) to an initial password.`);
      process.exit(3);
    }
    const policy = validatePassword(password);
    if (!policy.ok) {
      console.error(`Refusing to create ${email}: initial password does not meet the policy — ${policy.error}`);
      process.exit(4);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const pu = await db.platformUser.create({
      data: {
        email,
        passwordHash,
        firstName: f.firstName,
        lastName: f.lastName,
        role: PlatformRole.FOUNDER_SUPER_ADMIN,
        isFounder: true,
        mustChangePassword: true,
        invitedByLabel: "Founder bootstrap",
      },
      select: { id: true },
    });
    await audit("founder.bootstrap_created", pu.id, { email, role: "FOUNDER_SUPER_ADMIN", isFounder: true, mustChangePassword: true });
    console.log(`  ✓ created founder ${email} (must rotate password on first sign-in)`);
    created++;
  }

  const activeFounders = await db.platformUser.count({ where: { isFounder: true, isActive: true } });
  console.log(`\nFounder bootstrap complete — ${created} created, ${verified} verified. Active founders: ${activeFounders}.`);
  // The bootstrap only ADDS founders; this is an assertion, never a mutation.
  if (activeFounders < 1) {
    console.error("FATAL: no active founder remains after bootstrap.");
    process.exit(5);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error("Bootstrap failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
