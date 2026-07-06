import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyTotp } from "@/lib/totp";
import { authConfig } from "@/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

async function logLogin(data: { email: string; userId?: string; organizationId?: string; platformUserId?: string; success: boolean; reason: string }) {
  try {
    await db.loginEvent.create({ data });
  } catch {
    /* login logging must never block authentication */
  }
}

/** OAuth providers activate only when credentials are configured. */
const oauthProviders = [
  ...(process.env.GOOGLE_CLIENT_ID ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })] : []),
  ...(process.env.MICROSOFT_CLIENT_ID
    ? [MicrosoftEntraID({ clientId: process.env.MICROSOFT_CLIENT_ID, clientSecret: process.env.MICROSOFT_CLIENT_SECRET })]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...oauthProviders,
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        const user = await db.user.findUnique({ where: { email } });
        if (user) {
          if (!user.isActive || user.deletedAt) return null;
          if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
            await logLogin({ email, userId: user.id, organizationId: user.organizationId, success: false, reason: "bad_password" });
            return null;
          }
          if (user.mfaEnabled && user.mfaSecret) {
            if (!parsed.data.totp || !verifyTotp(user.mfaSecret, parsed.data.totp)) {
              await logLogin({ email, userId: user.id, organizationId: user.organizationId, success: false, reason: "mfa_failed" });
              return null;
            }
          }
          await logLogin({ email, userId: user.id, organizationId: user.organizationId, success: true, reason: "ok" });
          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            organizationId: user.organizationId,
            firstName: user.firstName,
            lastName: user.lastName,
            sessionVersion: user.sessionVersion,
          };
        }

        // AeroOps staff sign in through the same form but live in a separate
        // identity table — they are never members of customer organizations.
        const platformUser = await db.platformUser.findUnique({ where: { email } });
        if (platformUser && platformUser.isActive) {
          if (!(await bcrypt.compare(parsed.data.password, platformUser.passwordHash))) {
            await logLogin({ email, platformUserId: platformUser.id, success: false, reason: "bad_password" });
            return null;
          }
          if (platformUser.mfaEnabled && platformUser.mfaSecret) {
            if (!parsed.data.totp || !verifyTotp(platformUser.mfaSecret, parsed.data.totp)) {
              await logLogin({ email, platformUserId: platformUser.id, success: false, reason: "mfa_failed" });
              return null;
            }
          }
          await logLogin({ email, platformUserId: platformUser.id, success: true, reason: "ok" });
          return {
            id: platformUser.id,
            email: platformUser.email,
            name: `${platformUser.firstName} ${platformUser.lastName}`,
            role: "SUPER_ADMIN",
            organizationId: "",
            platformRole: platformUser.role,
            firstName: platformUser.firstName,
            lastName: platformUser.lastName,
            sessionVersion: platformUser.sessionVersion,
          };
        }
        await logLogin({ email, success: false, reason: "unknown_account" });
        return null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // OAuth sign-ins never auto-provision accounts: the email must already
    // belong to an invited org user (least-privilege; invitation is the
    // only way into an organization).
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") return true;
      const existing = await db.user.findUnique({ where: { email: user.email?.toLowerCase() ?? "" } });
      if (!existing || !existing.isActive || existing.deletedAt) return false;
      user.id = existing.id;
      user.role = existing.role;
      user.organizationId = existing.organizationId;
      user.firstName = existing.firstName;
      user.lastName = existing.lastName;
      user.sessionVersion = existing.sessionVersion;
      await logLogin({ email: existing.email, userId: existing.id, organizationId: existing.organizationId, success: true, reason: `oauth_${account.provider}` });
      return true;
    },
  },
});

/** Server helper: current session or throw (for route handlers / pages). */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}
