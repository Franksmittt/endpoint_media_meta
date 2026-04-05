import { parseCookieHeader, verifySessionToken } from "../lib/auth-cookie.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    const q = (req.query?.client || "").toString();
    if (!q) {
      res.status(400).json({ error: "client required" });
      return;
    }
    const p = join(process.cwd(), "data", "clients", `${q}.json`);
    if (!existsSync(p)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(readFileSync(p, "utf8"));
    return;
  }

  const cookie = parseCookieHeader(req.headers.cookie || "");
  const session = verifySessionToken(cookie, secret);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const requested = (req.query?.client || "").toString();
  if (!requested) {
    res.status(400).json({ error: "client query required" });
    return;
  }

  if (!session.agency) {
    if (session.clientId !== requested) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const p = join(process.cwd(), "data", "clients", `${requested}.json`);
  if (!existsSync(p)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(readFileSync(p, "utf8"));
}
