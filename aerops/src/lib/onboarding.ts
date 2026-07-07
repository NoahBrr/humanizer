import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { createToken, hashToken } from "@/lib/tokens";

/**
 * Public onboarding engine: individual accounts, self-serve organization
 * creation, join requests, and shareable invite links. Every decision here
 * carries its reasons (returned error strings) and every mutation is audited
 * by the calling route.
 */

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

export async function uniqueSlug(base: string) {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    if (!(await db.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    slug = `${slugify(base)}-${i}`;
  }
}

/** Roles an outsider may request / an invite link may grant. */
export const JOINABLE_ROLES: Role[] = ["STUDENT", "INSTRUCTOR", "DISPATCHER", "MAINTENANCE", "ACCOUNTANT", "SCHOOL_ADMIN"];

// --- Individual accounts -----------------------------------------------------

export async function createIndividualAccount(input: { email: string; password: string; firstName: string; lastName: string; phone?: string }) {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { error: "An account with that email already exists. Sign in instead." };
  const platformClash = await db.platformUser.findUnique({ where: { email }, select: { id: true } });
  if (platformClash) return { error: "That email cannot be used for a customer account." };

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(input.password, 10),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: "STUDENT", // provisional; real role assigned on join/create
      organizationId: null,
    },
    select: { id: true, email: true },
  });
  return { user };
}

// --- Self-serve organization creation ----------------------------------------

export type CreateOrgInput = {
  name: string;
  businessProfiles: string[];
  location: { name: string; icao?: string };
  timeZone?: string;
  phone?: string;
  inviteEmails?: string[];
};

export async function createOrganizationForUser(userId: string, input: CreateOrgInput) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, firstName: true, lastName: true, email: true } });
  if (!user) return { error: "Account not found." };
  if (user.organizationId) return { error: "You already belong to an organization." };

  const starter = await db.subscriptionPlan.findFirst({ where: { name: "Starter" } });
  const slug = await uniqueSlug(input.name);

  const org = await db.organization.create({
    data: {
      name: input.name,
      slug,
      timeZone: input.timeZone ?? "America/New_York",
      planId: starter?.id,
      businessProfiles: input.businessProfiles,
      ownerId: user.id,
      locations: { create: { name: input.location.name, icao: input.location.icao, timeZone: input.timeZone ?? "America/New_York" } },
      orgRoles: {
        create: Object.entries(DEFAULT_ROLE_PERMISSIONS)
          .filter(([name]) => name !== "SUPER_ADMIN")
          .map(([name, permissions]) => ({ name, permissions: [...permissions], isSystem: true })),
      },
    },
  });

  await db.user.update({
    where: { id: user.id },
    data: { organizationId: org.id, role: "SCHOOL_ADMIN", phone: input.phone ?? undefined },
  });

  // Team invitations: mint a real single-use token per invite and return the
  // shareable URL to the caller (the raw token exists only here, like every
  // other invite create site) — never a dead hash-only row.
  const invites: { email: string; url: string }[] = [];
  for (const raw of input.inviteEmails ?? []) {
    const email = raw.toLowerCase().trim();
    if (!email || email === user.email) continue;
    const { raw: token, hash: tokenHash } = createToken();
    const created = await db.invitation.create({
      data: {
        organizationId: org.id,
        email,
        role: "STUDENT",
        tokenHash,
        invitedBy: `${user.firstName} ${user.lastName}`,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    }).catch(() => null); // duplicate invites are fine to skip
    if (created) invites.push({ email, url: `/invite/${token}` });
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.id,
    actorLabel: `${user.firstName} ${user.lastName}`,
    action: "org.self_serve_create",
    entityType: "Organization",
    entityId: org.id,
    newValue: { name: org.name, slug, businessProfiles: input.businessProfiles, invited: invites.length },
  });

  return { org, invites };
}

// --- Organization search -------------------------------------------------------

