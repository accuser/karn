import { Ok, Err, type Result } from "./result.ts";

// v0.47: Bearer-token verification (the actors slice-2 seam). Verifies a JWT's
// HS256 signature against `secret` using WebCrypto (constant-time
// `crypto.subtle.verify`), enforces `exp`/`nbf`, and returns the `sub` claim.
// Any failure is an `Err` the caller maps to 401 — fail-closed. The raw token
// never leaves this function; only the verified `sub` flows out.
function __bynkB64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifyBearerJwtHs256(
  token: string,
  secret: string,
): Promise<Result<{ readonly sub: string; readonly claims: Record<string, unknown> }, string>> {
  const parts = token.split(".");
  if (parts.length !== 3) return Err("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(__bynkB64UrlToBytes(headerB64)));
  } catch {
    return Err("malformed header");
  }
  // Reject algorithm confusion / `alg: none` — this seam only verifies HS256.
  if (header.alg !== "HS256") return Err("unsupported alg");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      __bynkB64UrlToBytes(sigB64) as BufferSource,
      enc.encode(`${headerB64}.${payloadB64}`) as BufferSource,
    );
  } catch {
    return Err("verify failed");
  }
  if (!ok) return Err("bad signature");
  let payload: { sub?: unknown; exp?: unknown; nbf?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(__bynkB64UrlToBytes(payloadB64)));
  } catch {
    return Err("malformed payload");
  }
  const now = Math.floor(Date.now() / 1000);
  // RFC 7519: `exp`/`nbf` are NumericDate (a number). A present-but-non-number
  // claim is malformed — reject rather than silently skip the time check.
  if (payload.exp !== undefined && typeof payload.exp !== "number") return Err("malformed exp");
  if (payload.exp !== undefined && (payload.exp as number) < now) return Err("token expired");
  if (payload.nbf !== undefined && typeof payload.nbf !== "number") return Err("malformed nbf");
  if (payload.nbf !== undefined && (payload.nbf as number) > now) return Err("token not yet valid");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return Err("missing sub");
  // v0.53: surface the full verified claims for refinement-actor authorisation
  // (`actor Admin = User where hasClaim(...)`). The identity stays `sub`-minted
  // and sealed; claims are an authorisation-time input, checked at the boundary.
  return Ok({ sub: payload.sub, claims: payload as Record<string, unknown> });
}

// v0.51: Signature (webhook) verification — recompute an HMAC-SHA256 over the
// raw body (or `<timestamp>.<body>` when a timestamp is bound) and compare it,
// constant-time (`crypto.subtle.verify`), against the request's signature
// header (accepting a `sha256=<hex>` prefix or a bare hex digest). When a
// timestamp is bound, it is signed (so it cannot be forged) and checked within
// `toleranceSecs` for replay defence. Returns `true` iff the request is
// authentic; the caller maps `false` to 401. The body never reaches the handler
// unverified.
function __bynkHexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("sha256=") ? hex.slice(7) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function verifySignatureHmacSha256(
  body: string,
  secret: string,
  signatureHeader: string | null,
  timestamp: string | null,
  toleranceSecs: number | null,
): Promise<boolean> {
  if (signatureHeader === null) return false;
  // When a timestamp is bound it is part of the signed string (so it cannot be
  // forged); a tolerance, if set, bounds replay.
  let signingString = body;
  if (timestamp !== null) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    if (toleranceSecs !== null) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > toleranceSecs) return false;
    }
    signingString = `${timestamp}.${body}`;
  }
  const sigBytes = __bynkHexToBytes(signatureHeader);
  if (sigBytes.length === 0) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      enc.encode(signingString) as BufferSource,
    );
  } catch {
    return false;
  }
}
