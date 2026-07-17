import fs from "node:fs";
import { createAccessToken } from "./jwt.mjs";

const SUPABASE_URL = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const userId = "00000000-0000-0000-0000-000000000001";
const householdId = "20000000-0000-0000-0000-000000000001";
const filePath = "fixtures/private/phase-1e/rental1-Insurance-2026Sept2-2027Sept2.pdf";

const token = createAccessToken({ sub: userId, appRole: "customer", email: "customer@example.com" }, JWT_SECRET);

async function uploadDocument() {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("householdId", householdId);
  form.append("category", "current_property_policy");
  const blob = new Blob([bytes], { type: "application/pdf" });
  form.append("file", blob, "rental1.pdf");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upload failed: ${text}`);
  }
  return JSON.parse(text);
}

async function extract(docId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-policy-entities`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ household_id: householdId, policy_document_id: docId }),
  });
  const text = await res.text();
  console.log("status", res.status);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

uploadDocument().then((doc) => extract(doc.id)).catch((e) => {
  console.error(e);
  process.exit(1);
});
