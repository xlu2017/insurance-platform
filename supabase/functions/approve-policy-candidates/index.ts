const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405);
  }

  // The approval workflow is disabled pending the transactional approve_candidate_assets_v2 RPC.
  return jsonResponse(
    {
      error: {
        code: "DOCUMENT_PROCESSING_FAILED",
        message:
          "Asset approval is temporarily unavailable while document review is being completed.",
        retryable: false,
      },
    },
    501,
  );
});
