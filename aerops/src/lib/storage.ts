import "server-only";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";

/**
 * Object-storage seam. Every consumer talks to this interface, never to a
 * concrete backend, so swapping the local dev adapter for Cloudflare R2 in
 * production is a `getStorage()` change and nothing else. The key is an opaque
 * path-like string produced by lib/upload-validation (`safeLogoKey`).
 */
export interface StorageAdapter {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * Development adapter: writes objects to `public/uploads/<key>` and serves them
 * as Next static assets at `/uploads/<key>`. Not for production — objects live
 * on the app server's local disk (lost on redeploy, not shared across
 * instances). Content type is ignored: the static file server derives it from
 * the extension baked into the key.
 */
export class LocalStorageAdapter implements StorageAdapter {
  // Content type is intentionally not consumed — the static file server derives
  // it from the extension in the key (the interface's param is omitted here).
  async put(key: string, bytes: Buffer): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  url(key: string): string {
    return "/uploads/" + key;
  }

  /** Defense in depth: keys are already server-generated, but never let one
   *  escape the uploads root even if a caller passes a crafted key. */
  private resolve(key: string): string {
    const dest = path.resolve(UPLOADS_ROOT, key);
    if (dest !== UPLOADS_ROOT && !dest.startsWith(UPLOADS_ROOT + path.sep)) {
      throw new Error("Refusing to access a path outside the uploads directory");
    }
    return dest;
  }
}

const R2_ENV_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

/**
 * Cloudflare R2 seam — intentionally a stub. The S3-compatible network client
 * is not wired up yet (no dependency is added until R2 is the chosen production
 * target). Every method throws so the system can never silently believe R2 is
 * live; when R2 ships, implement these three methods and nothing else changes.
 */
export class R2StorageAdapter implements StorageAdapter {
  async put(): Promise<void> {
    throw new Error("R2 adapter not implemented");
  }
  async delete(): Promise<void> {
    throw new Error("R2 adapter not implemented");
  }
  url(): string {
    throw new Error("R2 adapter not implemented");
  }
}

/**
 * Select the storage backend from the environment. Unset or "local" gives the
 * filesystem adapter. "r2" without its full credential set THROWS rather than
 * degrading silently — a misconfigured production storage layer must fail loudly
 * at first use, never pretend to work and drop uploads on the floor.
 */
export function getStorage(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  if (provider === "local") return new LocalStorageAdapter();
  if (provider === "r2") {
    const missing = R2_ENV_KEYS.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`R2 storage selected but not configured — set ${missing.join(", ")}.`);
    }
    return new R2StorageAdapter();
  }
  throw new Error(`Unknown STORAGE_PROVIDER "${provider}" — expected "local" or "r2".`);
}
