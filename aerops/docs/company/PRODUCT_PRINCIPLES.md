# AeroOps — Product Principles

Twelve principles that decide features. When a proposal, review, or design
debate stalls, these are the tiebreakers — in tension, the earlier
principle usually wins (Aviation First and Safety outrank everything).
Companions: [VISION.md](./VISION.md) (why we exist),
[NORTH_STAR.md](./NORTH_STAR.md) (what never changes). The AI CTO and
Product Manager gates ([../engineering/AI_REVIEW_BOARD.md](../engineering/AI_REVIEW_BOARD.md))
review against this document.

## 1. Aviation First

**Why:** generic scheduling software with aviation paint is exactly what
the incumbents built; the domain *is* the product.
**In practice:** FAA terminology everywhere (dispatch, release, closeout,
squawk — never "ticket" or "check-in"); tail numbers as identity; Hobbs/Tach
as first-class data; Part 61/141 structures native, not configured.
[../aviation/AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md) is
this principle as a checklist. A feature that would work identically for a
yoga studio is under-designed for AeroOps.

## 2. Safety Before Convenience

**Why:** this software sits in front of real aircraft and real students.
**In practice:** airworthiness blocks release, and there is no
convenience override for a grounded aircraft; safety-relevant friction
(release checklist, signed return-to-service) is legitimate friction. When
"fewer clicks" and "harder to do the unsafe thing" conflict, safety wins —
then we engineer the safe path to be fast too.

## 3. Every Click Saves Time

**Why:** the front desk uses this 200 times a day; wasted motion compounds.
**In practice:** the dashboard answers "what needs attention" before it is
asked; closeout generates the invoice instead of prompting someone to;
remembered import mappings, drag-to-book, ⌘K palette. New workflows are
measured in clicks-to-done, and a step that exists only to feed the
database (instead of the operation) gets automated or deleted.

## 4. Multi-Tenant by Design

**Why:** isolation retrofits fail; the platform economics of the vision
require thousands of orgs on one system.
**In practice:** every operational record hangs off `Organization`; org
scope comes from the session, never the client; cross-tenant surfaces exist
only behind the platform identity. This principle is machine-enforced
(constitution tests) and do-not-break tier.

## 5. Mobile First

**Why:** the operation happens on the ramp, in the run-up area, and on the
hangar floor — not at a desk.
**In practice:** every page works at phone width (bottom nav below `lg`);
the PWA installs to the home screen; the mobile flow is designed for
one hand and sunlight, not shrunk from desktop. A feature that ships
desktop-only is half-shipped.

## 6. Accessibility Always

**Why:** professional software serves everyone on staff, and accessible
design is better design under stress (glare, gloves, haste).
**In practice:** WCAG AA contrast in both themes, keyboard reachability,
focus-trapped drawers, reduced-motion honored globally, status never
conveyed by color alone. Accessibility findings are UX-gate blockers, not
backlog items.

## 7. Security by Default

**Why:** we hold operations' customer data, money records, and training
records; trust lost once is lost.
**In practice:** one authorization gate on every route; RBAC as data; MFA;
immutable audit; impersonation read-only and customer-visible; secrets
never in the repo; AI never mutates. The secure path is the default path —
security features that require opt-in configuration are design failures.
[../architecture/SECURITY_STANDARDS.md](../architecture/SECURITY_STANDARDS.md)
operationalizes this.

## 8. Performance Matters

**Why:** the schedule board is compared to a whiteboard — the whiteboard
never spins.
**In practice:** budgets are stated and reviewed (dashboard < 2 s, schedule
interactions < 500 ms, test suite ~1 s); Mission Control streams instead of
polling; the Performance gate reviews query shape before merge. Slow is a
bug, not a tradeoff silently accepted.

## 9. Everything Auditable

**Why:** aviation is a regulated, liability-heavy domain; "who did what,
when" is product value, not overhead.
**In practice:** every important mutation writes the immutable audit trail
with actor/org/IP; imports track every created record for rollback; the
audit log is a visible surface (Mission Control timeline), which keeps it
honest. A mutation path that skips `recordAudit` fails review automatically.

## 10. Simplicity Over Complexity

**Why:** a 5-aircraft club adopts AeroOps in an afternoon or not at all.
**In practice:** self-serve onboarding; business profiles enable only the
modules an operation needs; conventions over configuration; one obvious way
to do each task. Internally the same rule: extend existing engines, never
invent parallel abstractions — simple beats clever (CLAUDE.md §3).

## 11. Powerful When Necessary

**Why:** simplicity must not cap the ceiling — operations grow into
multi-location schools with custom roles and API integrations.
**In practice:** depth reveals progressively: custom RBAC roles, API keys
and signed webhooks, multi-location weather and ops boards, import
tooling, Mission Control scenes — all present, none demanded up front. The
test: the simple case stays simple *after* the powerful case ships.

## 12. Consistency Above Novelty

**Why:** an operations tool is used at 6 AM, under stress, by habit; novelty
taxes exactly the moments that matter.
**In practice:** one design system (tokens, primitives,
[../design/DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md)); status colors
frozen in meaning (machine-tested); the same pattern for every list, form,
and empty state; aviation-professional and enterprise-calm, no trend-chasing.
A redesign must argue against this principle explicitly — "fresher" is not
an argument.

## Related documents

[VISION.md](./VISION.md) · [NORTH_STAR.md](./NORTH_STAR.md) ·
[../design/DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md) ·
[../aviation/AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md) ·
[../engineering/AI_REVIEW_BOARD.md](../engineering/AI_REVIEW_BOARD.md) ·
[../../CONSTITUTION.md](../../CONSTITUTION.md)
