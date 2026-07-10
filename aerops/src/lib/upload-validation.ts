import { randomBytes } from "crypto";

/**
 * Pure, dependency-free upload validation for organization logos. Deliberately
 * DB-free and NOT server-only so it is unit-testable — the security-critical
 * decisions (what bytes we accept, what key we write) live here, verified by
 * tests/upload-security.test.ts. The route layer never re-derives content type
 * or filename from the client; it trusts only what these functions return.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type Sniffed = { ok: true; contentType: string; ext: string };
type Rejected = { ok: false; error: string };

/** File-signature ("magic byte") table. We match the leading bytes of the
 *  decoded payload, never the filename or the client-declared MIME type — those
 *  are trivially forged and are the classic content-sniffing bypass. */
const SIGNATURES = {
  // 89 50 4E 47 0D 0A 1A 0A
  png: { contentType: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  // FF D8 FF
  jpeg: { contentType: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff], offset: 0 },
} as const;

// WebP is a RIFF container: "RIFF" at bytes 0-3, a 4-byte size, then "WEBP" at 8-11.
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function matches(bytes: Buffer, magic: readonly number[], offset: number): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Accept only PNG/JPEG/WebP identified by magic bytes. SVG (script-bearing XML)
 * and HTML are rejected outright — we do not sanitize, we refuse. The returned
 * contentType/ext come from the sniffed signature; `declaredType` is accepted
 * only to make the "we ignore it" contract explicit and testable.
 */
export function validateImageUpload(bytes: Buffer, declaredType?: string): Sniffed | Rejected {
  void declaredType; // intentionally unused: the client-declared type is never trusted.

  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, error: `Logo must be ${MAX_LOGO_BYTES / 1024 / 1024} MB or smaller.` };
  }

  if (matches(bytes, SIGNATURES.png.magic, SIGNATURES.png.offset)) {
    return { ok: true, contentType: SIGNATURES.png.contentType, ext: SIGNATURES.png.ext };
  }
  if (matches(bytes, SIGNATURES.jpeg.magic, SIGNATURES.jpeg.offset)) {
    return { ok: true, contentType: SIGNATURES.jpeg.contentType, ext: SIGNATURES.jpeg.ext };
  }
  if (matches(bytes, RIFF, 0) && matches(bytes, WEBP, 8)) {
    return { ok: true, contentType: "image/webp", ext: "webp" };
  }

  return { ok: false, error: "Unsupported image. Upload a PNG, JPEG, or WebP file." };
}

const ALLOWED_EXT = new Set(["png", "jpg", "webp"]);

/**
 * Build the storage key for an org logo: `logos/<orgId>/<32-hex>.<ext>`. The
 * filename is server-generated random entropy (no user-controlled name, no path
 * traversal). `ext` must be one the sniffer produces and `orgId` must be a cuid
 * shape — anything else throws rather than producing an attacker-influenced key.
 */
export function safeLogoKey(orgId: string, ext: string): string {
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Unsupported logo extension: ${ext}`);
  if (!/^[a-z0-9]+$/i.test(orgId)) throw new Error(`Invalid organization id: ${orgId}`);
  return `logos/${orgId}/${randomBytes(16).toString("hex")}.${ext}`;
}
