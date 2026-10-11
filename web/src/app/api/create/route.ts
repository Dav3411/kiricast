import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { serverFeatures } from "@/lib/featuresServer";
import { validateCreateRequest } from "@/lib/createValidation";
import { checkContentSafety } from "@/lib/safetyCheck";

export const runtime = "nodejs";

function assignVariant(userId: string) {
  const hex = crypto.createHash("sha256").update(userId).digest("hex");
  const bucket = parseInt(hex.slice(0, 2), 16) % 2;
  return bucket === 1 ? "free_first_clip" : "control";
}

export async function POST(req: Request) {
  const result = await validateCreateRequest(req);
  if (!result.ok) return result.response;
  const { userId, agent1Id, agent2Id, title, setting, situation, core_emotion, relationship_state, tone, body } = result.data;
  const language = typeof body.language === "string" ? body.language.trim().slice(0, 10) : "";

  const rateLimitPerHour = Number(process.env.JOB_RATE_LIMIT_PER_HOUR ?? "5");
  if (Number.isFinite(rateLimitPerHour) && rateLimitPerHour > 0) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);

    if (countErr) {
      return NextResponse.json({ error: "Rate limit check failed" }, { status: 500 });
    }
    if ((count ?? 0) >= rateLimitPerHour) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  }

  const rawKey = req.headers.get("x-idempotency-key")?.trim() ?? "";
  // Idempotency key: 최대 64자, 영숫자+하이픈만 허용
  const idempotencyKey = /^[a-zA-Z0-9\-]{1,64}$/.test(rawKey) ? rawKey : "";
  if (idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json({ jobId: existing.id, reused: true });
    }
  }

  // 클립당 차감 크레딧. web/docs/COST_ELEVENLABS.md (권장: CLIP_CREDIT_COST=100)
  const defaultCostRaw = Number(process.env.CLIP_CREDIT_COST ?? "100");
  const defaultCost =
    Number.isFinite(defaultCostRaw) && defaultCostRaw >= 0 ? Math.floor(defaultCostRaw) : 100;
  let creditCost = defaultCost;
  const jobId = crypto.randomUUID();

  let creditLedgerId: string | null = null;

  // A/B: free first clip for half of users
  if (serverFeatures.freeFirstClipAb) {
    const variant = assignVariant(userId);
    if (variant === "free_first_clip") {
      const { count, error: countErr } = await supabaseAdmin
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId);
      if (!countErr && (count ?? 0) === 0) {
        creditCost = 0;
      }
    }
  }

  if (creditCost > 0) {
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("credit_wallets")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletErr) {
      return NextResponse.json({ error: "Failed to load credits" }, { status: 500 });
    }

    const balance = Number(wallet?.balance ?? 0);
    if (!Number.isFinite(balance) || balance < creditCost) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
    }

    const { data: ledgerId, error: reserveErr } = await supabaseAdmin.rpc(
      "reserve_job_credits",
      {
        p_user_id: userId,
        p_job_id: jobId,
        p_amount: creditCost,
      }
    );

    if (reserveErr) {
      const message = reserveErr.message ?? "Failed to reserve credits";
      if (message.includes("INSUFFICIENT_CREDITS")) {
        return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
    creditLedgerId = ledgerId as string;
  }

  // 콘텐츠 안전 검사
  const safetyResult = await checkContentSafety(`${title}\n${setting}\n${situation}\n${core_emotion}\n${relationship_state}\n${tone}`);
  if (!safetyResult.safe) {
    if (creditLedgerId) {
      await supabaseAdmin.rpc("release_job_credits", { p_ledger_id: creditLedgerId });
    }
    const reason = safetyResult.reason ?? "부적절한 내용이 포함되어 있습니다.";
    return NextResponse.json({ error: `콘텐츠 정책 위반: ${reason}` }, { status: 400 });
  }

  // 시리즈 연속 컨텍스트 조회
  const seriesId = body.seriesId?.trim() ?? "";
  type SeriesPayloadFields = {
    series_id?: string;
    episode_number?: number;
    arc_phase?: string;
    series_context?: unknown[];
    total_episodes?: number;
    relationship_context?: string;
    series_document?: Record<string, unknown>;
    arc_document?: Record<string, unknown>;
    rolling_summary?: string;
    core_memory?: Record<string, unknown>;
    character_fsm?: Record<string, unknown>;
    episode_type?: string;
    episode_type_counts?: Record<string, number>;
    language?: string;
  };
  let seriesFields: SeriesPayloadFields = {};

  if (seriesId) {
    // 해당 시리즈에 이미 활성 잡(queued/processing)이 있으면 중복 방지
    const { count: activeJobCount } = await supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "processing"])
      .filter("payload->>series_id", "eq", seriesId);

    if ((activeJobCount ?? 0) > 0) {
      if (creditLedgerId) {
        await supabaseAdmin.rpc("release_job_credits", { p_ledger_id: creditLedgerId });
      }
      return NextResponse.json(
        { error: "이 시리즈에 이미 에피소드를 생성 중입니다." },
        { status: 409 },
      );
    }

    const { data: series } = await supabaseAdmin
      .from("clip_series")
      .select("*")
      .eq("id", seriesId)
      .single();

    if (series) {
      seriesFields = {
        series_id: seriesId,
        episode_number: body.episodeNumber ?? 1,
        series_context: Array.isArray(series.story_context) ? series.story_context : [],
        total_episodes: series.total_episodes,
        relationship_context: series.relationship_context ?? "",
      };
      // 시리즈 파이프라인 데이터 (문서/메모리)
      if (series.series_document) seriesFields.series_document = series.series_document;
      if (series.arc_document) seriesFields.arc_document = series.arc_document;
      if (series.rolling_summary) seriesFields.rolling_summary = series.rolling_summary;
      if (series.core_memory) seriesFields.core_memory = series.core_memory;
      if (series.character_fsm) seriesFields.character_fsm = series.character_fsm;
      // 에피소드 타입 분배 시스템
      const episodeType = (body.episodeType as string)?.trim() ?? "";
      if (episodeType) seriesFields.episode_type = episodeType;
      if (series.episode_type_counts) seriesFields.episode_type_counts = series.episode_type_counts;
      // 시리즈 언어 상속
      if (series.language) seriesFields.language = series.language;
    } else if (
      body.seriesDocument != null ||
      body.arcDocument != null ||
      (body.relationshipContext != null && body.relationshipContext !== "") ||
      (body.totalEpisodes != null && body.totalEpisodes > 0)
    ) {
      // 첫 에피소드: 시리즈 row는 아직 없음. body로 시리즈 필드 구성 후 잡만 생성.
      seriesFields = {
        series_id: seriesId,
        episode_number: body.episodeNumber ?? 1,
        series_context: [],
        total_episodes: body.totalEpisodes ?? undefined,
        relationship_context: (body.relationshipContext ?? "") as string,
      };
      if (body.seriesDocument && typeof body.seriesDocument === "object") seriesFields.series_document = body.seriesDocument;
      if (body.arcDocument && typeof body.arcDocument === "object") seriesFields.arc_document = body.arcDocument;
      const episodeType = (body.episodeType as string)?.trim() ?? "";
      if (episodeType) seriesFields.episode_type = episodeType;
    }
  }

  const { data, error: insertErr } = await supabaseAdmin
    .from("jobs")
    .insert({
      id: jobId,
      user_id: userId,
      status: "queued",
      progress: 0,
      payload: {
        agent1_id: agent1Id,
        agent2_id: agent2Id,
        title,
        setting,
        situation,
        core_emotion,
        relationship_state,
        tone,
        ...(Array.isArray(body.script) && body.script.length > 0 ? { script: body.script } : {}),
        ...seriesFields,
        ...(language && !seriesFields.language ? { language } : {}),
      },
      idempotency_key: idempotencyKey || null,
      credit_ledger_id: creditLedgerId,
      credit_cost: creditCost,
      source: process.env.JOB_SOURCE || "production",
    })
    .select("id")
    .single();

  if (insertErr || !data) {
    if (creditLedgerId) {
      await supabaseAdmin.rpc("release_job_credits", { p_ledger_id: creditLedgerId });
    }
    console.error("Job insert error:", insertErr?.message, insertErr?.details, insertErr?.hint);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  return NextResponse.json({ jobId: data.id });
}
