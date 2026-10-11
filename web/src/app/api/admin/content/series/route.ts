import { NextResponse } from "next/server";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function parseLimit(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

/** GET: 관리자용 시리즈 목록 (id, title). limit/offset 페이징 */
export async function GET(req: Request) {
  const admin = await requireCreditsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 20);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

  const { data: rows, error } = await supabaseAdmin
    .from("clip_series")
    .select("id, title")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Failed to load series" }, { status: 500 });
  }

  const { count, error: countErr } = await supabaseAdmin
    .from("clip_series")
    .select("id", { count: "exact", head: true });

  return NextResponse.json({
    series: (rows ?? []).map((r) => ({ id: r.id, title: r.title ?? "" })),
    total: countErr ? null : (count ?? 0),
  });
}