export async function searchOrganizations(q: string) {
  const query = q.trim();
  if (query.length < 2) return [];
  return db.organization.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { slug: { equals: query.toLowerCase() } },
        { locations: { some: { OR: [
          { icao: { equals: query.toUpperCase() } },
          { name: { contains: query, mode: "insensitive" } },
          { address: { contains: query, mode: "insensitive" } },
        ] } } },
      ],
    },
    select: {
      id: true, name: true, slug: true, brandColor: true, businessProfiles: true,
      locations: { select: { name: true, icao: true }, take: 3 },
      _count: { select: { users: true, aircraft: true } },
    },
    take: 12,
    orderBy: { name: "asc" },
  });
}

// --- Join request approval -----------------------------------------------------

export async function approveJoinRequest(
  requestId: string,
  decidedBy: string,
  opts: { role?: Role; locationId?: string; adminNote?: string },
) {
  const request = await db.joinRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, organizationId: true, firstName: true, lastName: true } }, organization: { select: { id: true, name: true } } },
  });
  if (!request) return { error: "Request not found." };
  if (request.status === "APPROVED") return { error: "Already approved." };
  if (request.user.organizationId) return { error: "This user already belongs to an organization." };

  const role = opts.role ?? request.requestedRole;
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: request.userId },
      data: { organizationId: request.organizationId, role, primaryLocationId: opts.locationId ?? null },
    });
    await tx.joinRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", assignedRole: role, assignedLocationId: opts.locationId, adminNote: opts.adminNote, decidedByLabel: decidedBy, decidedAt: new Date() },
    });
    if (role === "STUDENT") {
      // Students need a training profile to appear in scheduling/training.
      await tx.student.upsert({ where: { userId: request.userId }, update: {}, create: { userId: request.userId } });
    }
    await tx.notification.create({
      data: {
        organizationId: request.organizationId,
        userId: request.userId,
        kind: "GENERAL",
        title: `Welcome to ${request.organization.name}!`,
        body: `Your request to join was approved. You've been added as ${role.toLowerCase().replaceAll("_", " ")}.`,
      },
    });
  });
  return { request, role };
}

// --- Invite links ----------------------------------------------------------------

export async function redeemInviteLink(token: string, userId: string) {
  const link = await db.inviteLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: { select: { id: true, name: true, status: true, deletedAt: true } } } });
  if (!link || link.revokedAt) return { error: "This invite link is no longer valid." };
  if (link.expiresAt && link.expiresAt < new Date()) return { error: "This invite link has expired." };
  if (link.maxUses !== null && link.uses >= link.maxUses) return { error: "This invite link has reached its maximum uses." };
  if (link.organization.status !== "ACTIVE" || link.organization.deletedAt) return { error: "This organization is not accepting new members." };

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, firstName: true, lastName: true } });
  if (!user) return { error: "Account not found." };
  if (user.organizationId) return { error: "You already belong to an organization." };

  if (link.autoApprove) {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { organizationId: link.organizationId, role: link.role } });
      if (link.role === "STUDENT") {
        await tx.student.upsert({ where: { userId }, update: {}, create: { userId } });
      }
      await tx.inviteLink.update({ where: { id: link.id }, data: { uses: { increment: 1 } } });
      await tx.notification.create({
        data: {
          organizationId: link.organizationId,
          userId,
          kind: "GENERAL",
          title: `Welcome to ${link.organization.name}!`,
          body: `You joined via an invite link as ${link.role.toLowerCase().replaceAll("_", " ")}.`,
        },
      });
    });
    return { joined: true as const, orgName: link.organization.name, role: link.role };
  }

  // Approval required: file a pre-filled join request.
  const existing = await db.joinRequest.findFirst({ where: { userId, organizationId: link.organizationId, status: { in: ["PENDING", "MORE_INFO"] } } });
  if (existing) return { joined: false as const, orgName: link.organization.name, role: link.role, requestId: existing.id };
  const request = await db.joinRequest.create({
    data: {
      organizationId: link.organizationId,
      userId,
      requestedRole: link.role,
      reason: `Joined via invite link "${link.label}"`,
    },
  });
  await db.inviteLink.update({ where: { id: link.id }, data: { uses: { increment: 1 } } });
  return { joined: false as const, orgName: link.organization.name, role: link.role, requestId: request.id };
}
