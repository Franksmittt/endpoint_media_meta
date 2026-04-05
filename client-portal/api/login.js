import {
  signSession,
  setAuthCookieHeader,
} from "../lib/auth-cookie.js";

function getUsers() {
  const secret = process.env.AUTH_SECRET;
  const list = [
    {
      user: process.env.AUTH_WAYNE_USER || "WayneJ",
      pass: process.env.AUTH_WAYNE_PASS,
      clientId: "miwesu",
      agency: false,
    },
    {
      user: process.env.AUTH_JACO_USER || "Jaco",
      pass: process.env.AUTH_JACO_PASS,
      clientId: "vaalpenskraal",
      agency: false,
    },
  ];
  const agencyUser = process.env.AUTH_AGENCY_USER;
  const agencyPass = process.env.AUTH_AGENCY_PASS;
  if (agencyUser && agencyPass) {
    list.push({
      user: agencyUser,
      pass: agencyPass,
      clientId: null,
      agency: true,
    });
  }
  return { secret, list };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { secret, list } = getUsers();
  if (!secret) {
    res.status(503).json({
      error: "AUTH_SECRET is not set. Add it in Vercel → Settings → Environment Variables.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }
  const username = (body?.username || "").trim();
  const password = body?.password || "";

  const row = list.find((x) => x.user === username && x.pass === password);
  if (!row) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = signSession(
    { clientId: row.clientId, agency: row.agency },
    secret
  );
  const proto = req.headers["x-forwarded-proto"] || "https";
  const secure = proto === "https";
  res.setHeader("Set-Cookie", setAuthCookieHeader(token, { secure }));
  res.status(200).json({
    ok: true,
    clientId: row.clientId,
    agency: row.agency,
  });
}
