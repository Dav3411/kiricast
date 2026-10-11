import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabaseAuth: SupabaseClient | null = null;

function getSupabaseAuth(): SupabaseClient {
  if (_supabaseAuth) return _supabaseAuth;
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing Supabase server env vars. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."
    );
  }
  _supabaseAuth = createClient(supabaseUrl, supabasePublishableKey);
  return _supabaseAuth;
}

export async function getUserIdFromToken(token: string | null) {
  if (!token) return { error: "Missing token", userId: null };
  const supabaseAuth = getSupabaseAuth();
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return { error: "Invalid session", userId: null };
  }
  return { error: null, userId: data.user.id };
}

export async function requireUserId(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  return getUserIdFromToken(token);
}
