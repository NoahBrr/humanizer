import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no Prisma import) shared by middleware and the
 * full Node auth setup in src/auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isAuthed = !!auth?.user;
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === "/sign-in" || pathname === "/" || pathname.startsWith("/invite/") || pathname === "/api/invitations/accept";
      if (isPublic) return true;
      return isAuthed;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.platformRole = user.platformRole;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as import("@prisma/client").Role;
        session.user.organizationId = token.organizationId as string;
        session.user.platformRole = token.platformRole as import("@prisma/client").PlatformRole | undefined;
        session.user.firstName = token.firstName as string;
        session.user.lastName = token.lastName as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
