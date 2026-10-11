import { NextResponse } from "next/server";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeLimit } from "@/lib/clipDb";

export const runtime = "nodejs";

/** GET: 관리자용 클립 목록 (id, title). limit/offset 페이징 */
export async function GET(req: Request) {
  const admin = await requireCreditsAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, normalizeLimit(url.searchParams.get("limit"), 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

  const { data: rows, error } = await supabaseAdmin
    .from("clips")
    .select("id, title")
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }

  const { count, error: countErr } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true });

  return NextResponse.json({
    clips: (rows ?? []).map((r: { id: string; title: string | null }) => ({ id: r.id, title: r.title ?? "" })),
    total: countErr ? null : (count ?? 0),
  });
}
