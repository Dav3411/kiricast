import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { getEffectivePlanForUser } from "@/lib/subscriptionPlan";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { isNonEmpty } from "@/lib/serverUtils";
import { checkContentSafety } from "@/lib/safetyCheck";

export const runtime = "nodejs";

type VoiceCandidate = {
  id: string;
  name: string;
  gender?: string | null;
  age?: string | null;
  accent?: string | null;
  desc?: string | null;
};

type ReqBody = {
  name?: string;
  concept?: string;
  personality?: string;
  speakingStyle?: string;
  appearance?: string;
  introLine?: string;
  elevenlabsVoiceId?: string;
  voiceCandidates?: VoiceCandidate[];
  /** AI Assist로 미리 생성된 spec — 사용자가 수정하지 않았으면 그대로 사용 */
  preSpec?: Record<string, string>;
  /** false면 비공개(본인만 사용). 기본 true. 플랜이 비공개 미지원이면 무시됨. */
  isPublic?: boolean;
  /** 오토 서제스트 등: 이미 다른 에이전트에 할당된 voice_id 목록 → 두 번째 에이전트는 이와 다른 목소리 선택 */
  alreadyUsedVoiceIds?: string[];
  /** 생성 언어 코드 (e.g. "en", "ko") */
  language?: string;
};

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const plan = await getEffectivePlanForUser(userId);
  const isFreePlan = plan == null;
  const canCreatePrivateAgent = !isFreePlan && (plan?.canCreatePrivateAgent ?? false);
  const canSelectVoiceManually = !isFreePlan && (plan?.canSelectVoiceManually ?? false);

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const concept = body.concept?.trim() ?? "";
  const personality = body.personality?.trim() ?? "";
  const speakingStyle = body.speakingStyle?.trim() ?? null;
  const appearance = body.appearance?.trim() ?? null;
  const introLine = body.introLine?.trim() ?? null;
  const elevenlabsVoiceId = canSelectVoiceManually ? (body.elevenlabsVoiceId?.trim() ?? null) : null;
  const voiceCandidates = Array.isArray(body.voiceCandidates)
    ? body.voiceCandidates
    : null;
  const preSpec = (body.preSpec && typeof body.preSpec === "object") ? body.preSpec : null;
  const isPublic = canCreatePrivateAgent ? (body.isPublic !== false) : true;
  const alreadyUsedVoiceIds = Array.isArray(body.alreadyUsedVoiceIds)
    ? body.alreadyUsedVoiceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const language = body.language?.trim() || null;

  if (!isNonEmpty(name) || name.length < 2) {
    return NextResponse.json({ error: "Name is required (min 2 characters)" }, { status: 400 });
  }
  if (!isNonEmpty(concept) || concept.length < 20) {
    return NextResponse.json({ error: "Setting/Background is required (min 20 characters)" }, { status: 400 });
  }
  if (!isNonEmpty(personality) || personality.length < 20) {
    return NextResponse.json({ error: "Personality is required (min 20 characters)" }, { status: 400 });
  }
  if (!speakingStyle || speakingStyle.length < 10) {
    return NextResponse.json({ error: "Speaking Style is required (min 10 characters)" }, { status: 400 });
  }
  if (!appearance || appearance.length < 10) {
    return NextResponse.json({ error: "Appearance is required (min 10 characters)" }, { status: 400 });
  }
  if (!introLine || introLine.length < 10) {
    return NextResponse.json({ error: "Intro line is required (min 10 characters)" }, { status: 400 });
  }

  /**
   * creditCost: 에이전트 1회 생성 시 예약(차감)되는 크레딧 수.
   * 환경 변수 AGENT_CREDIT_COST로 설정하며, 미설정 시 기본값 150 (COST_ELEVENLABS.md).
   */
  const creditCost = Math.max(
    0,
    Math.floor(Number(process.env.AGENT_CREDIT_COST ?? "150") || 0)
  );

  const jobId = crypto.randomUUID();
  let creditLedgerId: string | null = null;

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

  // 에이전트 콘텐츠 안전 검사 (all fields)
  const agentText = [name, concept, personality, speakingStyle, appearance, introLine].filter(Boolean).join("\n");
  const safetyResult = await checkContentSafety(agentText);
  if (!safetyResult.safe) {
    if (creditLedgerId) {
      await supabaseAdmin.rpc("release_job_credits", { p_ledger_id: creditLedgerId });
    }
    const reason = safetyResult.reason ?? "부적절한 내용이 포함되어 있습니다.";
    return NextResponse.json({ error: `콘텐츠 정책 위반: ${reason}` }, { status: 400 });
  }

  const { data, error: insertErr } = await supabaseAdmin
    .from("jobs")
    .insert({
      id: jobId,
      user_id: userId,
      status: "queued",
      progress: 0,
      payload: {
        kind: "agent",
        name,
        concept,
        personality,
        speaking_style: speakingStyle,
        appearance,
        intro_line: introLine,
        ...(elevenlabsVoiceId ? { elevenlabs_voice_id: elevenlabsVoiceId } : {}),
        ...(voiceCandidates ? { voice_candidates: voiceCandidates } : {}),
        ...(preSpec ? { pre_spec: preSpec } : {}),
        ...(alreadyUsedVoiceIds.length > 0 ? { already_used_voice_ids: alreadyUsedVoiceIds } : {}),
        ...(language ? { language } : {}),
        is_public: isPublic,
      },
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
    return NextResponse.json({ error: "Failed to create agent job" }, { status: 500 });
  }

  return NextResponse.json({ jobId: data.id });
}
