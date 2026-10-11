import { createBrowserClient } from "@supabase/ssr";

type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;
let _client: SupabaseBrowserClient | null = null;

function getClient(): SupabaseBrowserClient {
  if (_client) return _client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in web/.env.local"
    );
  }
  _client = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return _client;
}

/** 브라우저용 클라이언트. 지연 초기화로 빌드 시 env 없어도 통과. 런타임 사용 시 env 필수. */
export const supabase = new Proxy({} as SupabaseBrowserClient, {
  get(target, prop: string | symbol) {
    if (typeof prop === "symbol") return undefined;
    const c = getClient() as unknown as Record<string, unknown>;
    const val = c[prop];
    if (typeof val === "function") return (val as (...args: unknown[]) => unknown).bind(c);
    return val;
  },
});
