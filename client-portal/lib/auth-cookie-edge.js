/**
 * Edge middleware: verify same token as lib/auth-cookie.js (Web Crypto HMAC-SHA256).
 */
function base64UrlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function verifySessionTokenEdge(token, secret) {
  if (!token || !secret) return null;
  const last = token.lastIndexOf(".");
  if (last <= 0) return null;
  const b = token.slice(0, last);
  const sigHex = token.slice(last + 1);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(b));
  const expectHex = [...new Uint8Array(sigBuf)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  if (sigHex.length !== expectHex.length) return null;
  let diff = 0;
  for (let i = 0; i < sigHex.length; i++) {
    diff |= sigHex.charCodeAt(i) ^ expectHex.charCodeAt(i);
  }
  if (diff !== 0) return null;
  let o;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(b));
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o.exp || Date.now() > o.exp) return null;
  return { agency: o.a === 1, clientId: o.c };
}

export function parseCookieHeader(cookieHeader, name = "em_auth") {
  if (!cookieHeader) return null;
  for (const p of cookieHeader.split(";")) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return null;
}
