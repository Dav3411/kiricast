import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 120;

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";

type ReqBody = {
  seriesDocument?: Record<string, unknown>;
  arcDocument?: Record<string, unknown>;
  instruction?: string;
  seriesTitle?: string;
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

  if (!body.seriesDocument || !body.arcDocument || !body.instruction?.trim()) {
    return NextResponse.json({ error: "seriesDocument, arcDocument, and instruction are required" }, { status: 400 });
  }

  const instruction = body.instruction.trim();
  const seriesTitle = body.seriesTitle || undefined;

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
      { error: "Too many requests. Please wait before refining the document." },
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
      action: "refine",
      title: "Refining series document",
    },
  });

  if (insertErr) {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Run refinement in background after response is sent
  after(async () => {
    try {
      await supabaseAdmin.from("jobs").update({ progress: 10 }).eq("id", jobId);

      const res = await fetch(`${GENERATOR_URL}/api/series/refine-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series_document: body.seriesDocument,
          arc_document: body.arcDocument,
          instruction,
          series_title: seriesTitle,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = (data as Record<string, string>).detail ?? "Document refinement failed";
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
