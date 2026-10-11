/**
 * 월 구독 요금제 정의 (web/docs/COST_ELEVENLABS.md 기준)
 * 플랜별 월 가격·크레딧은 env에서 읽고, 나머지 제한은 코드 기본값.
 *
 * env (선택, 미설정 시 아래 기본값 사용):
 *   NEXT_PUBLIC_PLAN_STARTER_PRICE_USD, NEXT_PUBLIC_PLAN_STARTER_CREDITS
 *   NEXT_PUBLIC_PLAN_PLUS_PRICE_USD, NEXT_PUBLIC_PLAN_PLUS_CREDITS
 *   NEXT_PUBLIC_PLAN_PRO_PRICE_USD, NEXT_PUBLIC_PLAN_PRO_CREDITS
 *   NEXT_PUBLIC_PLAN_ULTRA_PRICE_USD, NEXT_PUBLIC_PLAN_ULTRA_CREDITS
 *   NEXT_PUBLIC_PLAN_KRW_PER_USD (기본 1350, KRW 참고용)
 */

export type PlanId = "starter" | "plus" | "pro" | "ultra";

export type Plan = {
  id: PlanId;
  name: string;
  /** 월 제공 크레딧 */
  credits: number;
  /** 월 가격 (USD) */
  priceUsd: number;
  /** 월 가격 (KRW) 참고 */
  priceKrw: number;
  /** 한 클립 만들 때 스크립트 제너레이트 가능 횟수 */
  scriptGenerateLimitPerClip: number;
  /** 에이전트 비공개 설정 가능 여부 */
  canCreatePrivateAgent: boolean;
  /** 에이전트 목소리 수동 선택 가능 여부 */
  canSelectVoiceManually: boolean;
  /** 영상 익스포트 가능 여부 (Plus 이상) */
  canExportVideo: boolean;
  /** 워터마크 없이 익스포트 가능 여부 (Pro 이상) */
  noWatermark: boolean;
};

const KRW_PER_USD = Math.max(1, Number(process.env.NEXT_PUBLIC_PLAN_KRW_PER_USD ?? "1350") || 1350);

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function planFromEnv(
  id: PlanId,
  name: string,
  defaultPriceUsd: number,
  defaultCredits: number,
  scriptLimit: number,
  canPrivate: boolean,
  canVoice: boolean,
  canExport: boolean,
  noWatermark: boolean
): Plan {
  const priceUsd = numEnv(`NEXT_PUBLIC_PLAN_${id.toUpperCase()}_PRICE_USD`, defaultPriceUsd);
  const credits = Math.max(0, Math.floor(numEnv(`NEXT_PUBLIC_PLAN_${id.toUpperCase()}_CREDITS`, defaultCredits)));
  return {
    id,
    name,
    credits,
    priceUsd,
    priceKrw: Math.round(priceUsd * KRW_PER_USD),
    scriptGenerateLimitPerClip: scriptLimit,
    canCreatePrivateAgent: canPrivate,
    canSelectVoiceManually: canVoice,
    canExportVideo: canExport,
    noWatermark,
  };
}

export const CREDIT_PLANS: Record<PlanId, Plan> = {
  starter: planFromEnv("starter", "Starter", 7.99, 1_000, 1, false, false, false, false),
  plus: planFromEnv("plus", "Plus", 21.99, 3_000, 3, false, true, true, false),
  pro: planFromEnv("pro", "Pro", 57.99, 10_000, 3, true, true, true, true),
  ultra: planFromEnv("ultra", "Ultra", 209.99, 40_000, 3, true, true, true, true),
};

export const PLAN_IDS: PlanId[] = ["starter", "plus", "pro", "ultra"];

export function getPlan(planId: string): Plan | null {
  if (PLAN_IDS.includes(planId as PlanId)) {
    return CREDIT_PLANS[planId as PlanId];
  }
  return null;
}
