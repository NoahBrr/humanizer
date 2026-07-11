import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePayer } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { resolvePayerScope } from "@/lib/payers";
import {
  CONSENT_VERSION,
  CONSENT_TEXT_HASH,
  safeMethodDisplay,
  isConsentValid,
  createSetupSessionStub,
} from "@/lib/payment-methods";

/**
 * Payer self-service payment methods (doc 20 Part Q, doc 36 §5.2). The signed-in
 * payer lists / adds / re-defaults / detaches the saved methods on the payment
 * customers THEY own (resolved from their own ACTIVE ResponsiblePayer rows, never
 * a client-supplied id). Every write is scoped to a customer the caller owns.
 *
 * NO PROVIDER SDK, NO CHARGING. "Add method" is a DEV/FOUNDATION action: it runs
 * the provider-independent `createSetupSessionStub` and records a
 * PaymentMethodReference with FAKE safe metadata (visa ····4242) plus an accepted
 * off-session consent. Nothing here ever stores a PAN, CVV, bank number, or raw
 * token/secret — only the safe allowlist columns and opaque refs (principle 8).
 */

const NONE = ["__none__"];

/** Payment customers the acting payer owns, with their methods + consents. */
async function ownedCustomers(userId: string) {
  const scope = await resolvePayerScope(userId);
  const customers = await db.paymentCustomer.findMany({
    where: { payerId: { in: scope.payerIds.length ? scope.payerIds : NONE } },
    include: {
      methods: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      consents: true,
    },
  });
  return { scope, customers };
}

export async function GET() {
  const { session, error } = await authorizePayer();
  if (error) return error;
  const { customers } = await ownedCustomers(session.userId);

  const methods = customers.flatMap((c) =>
    c.methods.map((m) => ({
      id: m.id,
      type: m.type,
      status: m.status,
      isDefault: m.isDefault,
      display: safeMethodDisplay(m),
      brand: m.brand,
      last4: m.last4,
      expMonth: m.expMonth,
      expYear: m.expYear,
      consentValid: c.consents.some((k) => k.paymentMethodReferenceId === m.id && isConsentValid(k, CONSENT_VERSION)),
    })),
  );
  return NextResponse.json({ methods });
}

const addSchema = z.object({
  payerId: z.string().trim().min(1).optional(),
  methodType: z.enum(["card", "us_bank_account"]).optional(),
});

export async function POST(req: Request) {
  const { session, error } = await authorizePayer({ mutating: true });
  if (error) return error;

  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const methodType = parsed.data.methodType ?? "card";

  const scope = await resolvePayerScope(session.userId);
  if (!scope.isPayer) return NextResponse.json({ error: "You aren't set up as a payer yet." }, { status: 403 });

  // Choose the payer to attach to: an explicit id must be one the caller owns;
  // otherwise their first payer identity.
  const payerId = parsed.data.payerId ?? scope.payerIds[0];
  if (!scope.payerIds.includes(payerId)) return NextResponse.json({ error: "That payer isn't yours." }, { status: 403 });

  const payer = await db.responsiblePayer.findFirst({ where: { id: payerId, status: "ACTIVE" }, select: { id: true, organizationId: true } });
  if (!payer) return NextResponse.json({ error: "Payer not found." }, { status: 404 });

  const h = await headers();
  const ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const userAgent = h.get("user-agent")?.slice(0, 250) ?? null;
  const acceptedByLabel = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const storedType = methodType === "card" ? "CARD" : "US_BANK_ACCOUNT";

  // Dev fixtures — clearly fake safe metadata, never a real card.
  const fakeCard = { brand: "visa", last4: "4242", expMonth: 12, expYear: new Date().getFullYear() + 3 };
  const fakeBank = { bankName: "Test Bank", last4: "6789" };

  const method = await db.$transaction(async (tx) => {
    // Ensure a PaymentCustomer for this payer (unique per org+payer).
    const customer = await tx.paymentCustomer.upsert({
      where: { organizationId_payerId: { organizationId: payer.organizationId, payerId: payer.id } },
      create: {
        organizationId: payer.organizationId,
        provider: "STRIPE",
        providerCustomerId: `cus_stub_${payer.id}`,
        payerId: payer.id,
      },
      update: {},
    });

    // Provider-independent setup stub — a unique nonce keeps each setup ref (and
    // the consent's providerSetupIntentId unique constraint) distinct per add.
    const setup = createSetupSessionStub({ customerRef: `${customer.providerCustomerId}:${randomUUID()}`, methodType });

    const activeCount = await tx.paymentMethodReference.count({ where: { paymentCustomerId: customer.id, status: "ACTIVE" } });

    const created = await tx.paymentMethodReference.create({
      data: {
        organizationId: payer.organizationId,
        paymentCustomerId: customer.id,
        provider: "STRIPE",
        providerPaymentMethodId: `pm_stub_${randomUUID()}`,
        type: storedType,
        status: "ACTIVE",
        isDefault: activeCount === 0, // first method on file becomes default
        fingerprint: `fp_stub_${randomUUID().slice(0, 12)}`,
        ...(storedType === "CARD" ? fakeCard : fakeBank),
      },
    });

    await tx.paymentConsent.create({
      data: {
        organizationId: payer.organizationId,
        paymentCustomerId: customer.id,
        payerId: payer.id,
        paymentMethodReferenceId: created.id,
        methodType: storedType,
        methodBrand: created.brand,
        methodLast4: created.last4,
        consentVersion: CONSENT_VERSION,
        consentTextHash: CONSENT_TEXT_HASH,
        channel: "METHOD_SETUP",
        acceptedAt: new Date(),
        acceptedByUserId: session.userId,
        acceptedByLabel,
        ipAddress,
        userAgent,
        provider: "STRIPE",
        providerSetupIntentId: setup.setupRef,
      },
    });
    return created;
  });

  await recordAudit({
    organizationId: payer.organizationId,
    actorUserId: session.userId,
    actorLabel: acceptedByLabel,
    action: "revenue.payment_method.add",
    entityType: "PaymentMethodReference",
    entityId: method.id,
    newValue: { type: method.type, brand: method.brand, last4: method.last4, isDefault: method.isDefault, dev: true },
  });
  return NextResponse.json({ method: { id: method.id, display: safeMethodDisplay(method), isDefault: method.isDefault } }, { status: 201 });
}

