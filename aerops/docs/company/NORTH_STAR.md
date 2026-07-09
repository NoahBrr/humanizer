# AeroOps — North Star

The highest-level guiding document for the company. Everything else —
vision, principles, architecture, roadmap — elaborates this page. It is
deliberately short; if it grows past two pages it has stopped being a north
star and become a policy manual.

## What must never change

1. **Tenant isolation is absolute.** One organization's data never reaches
   another, structurally, not procedurally.
2. **Safety logic has no convenience override.** A grounded aircraft cannot
   be released; a system that allows "just this once" is not AeroOps.
3. **The audit trail is immutable.** Never rewritten, never skipped, never
   made optional — it is the product's spine and the customer's legal
   defensibility.
4. **Money moves atomically and in `Decimal`.** A flight that closes bills
   correctly or the closeout fails whole.
5. **Computed answers explain themselves.** Scores, conflicts, insights,
   and forecasts carry their reasons; AeroOps never asks to be trusted on
   authority.
6. **AI advises; humans act.** No AI pathway mutates operational, financial,
   or training data.
7. **The customer can always leave.** Import has rollback; export exists;
   data hostage-taking is the incumbents' moat, never ours.
8. **Aviation-first language and semantics.** The day AeroOps says "ticket"
   instead of "squawk," it has lost the thread.

## What AeroOps is ultimately trying to become

**The system of record for small-to-mid aviation operations** — the layer
where an operation's aircraft, people, schedule, training, money, and
compliance live as one continuously reconciled, self-explaining whole. Not
the best scheduler, the best maintenance tracker, or the best invoicing
tool: the *operating system* those tools were fragments of.

## What makes AeroOps indispensable to flight schools

Indispensable means: switching away would feel like giving up the
instrument panel and flying by feel.

- **The morning picture**: sign in and know — flights, availability,
  weather, money, and what needs attention — before the first phone call.
- **Closed-loop money**: every closed flight already invoiced; receivables
  visible; leakage structurally impossible.
- **Airworthiness confidence**: the schedule already knows what maintenance
  knows; nobody dispatches the grounded 172 by accident.
- **The training pipeline made visible**: every student's readiness,
  factor by factor — checkride surprises become extinct.
- **Defensible records**: any question from an examiner, insurer, or
  accreditor answered from the audit trail in minutes.
- **One less job**: the operation runs without a person whose job is
  reconciling the other systems.

## Values that outweigh short-term convenience

| We accept… | To preserve… |
|---|---|
| Release-checklist friction | Safety before convenience |
| Building import/export well | The customer's freedom to leave |
| Explaining every score | Trust through transparency |
| Additive-only migrations, env-flag adapters | Boring, reversible operations |
| Saying no to adjacent-market features | Aviation-first focus |
| Slower "yes" on new dependencies and abstractions | A codebase one person can still reason about |

## Foundational decisions (settled; reopening requires a superseding ADR)

The full log is [../architecture/DECISIONS.md](../architecture/DECISIONS.md);
these are the ones that define the company as much as the code:

- **One platform, one data model** — monolith now, package seams later
  (ADR-001); modules share aircraft, people, billing, and audit rather than
  integrating with each other.
- **Multi-tenant SaaS with a separate platform identity** (ADR-004, ADR-007).
- **Machine-enforced governance** — the constitution tests, and this
  documentation stack as its extension (ADR-005, ADR-019).
- **The single authorization gate and data-driven RBAC** (ADR-006).
- **Atomic dispatch closeout** (ADR-011) and **immutable audit** (ADR-010).
- **Explainable engines** as an architectural property, not a feature.
- **Single sources of truth** — weather, status colors, permissions —
  guarded by tests (ADR-008).
- **Boring, reversible infrastructure** with env-flag adapters (ADR-017).

## How to use this document

Before any significant product or architecture decision: if the proposal
weakens anything under "What must never change," it is rejected regardless
of upside. If it trades a listed value for convenience, it needs an ADR and
an explicit argument here. Otherwise, proceed to
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) and the review board.

## Related documents

[VISION.md](./VISION.md) · [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) ·
[../architecture/DECISIONS.md](../architecture/DECISIONS.md) ·
[../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) ·
[../../CONSTITUTION.md](../../CONSTITUTION.md)
