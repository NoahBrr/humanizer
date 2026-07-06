import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        const user = await db.user.findUnique({ where: { email } });
        if (user) {
          if (!user.isActive || user.deletedAt) return null;
          if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return null;
          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            organizationId: user.organizationId,
            firstName: user.firstName,
            lastName: user.lastName,
          };
        }

        // AeroOps staff sign in through the same form but live in a separate
        // identity table — they are never members of customer organizations.
        const platformUser = await db.platformUser.findUnique({ where: { email } });
        if (platformUser && platformUser.isActive && (await bcrypt.compare(parsed.data.password, platformUser.passwordHash))) {
          return {
            id: platformUser.id,
            email: platformUser.email,
            name: `${platformUser.firstName} ${platformUser.lastName}`,
            role: "SUPER_ADMIN",
            organizationId: "",
            platformRole: platformUser.role,
            firstName: platformUser.firstName,
            lastName: platformUser.lastName,
          };
        }
        return null;
      },
    }),
  ],
});

/** Server helper: current session or throw (for route handlers / pages). */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}
