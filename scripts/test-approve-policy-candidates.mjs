import { createAccessToken } from "./jwt.mjs";

const SUPABASE_URL = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const userId = "00000000-0000-0000-0000-000000000001";

const sessionId = process.argv[2];
const candidateId = process.argv[3];

if (!sessionId || !candidateId) {
  console.error("usage: tsx scripts/test-approve-policy-candidates.mjs <sessionId> <candidateId>");
  process.exit(1);
}

async function approve() {
  const token = createAccessToken({ sub: userId, appRole: "customer", email: "customer@example.com" }, JWT_SECRET);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/approve-policy-candidates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: sessionId,
      decisions: [{ candidateId, decision: "approve_new" }],
    }),
  });
  const text = await res.text();
  console.log("status", res.status);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

approve().catch((e) => {
  console.error(e);
  process.exit(1);
});
