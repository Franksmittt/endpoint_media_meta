import {
  verifySessionTokenEdge,
  parseCookieHeader,
} from "./lib/auth-cookie-edge.js";

export const config = {
  matcher: [
    "/data/:path*",
    "/",
    "/index.html",
    "/dashboard.html",
    "/reconciliation.html",
  ],
};

export default async function middleware(request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return fetch(request);
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  const cookie = parseCookieHeader(request.headers.get("cookie") || "");
  const session = await verifySessionTokenEdge(cookie, secret);

  if (!session) {
    return Response.redirect(new URL("/login.html", request.url));
  }

  if (
    pathname === "/reconciliation.html" ||
    pathname.endsWith("/reconciliation.html")
  ) {
    if (!session.agency) {
      return Response.redirect(new URL("/index.html", request.url));
    }
  }

  const clientJson = pathname.match(/^\/data\/clients\/([^/]+)\.json$/);
  if (clientJson) {
    const id = clientJson[1];
    if (!session.agency && session.clientId !== id) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (
    pathname === "/data/clients-index.json" ||
    pathname.endsWith("/clients-index.json")
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (
    pathname === "/data/reconciliation.json" ||
    pathname.endsWith("/reconciliation.json")
  ) {
    if (!session.agency) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  return fetch(request);
}
