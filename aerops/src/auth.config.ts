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
      // Public-API requests authenticate with Bearer keys at the route layer.
      if (request.headers.get("authorization")?.startsWith("Bearer aero_")) return true;
      const isAuthed = !!auth?.user;
      const { pathname } = request.nextUrl;
      // Marketing site + auth + tokenized entry points are public.
      const PUBLIC_EXACT = ["/", "/sign-in", "/sign-up", "/login", "/features", "/pricing", "/about", "/contact", "/demo", "/request-flight", "/api/health", "/api/invitations/accept", "/api/auth/register"];
      const PUBLIC_PREFIX = ["/solutions", "/invite/", "/join/"];
      const isPublic =
        PUBLIC_EXACT.includes(pathname) ||
        PUBLIC_PREFIX.some((p) => pathname.startsWith(p)) ||
        (pathname === "/api/leads" && request.method === "POST") ||
        (pathname === "/api/demo-requests" && request.method === "POST");
      if (isPublic) return true;
      return isAuthed;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.platformRole = user.platformRole;
        token.sessionVersion = user.sessionVersion;
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
        session.user.sessionVersion = (token.sessionVersion as number | undefined) ?? 0;
        session.user.firstName = token.firstName as string;
        session.user.lastName = token.lastName as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
