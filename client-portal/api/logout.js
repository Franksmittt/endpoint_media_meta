import { clearAuthCookieHeader } from "../lib/auth-cookie.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const secure = proto === "https";
  res.setHeader("Set-Cookie", clearAuthCookieHeader({ secure }));
  res.status(200).json({ ok: true });
}
