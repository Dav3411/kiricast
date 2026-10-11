import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 120;

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";

type ReqBody = {
  agent1Id?: string;
  agent2Id?: string;
  idea?: string;
  /** Main Idea만으로 시리즈 문서와 함께 에이전트 콘셉트를 생성할지 여부. true면 agent1Id/agent2Id 생략 가능. */
  autoGenerateAgents?: boolean;
  /** 콘텐츠 언어 (ISO 639-1) */
  language?: string;
};

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const autoGenerateAgents = !!body.autoGenerateAgents;
  const agent1Id = body.agent1Id?.trim() ?? "";
  const agent2Id = body.agent2Id?.trim() ?? "";
  const idea = body.idea?.trim() ?? "";

  if (!idea) {
    return NextResponse.json({ error: "Idea is required" }, { status: 400 });
  }
  if (!autoGenerateAgents && (!agent1Id || !agent2Id)) {
    return NextResponse.json({ error: "Both agents are required when not auto-generating agents" }, { status: 400 });
  }

  // Rate limit: max 5 series_doc jobs per user per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabaseAdmin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .filter("payload->>kind", "eq", "series_doc")
    .gte("created_at", oneHourAgo);

  if ((recentCount ?? 0) >= 5) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before generating another document." },
      { status: 429 },
    );
  }

  // Create a job row in DB
  const jobId = crypto.randomUUID();
  const { error: insertErr } = await supabaseAdmin.from("jobs").insert({
    id: jobId,
    user_id: userId,
    status: "processing",
    progress: 0,
    payload: {
      kind: "series_doc",
      action: "generate",
      title: "Generating series document",
      ...(agent1Id ? { agent1_id: agent1Id } : {}),
      ...(agent2Id ? { agent2_id: agent2Id } : {}),
      idea,
      auto_generate_agents: autoGenerateAgents,
    },
  });

  if (insertErr) {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Run generator call in background after response is sent
  after(async () => {
    try {
      await supabaseAdmin.from("jobs").update({ progress: 10 }).eq("id", jobId);

      const res = await fetch(`${GENERATOR_URL}/api/series/generate-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1_id: agent1Id || "",
          agent2_id: agent2Id || "",
          idea,
          auto_generate_agents: autoGenerateAgents,
          language: body.language?.trim() || "en",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = (data as Record<string, string>).detail ?? "Document generation failed";
        await supabaseAdmin
          .from("jobs")
          .update({ status: "failed", error: errMsg, progress: 100 })
          .eq("id", jobId);
        return;
      }

      await supabaseAdmin
        .from("jobs")
        .update({ status: "succeeded", progress: 100, result: data })
        .eq("id", jobId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed to reach generator";
      await supabaseAdmin
        .from("jobs")
        .update({ status: "failed", error: errMsg, progress: 100 })
        .eq("id", jobId);
    }
  });

  return NextResponse.json({ jobId });
}
