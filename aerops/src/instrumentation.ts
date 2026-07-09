/**
 * Runs once when the Next.js server boots (Node runtime). Production
 * misconfiguration must refuse startup here — before any request is served,
 * any cookie is issued, or any JWT is signed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("@/lib/env");
    assertProductionEnv();
  }
}
