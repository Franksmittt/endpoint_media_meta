import { parseCookieHeader, verifySessionToken } from "../lib/auth-cookie.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const path = join(process.cwd(), "data", "clients-index.json");
  if (!existsSync(path)) {
    res.status(404).json({ error: "Run build_report.py first" });
    return;
  }

  const full = JSON.parse(readFileSync(path, "utf8"));
  const all = full.clients || [];

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    res.status(200).json(full);
    return;
  }

  const cookie = parseCookieHeader(req.headers.cookie || "");
  const session = verifySessionToken(cookie, secret);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (session.agency) {
    res.status(200).json(full);
    return;
  }

  const filtered = all.filter((c) => c.id === session.clientId);
  res.status(200).json({
    schemaVersion: full.schemaVersion,
    generatedAt: full.generatedAt,
    clients: filtered,
  });
}
