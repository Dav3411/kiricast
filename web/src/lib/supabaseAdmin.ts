import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabaseAdmin: SupabaseClient | null = null;

function initSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "Missing Supabase server env vars. Set SUPABASE_URL and SUPABASE_SECRET_KEY."
    );
  }
  _supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);
  return _supabaseAdmin;
}

/** Lazy-init so build can run without env. Throws on first use if env is missing. */
export const supabaseAdmin: SupabaseClient = new Proxy(
  {} as SupabaseClient,
  {
    get(_, prop: string) {
      const client = initSupabaseAdmin() as unknown as Record<string, unknown>;
      const val = client[prop];
      if (typeof val === "function") {
        return (val as (...args: unknown[]) => unknown).bind(client);
      }
      return val;
    },
  }
);
