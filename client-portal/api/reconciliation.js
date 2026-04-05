import { parseCookieHeader, verifySessionToken } from "../lib/auth-cookie.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.AUTH_SECRET;
  const path = join(process.cwd(), "data", "reconciliation.json");

  if (!secret) {
    if (!existsSync(path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(readFileSync(path, "utf8"));
    return;
  }

  const cookie = parseCookieHeader(req.headers.cookie || "");
  const session = verifySessionToken(cookie, secret);
  if (!session || !session.agency) {
    res.status(403).json({ error: "Agency login required" });
    return;
  }

  if (!existsSync(path)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(readFileSync(path, "utf8"));
}
