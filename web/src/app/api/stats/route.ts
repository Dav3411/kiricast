import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** 현재 유저의 생성 에이전트 개수, 생성 클립 개수 */
export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const [agentsRes, clipsRes] = await Promise.all([
    supabaseAdmin
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabaseAdmin
      .from("clips")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId),
  ]);

  const agentsCreated = agentsRes.error ? 0 : (agentsRes.count ?? 0);
  const clipsCreated = clipsRes.error ? 0 : (clipsRes.count ?? 0);

  return NextResponse.json({
    agentsCreated: Number(agentsCreated),
    clipsCreated: Number(clipsCreated),
  });
}
