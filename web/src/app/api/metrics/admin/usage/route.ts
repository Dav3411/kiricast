import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function getAdminSecret(req: Request) {
  return req.headers.get("x-admin-secret") ?? "";
}

/** 특정 기간 내 전체 유저의 에이전트 생성 수, 클립 생성 수. 쿼리: from, to (ISO 날짜) */
export async function GET(req: Request) {
  const adminSecret = process.env.ADMIN_AGENTS_SECRET;
  if (!adminSecret || getAdminSecret(req) !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from")?.trim();
  const toParam = url.searchParams.get("to")?.trim();

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const from = fromParam ? new Date(fromParam) : defaultFrom;
  const to = toParam ? new Date(toParam) : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return NextResponse.json(
      { error: "Invalid from/to. Use ISO date strings, from < to." },
      { status: 400 }
    );
  }

  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [agentsRes, clipsRes] = await Promise.all([
    supabaseAdmin
      .from("agents")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabaseAdmin
      .from("clips")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
  ]);

  const agentsCreated = agentsRes.error ? 0 : (agentsRes.count ?? 0);
  const clipsCreated = clipsRes.error ? 0 : (clipsRes.count ?? 0);

  return NextResponse.json({
    from: fromIso,
    to: toIso,
    agentsCreated: Number(agentsCreated),
    clipsCreated: Number(clipsCreated),
  });
}
