import type { PlatformRole, Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string;
    platformRole?: PlatformRole;
    firstName: string;
    lastName: string;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string;
      platformRole?: PlatformRole;
      firstName: string;
      lastName: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    organizationId?: string;
    platformRole?: PlatformRole;
    firstName?: string;
    lastName?: string;
  }
}
