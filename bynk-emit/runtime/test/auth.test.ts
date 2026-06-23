import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyBearerJwtHs256, verifySignatureHmacSha256 } from "../src/auth.ts";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array | string): string {
  const u8 = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const key = await hmacKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${head}.${body}`) as BufferSource);
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function hexHmac(body: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body) as BufferSource));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SECRET = "top-secret";
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

test("JWT: valid token returns Ok with sub and full claims", async () => {
  const token = await signJwt({ sub: "user-1", exp: future(), role: "admin" }, SECRET);
  const r = await verifyBearerJwtHs256(token, SECRET);
  assert.equal(r.tag, "Ok");
  if (r.tag === "Ok") {
    assert.equal(r.value.sub, "user-1");
    assert.equal(r.value.claims.role, "admin");
  }
});

test("JWT: wrong secret is a bad signature", async () => {
  const token = await signJwt({ sub: "u", exp: future() }, SECRET);
  const r = await verifyBearerJwtHs256(token, "other-secret");
  assert.deepEqual(r, { tag: "Err", error: "bad signature" });
});

test("JWT: non-HS256 alg is rejected (alg confusion / none)", async () => {
  for (const alg of ["none", "RS256", "HS384"]) {
    const token = await signJwt({ sub: "u", exp: future() }, SECRET, { alg });
    const r = await verifyBearerJwtHs256(token, SECRET);
    assert.deepEqual(r, { tag: "Err", error: "unsupported alg" });
  }
});

test("JWT: expired token rejected", async () => {
  const token = await signJwt({ sub: "u", exp: past() }, SECRET);
  assert.deepEqual(await verifyBearerJwtHs256(token, SECRET), { tag: "Err", error: "token expired" });
});

test("JWT: nbf in the future rejected", async () => {
  const token = await signJwt({ sub: "u", nbf: future() }, SECRET);
  assert.deepEqual(await verifyBearerJwtHs256(token, SECRET), {
    tag: "Err",
    error: "token not yet valid",
  });
});

test("JWT: non-number exp is malformed (not silently skipped)", async () => {
  const token = await signJwt({ sub: "u", exp: "soon" }, SECRET);
  assert.deepEqual(await verifyBearerJwtHs256(token, SECRET), { tag: "Err", error: "malformed exp" });
});

test("JWT: missing/empty sub rejected", async () => {
  const token = await signJwt({ exp: future() }, SECRET);
  assert.deepEqual(await verifyBearerJwtHs256(token, SECRET), { tag: "Err", error: "missing sub" });
});

test("JWT: structurally malformed token rejected", async () => {
  assert.deepEqual(await verifyBearerJwtHs256("a.b", SECRET), { tag: "Err", error: "malformed token" });
});

test("webhook: correct bare-hex signature verifies", async () => {
  const body = '{"event":"ping"}';
  const sig = await hexHmac(body, SECRET);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, sig, null, null), true);
});

test("webhook: sha256= prefix accepted", async () => {
  const body = "payload";
  const sig = await hexHmac(body, SECRET);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, `sha256=${sig}`, null, null), true);
});

test("webhook: wrong signature and null header rejected", async () => {
  const body = "payload";
  assert.equal(await verifySignatureHmacSha256(body, SECRET, "00".repeat(32), null, null), false);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, null, null, null), false);
});

test("webhook: timestamp is part of the signed string and bounded by tolerance", async () => {
  const body = "payload";
  const ts = String(Math.floor(Date.now() / 1000));
  const signed = await hexHmac(`${ts}.${body}`, SECRET);
  // within tolerance
  assert.equal(await verifySignatureHmacSha256(body, SECRET, signed, ts, 300), true);
  // a signature over the bare body must NOT verify once a timestamp is bound
  const bareBodySig = await hexHmac(body, SECRET);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, bareBodySig, ts, 300), false);
  // stale timestamp rejected
  const oldTs = String(Math.floor(Date.now() / 1000) - 10_000);
  const oldSigned = await hexHmac(`${oldTs}.${body}`, SECRET);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, oldSigned, oldTs, 300), false);
});

test("webhook: non-finite timestamp rejected", async () => {
  const body = "payload";
  const sig = await hexHmac(`x.${body}`, SECRET);
  assert.equal(await verifySignatureHmacSha256(body, SECRET, sig, "not-a-number", 300), false);
});
