// Minimal HS256 JWT signer used by local end-to-end tests so the same JWT
// secret can authenticate with Supabase REST, RPC and Edge Functions.
import { createHmac } from "node:crypto";

export function signJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function createAccessToken({ sub, appRole, email }, secret, expiresInSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return signJWT(
    {
      iss: "supabase-demo",
      sub,
      aud: "authenticated",
      role: "authenticated",
      email,
      user_metadata: { role: appRole },
      iat: now,
      exp: now + expiresInSeconds,
    },
    secret,
  );
}
