import {
  parseCookieHeader,
  verifySessionToken,
} from "../lib/auth-cookie.js";
import { existsSync } from "fs";
import { join } from "path";

const DISPLAY = {
  miwesu: "Miwesu",
  vaalpenskraal: "Vaalpenskraal",
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    res.status(200).json({
      authenticated: false,
      dev: true,
      message: "No AUTH_SECRET — open data mode (local only).",
    });
    return;
  }

  const cookie = parseCookieHeader(req.headers.cookie || "");
  const session = verifySessionToken(cookie, secret);
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }

  const out = {
    authenticated: true,
    agency: session.agency,
    clientId: session.clientId,
    displayName: session.agency
      ? "Agency"
      : DISPLAY[session.clientId] || session.clientId,
  };

  if (!session.agency && session.clientId) {
    const p = join(process.cwd(), "data", "clients", `${session.clientId}.json`);
    out.hasData = existsSync(p);
  } else if (session.agency) {
    out.hasData = true;
  }

  res.status(200).json(out);
}
