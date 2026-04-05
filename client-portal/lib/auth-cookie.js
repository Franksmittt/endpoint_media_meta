/**
 * Shared auth token format (Node + Edge must stay in sync).
 * Token = base64url(JSON).hexHmacSha256
 */
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "em_auth";

export function signSession({ clientId, agency }, secret) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({
    c: agency ? null : clientId,
    a: agency ? 1 : 0,
    exp,
  });
  const b = Buffer.from(payload, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(b).digest("hex");
  return `${b}.${sig}`;
}

export function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const b = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = createHmac("sha256", secret).update(b).digest("hex");
  try {
    if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
      return null;
    }
  } catch {
    return null;
  }
  let o;
  try {
    o = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!o.exp || Date.now() > o.exp) return null;
  return {
    agency: o.a === 1,
    clientId: o.c,
  };
}

export function parseCookieHeader(cookieHeader, name = COOKIE_NAME) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=").trim());
  }
  return null;
}

export function setAuthCookieHeader(token, { secure } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearAuthCookieHeader({ secure } = {}) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export { COOKIE_NAME };
