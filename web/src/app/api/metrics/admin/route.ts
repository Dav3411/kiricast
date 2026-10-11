import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function getAdminSecret(req: Request) {
  return req.headers.get("x-admin-secret") ?? "";
}

function clamp(num: number, min: number, max: number) {
  return Math.min(max, Math.max(min, num));
}

export async function GET(req: Request) {
  const adminSecret = process.env.ADMIN_AGENTS_SECRET;
  if (!adminSecret || getAdminSecret(req) !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const hoursRaw = Number(url.searchParams.get("hours") ?? "24");
  const limitRaw = Number(url.searchParams.get("limit") ?? "5000");
  const hours = clamp(Number.isFinite(hoursRaw) ? hoursRaw : 24, 1, 24 * 30);
  const limit = clamp(Number.isFinite(limitRaw) ? limitRaw : 5000, 100, 10000);

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("analytics_events")
    .select("event_name, user_id, anon_id, created_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    event_name: string;
    user_id: string | null;
    anon_id: string;
    created_at: string;
  }>;

  const byName = new Map<
    string,
    { count: number; users: Set<string>; anons: Set<string> }
  >();
  for (const row of rows) {
    const key = row.event_name ?? "unknown";
    const entry = byName.get(key) ?? {
      count: 0,
      users: new Set<string>(),
      anons: new Set<string>(),
    };
    entry.count += 1;
    if (row.user_id) entry.users.add(row.user_id);
    if (row.anon_id) entry.anons.add(row.anon_id);
    byName.set(key, entry);
  }

  const counts = Array.from(byName.entries())
    .map(([name, v]) => ({
      name,
      count: v.count,
      uniqueUsers: v.users.size,
      uniqueAnons: v.anons.size,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    ok: true,
    cutoff,
    total: rows.length,
    counts,
  });
}

