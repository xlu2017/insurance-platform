import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const client = createClient(SUPABASE_URL, ANON_KEY);
const { data, error } = await client.auth.signInWithPassword({
  email: "customer@example.com",
  password: "DemoCustomer123!",
});
if (error) { console.error(error); process.exit(1); }
console.log("access_token", data.session.access_token);

const { data: rpcData, error: rpcErr } = await client.rpc("save_candidate_review_draft_v1", {
  p_household_id: "20000000-0000-0000-0000-000000000001",
  p_candidate_id: "250b292d-3479-4838-880b-62c132a9fe0e",
  p_decision: "approve_new",
  p_identity_confirmed: true,
});
console.log("rpc data", rpcData);
console.log("rpc error", rpcErr);
