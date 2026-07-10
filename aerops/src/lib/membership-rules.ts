/**
 * Pure membership-selection rules (ADR-023), import-free of server-only modules
 * so the test suite exercises them directly. `projectActiveMembership`
 * (lib/memberships.ts) does the DB reads/writes; this decides WHICH membership
 * is the active one that the User projection reflects.
 */

/**
 * Choose a user's active membership from their active memberships (already
 * filtered to status ACTIVE + a live organization, ordered oldest-first).
 * Deterministic priority: an explicitly preferred org → the current home org →
 * the earliest-joined membership → none (the user becomes an individual account).
 */
export function selectActiveMembership<M extends { organizationId: string }>(
  active: readonly M[],
  homeOrgId: string | null | undefined,
  preferOrgId?: string | null,
): M | null {
  return (
    (preferOrgId ? active.find((m) => m.organizationId === preferOrgId) : undefined) ??
    (homeOrgId ? active.find((m) => m.organizationId === homeOrgId) : undefined) ??
    active[0] ??
    null
  );
}
