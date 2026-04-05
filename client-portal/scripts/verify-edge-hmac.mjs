import { signSession } from "../lib/auth-cookie.js";
import { verifySessionTokenEdge } from "../lib/auth-cookie-edge.js";

const secret = "test-secret-hex";
for (const agency of [false, true]) {
  const token = signSession(
    { clientId: agency ? null : "miwesu", agency },
    secret
  );
  const v = await verifySessionTokenEdge(token, secret);
  if (!v || v.agency !== agency) {
    console.error("FAIL", { agency, v });
    process.exit(1);
  }
}
console.log("edge HMAC matches Node OK");
