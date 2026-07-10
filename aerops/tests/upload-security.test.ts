import { describe, it, expect } from "vitest";
import { validateImageUpload, safeLogoKey, MAX_LOGO_BYTES } from "@/lib/upload-validation";

// Minimal magic-byte headers — we sniff the signature, not decode the pixels.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from("WEBP")]);

describe("validateImageUpload — magic-byte sniffing", () => {
  it("accepts a PNG signature", () => {
    const r = validateImageUpload(PNG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("image/png");
      expect(r.ext).toBe("png");
    }
  });

  it("accepts a JPEG signature", () => {
    const r = validateImageUpload(JPEG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("image/jpeg");
      expect(r.ext).toBe("jpg");
    }
  });

  it("accepts a WebP (RIFF/WEBP) signature", () => {
    const r = validateImageUpload(WEBP);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("image/webp");
      expect(r.ext).toBe("webp");
    }
  });

  it("derives type from magic bytes and ignores the declared type", () => {
    // A real PNG that lies about being an SVG is still a PNG.
    const lying = validateImageUpload(PNG, "image/svg+xml");
    expect(lying.ok).toBe(true);
    if (lying.ok) {
      expect(lying.contentType).toBe("image/png");
      expect(lying.ext).toBe("png");
    }
    // An SVG that lies about being a PNG is still rejected — magic wins both ways.
    const forged = validateImageUpload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png");
    expect(forged.ok).toBe(false);
  });

  it("rejects SVG outright (no sanitization)", () => {
    expect(validateImageUpload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>")).ok).toBe(false);
  });

  it("rejects HTML", () => {
    expect(validateImageUpload(Buffer.from("<!doctype html><html><body>x</body></html>")).ok).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(validateImageUpload(Buffer.alloc(0)).ok).toBe(false);
  });

  it("rejects an oversized buffer (> MAX_LOGO_BYTES) even with a valid header", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES + 1)]);
    expect(big.length).toBeGreaterThan(MAX_LOGO_BYTES);
    expect(validateImageUpload(big).ok).toBe(false);
  });

  it("rejects a truncated or mismatched PNG", () => {
    expect(validateImageUpload(Buffer.from([0x89, 0x50, 0x4e])).ok).toBe(false); // truncated header
    expect(validateImageUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a])).ok).toBe(false); // byte 4 wrong
  });
});

describe("safeLogoKey — server-generated, org-scoped, traversal-proof", () => {
  it("scopes the key to the org and uses the sniffed extension", () => {
    expect(safeLogoKey("clabc123", "png")).toMatch(/^logos\/clabc123\/[0-9a-f]{32}\.png$/);
    expect(safeLogoKey("clabc123", "webp")).toMatch(/^logos\/clabc123\/[0-9a-f]{32}\.webp$/);
  });

  it("rejects a path-traversal orgId", () => {
    expect(() => safeLogoKey("../../etc", "png")).toThrow();
    expect(() => safeLogoKey("a/b", "png")).toThrow();
    expect(() => safeLogoKey("", "png")).toThrow();
  });

  it("rejects an extension the sniffer would never produce", () => {
    expect(() => safeLogoKey("clabc123", "svg")).toThrow();
    expect(() => safeLogoKey("clabc123", "exe")).toThrow();
  });

  it("produces a unique key on every call", () => {
    expect(safeLogoKey("org1", "png")).not.toBe(safeLogoKey("org1", "png"));
  });
});
