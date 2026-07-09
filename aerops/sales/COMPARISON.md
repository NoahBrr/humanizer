# AeroOps vs. the Incumbents — Feature Comparison

**For:** flight schools, flying clubs, universities, FBOs, maintenance shops, and corporate flight departments evaluating an operations platform.
**As of:** 2026 · **Prepared by:** AeroOps

---

## How to read this sheet

- Every cell is **AeroOps's positioning based on publicly available information**, not a certified audit of a competitor's product.
- **Competitor cells should be verified directly with that vendor** before you make a decision. Product capabilities change; ours and theirs.
- **Unknown = we could not independently confirm it** from public information. We would rather write "Unknown" than claim something about a competitor we can't stand behind in front of you.
- For **AeroOps**, a check mark (✓) means the capability is **shipped and running today**. **"Roadmap"** means it is planned and has a defined seam in the product, but is **not live yet**. We hold ourselves to the same honesty we ask of the competitors.

**Legend:** ✓ = present · **partial** = present but limited or add-on · ✗ = not offered · **Unknown** = not independently verified · **Roadmap** = planned, not yet shipped (AeroOps only)

---

## The comparison

| Capability | **AeroOps** | Flight Schedule Pro | Flight Circle | Talon Systems (Talon.aero) | FlightLogger |
|---|:--:|:--:|:--:|:--:|:--:|
| **Scheduling** — aircraft/instructor/room booking, conflict detection | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Dispatch** — release checklist + Hobbs/Tach closeout | ✓ | partial | Unknown | Unknown | Unknown |
| **Maintenance** — squawks, work orders, return-to-service | ✓ | partial | partial | Unknown | Unknown |
| **Billing** — auto-invoice generated *from* the dispatch closeout | ✓ | Unknown | partial | Unknown | Unknown |
| **Training records / checkride readiness** — stages, endorsements, hours | ✓ | partial | partial | ✓ | ✓ |
| **Cloud / true SaaS** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Modern UI** — fast, dark-mode-native, enterprise-calm | ✓ | Unknown | Unknown | Unknown | Unknown |
| **Mobile / PWA** — installable, responsive, bottom-nav | ✓ (installable PWA) | ✓ (mobile app) | ✓ (mobile app) | Unknown | Unknown |
| **Automation / domain events** — events fire on release, closeout, ground | ✓ | Unknown | Unknown | Unknown | Unknown |
| **Role-based dashboards** — the screen changes per seat, gated by permission | ✓ | Unknown | Unknown | Unknown | Unknown |
| **Reporting / executive view** — utilization, revenue, AR aging | ✓ | partial | partial | ✓ | partial |
| **Import from a competitor** — mapped, tested, rollback-able | ✓ (Import Center) | Unknown | Unknown | Unknown | Unknown |
| **Immutable audit trail** — every mutation logged, first-class surface | ✓ | Unknown | Unknown | Unknown | Unknown |
| **Multi-tenant security** — org scope from session, tenant isolation | ✓ | Unknown | Unknown | Unknown | Unknown |
| **Public API + signed webhooks** | ✓ | Unknown | Unknown | Unknown | Unknown |

---

## Where AeroOps is honestly *not* finished yet

A six-figure buyer will test claims, so here is the roadmap line — stated before you ask:

| Capability | Status today | Notes |
|---|---|---|
| **Customer card payments on invoices** | **Roadmap** | Invoices, ledgers, payments, and AR aging are live in-app; the Stripe Connect processor seam is built but **not attached**. You can invoice and record payments today; taking a card online is on the roadmap. |
| **Live METAR / TAF weather** | **Roadmap** | Weather is wired to a single source keyed to your active location and is **simulated today** (deterministic generator). The live Aviation Weather adapter swaps in behind the same interface — no screen changes. |
| **Email (verification, resets, invites, digests)** | **Roadmap** | The transactional-email provider is not yet attached; invite links are shown once in-app today. |
| **Document file uploads (object storage)** | **Roadmap** | The document vault is **metadata-only today**; signed-URL file storage (S3/R2) is on the roadmap. |
| **Cross-location / cohort-term reporting roll-ups** | **Roadmap** | Single-location reporting and the executive view ship today; multi-base roll-up and cohort/term grouping are roadmap 1.5. |

Everything else in the main table marked ✓ for AeroOps is **shipped and demonstrable in a live session** on the demo org (Golden Gate Aviation Academy).

---

## The one row that decides it

Most tools in this category do scheduling, and several do it well. The difference that matters operationally is the **dispatch → closeout → invoice "one motion."**

In AeroOps, when a flight closes out, a **single database transaction** does all of this atomically:

1. Flips the dispatch RELEASED → CLOSED (guarded so a double-submit can't bill twice).
2. Computes billable time from the Hobbs delta.
3. Rolls the aircraft meters forward — Hobbs, Tach, engine time (SMOH), prop time.
4. Logs the pilot/student time (dual received/given or PIC, solo hours).
5. Generates the invoice with line items (aircraft wet rate + instructor time).
6. Decrements the student's account balance.
7. Optionally captures a squawk (GROUNDING / MAJOR / MINOR) that flows straight to Maintenance.

Either **all of it happens or none of it does.** That is why revenue leakage — the flight that flew but never got billed — is *structurally* impossible in AeroOps, not merely discouraged by a checklist. For every competitor cell touching this workflow we wrote **Unknown or partial**, because we cannot verify from public information that any of them binds meters, ledgers, and invoices into a single atomic transaction. Ask them to show you.

---

## What this sheet deliberately does not claim

- We do **not** claim AeroOps is cheaper, bigger, or more mature than any incumbent. Flight Schedule Pro and Flight Circle have years of installed base; Talon serves collegiate programs at a scale we are growing toward; FlightLogger has deep Part 141 / EASA training pedigree.
- We do **not** compete on flight planning / EFB (that's ForeFlight's territory — we integrate), airline/Part 121 ops, avionics hardware, or being your general ledger.
- We compete on being **one connected operating system** — where the schedule knows the airplane is grounded, the invoice knows the flight closed, and every answer the system gives carries its reasons — with an **import path out of whatever you use now, including a rollback if the test import scares you.**