const patchSchema = z.object({ methodId: z.string().trim().min(1) });

export async function PATCH(req: Request) {
  const { session, error } = await authorizePayer({ mutating: true });
  if (error) return error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A methodId is required." }, { status: 400 });

  const { scope } = await ownedCustomers(session.userId);
  const method = await db.paymentMethodReference.findFirst({
    where: { id: parsed.data.methodId, status: "ACTIVE", customer: { payerId: { in: scope.payerIds.length ? scope.payerIds : NONE } } },
    select: { id: true, paymentCustomerId: true, organizationId: true },
  });
  if (!method) return NextResponse.json({ error: "Payment method not found." }, { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.paymentMethodReference.updateMany({ where: { paymentCustomerId: method.paymentCustomerId, isDefault: true }, data: { isDefault: false } });
    await tx.paymentMethodReference.update({ where: { id: method.id }, data: { isDefault: true } });
  });

  await recordAudit({
    organizationId: method.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`.trim() || session.email,
    action: "revenue.payment_method.set_default",
    entityType: "PaymentMethodReference",
    entityId: method.id,
    newValue: { isDefault: true },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { session, error } = await authorizePayer({ mutating: true });
  if (error) return error;
  const methodId = new URL(req.url).searchParams.get("methodId");
  if (!methodId) return NextResponse.json({ error: "A methodId is required." }, { status: 400 });

  const { scope } = await ownedCustomers(session.userId);
  const method = await db.paymentMethodReference.findFirst({
    where: { id: methodId, customer: { payerId: { in: scope.payerIds.length ? scope.payerIds : NONE } } },
    select: { id: true, organizationId: true, status: true, isDefault: true, paymentCustomerId: true },
  });
  if (!method) return NextResponse.json({ error: "Payment method not found." }, { status: 404 });
  if (method.status === "DETACHED") return NextResponse.json({ error: "This method is already detached." }, { status: 409 });

  let promotedId: string | null = null;
  await db.$transaction(async (tx) => {
    // Detach (never delete) + drop the default flag so nothing detached is default.
    await tx.paymentMethodReference.update({ where: { id: method.id }, data: { status: "DETACHED", detachedAt: new Date(), isDefault: false } });
    // Supersede its still-standing consents — a detached method can't be charged.
    await tx.paymentConsent.updateMany({
      where: { paymentMethodReferenceId: method.id, revokedAt: null, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    // If the detached method was the default, promote the newest surviving ACTIVE
    // method so the customer keeps a persisted default (doc 20 §3.4).
    if (method.isDefault) {
      const survivor = await tx.paymentMethodReference.findFirst({
        where: { paymentCustomerId: method.paymentCustomerId, status: "ACTIVE", id: { not: method.id } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (survivor) {
        await tx.paymentMethodReference.update({ where: { id: survivor.id }, data: { isDefault: true } });
        promotedId = survivor.id;
      }
    }
  });

  const actorLabel = `${session.firstName} ${session.lastName}`.trim() || session.email;
  await recordAudit({
    organizationId: method.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: "revenue.payment_method.detach",
    entityType: "PaymentMethodReference",
    entityId: method.id,
    newValue: { status: "DETACHED", promotedDefault: promotedId },
  });
  return NextResponse.json({ ok: true });
}
