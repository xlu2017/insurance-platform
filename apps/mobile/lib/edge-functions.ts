import {
  getBypassTunnelHeaders,
  getSupabaseAnonKeyString,
  getSupabaseUrlString,
  supabase,
} from "./supabase";

export interface EdgeFunctionError {
  code: string;
  message: string;
  details?: unknown;
}

export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: unknown,
): Promise<{ data?: T; error?: EdgeFunctionError }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return { error: { code: "UNAUTHORIZED", message: "No active session" } };
  }

  const response = await fetch(`${getSupabaseUrlString()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: getSupabaseAnonKeyString(),
      ...getBypassTunnelHeaders(),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const err =
      typeof parsed === "object" && parsed !== null
        ? (parsed as EdgeFunctionError)
        : { code: "FUNCTION_ERROR", message: text };
    return { error: err };
  }

  return { data: parsed as T };
}
