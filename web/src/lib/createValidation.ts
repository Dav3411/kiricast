import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { isNonEmpty } from "@/lib/serverUtils";

export type CreateReqBody = {
  agent1Id?: string;
  agent2Id?: string;
  title?: string;
  setting?: string;
  situation?: string;
  core_emotion?: string;
  relationship_state?: string;
  tone?: string;
  script?: Array<{ speaker: string; text: string; type?: string }>;
  /** 시리즈 연속 클립 */
  seriesId?: string;
  episodeNumber?: number;
  arcPhase?: string;
  episodeType?: string;
  /** 첫 에피소드 시 시리즈 row 없이 잡만 만들 때 사용 */
  seriesDocument?: Record<string, unknown>;
  arcDocument?: Record<string, unknown>;
  relationshipContext?: string;
  totalEpisodes?: number;
  /** 콘텐츠 언어 (ISO 639-1, e.g. "en", "ko") */
  language?: string;
};

type ValidatedFields = {
  userId: string;
  agent1Id: string;
  agent2Id: string;
  title: string;
  setting: string;
  situation: string;
  core_emotion: string;
  relationship_state: string;
  tone: string;
  body: CreateReqBody;
};

/**
 * 클립 생성 관련 API에서 공통으로 사용하는 인증 + 입력 검증.
 * 성공 시 파싱된 필드를 반환하고, 실패 시 NextResponse를 반환한다.
 */
export async function validateCreateRequest(
  req: Request,
): Promise<{ ok: true; data: ValidatedFields } | { ok: false; response: NextResponse }> {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return { ok: false, response: NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 }) };
  }

  let body: CreateReqBody;
  try {
    body = (await req.json()) as CreateReqBody;
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }

  const agent1Id = body.agent1Id?.trim() ?? "";
  const agent2Id = body.agent2Id?.trim() ?? "";
  const title = body.title?.trim() ?? "";
  const setting = body.setting?.trim() ?? "";
  const situation = body.situation?.trim() ?? "";
  const core_emotion = body.core_emotion?.trim() ?? "";
  const relationship_state = body.relationship_state?.trim() ?? "";
  const tone = body.tone?.trim() ?? "";

  if (!isNonEmpty(agent1Id) || !isNonEmpty(agent2Id) || !isNonEmpty(title)) {
    return { ok: false, response: NextResponse.json({ error: "Missing required fields" }, { status: 400 }) };
  }
  if (!isNonEmpty(setting) && !isNonEmpty(situation) && !isNonEmpty(core_emotion) && !isNonEmpty(relationship_state)) {
    return { ok: false, response: NextResponse.json({ error: "At least one of setting, situation, core emotion, or relationship state is required" }, { status: 400 }) };
  }
  if (title.length > 60) {
    return { ok: false, response: NextResponse.json({ error: "Title must be 60 characters or less" }, { status: 400 }) };
  }
  if (setting.length > 300) {
    return { ok: false, response: NextResponse.json({ error: "Setting must be 300 characters or less" }, { status: 400 }) };
  }
  if (situation.length > 300) {
    return { ok: false, response: NextResponse.json({ error: "Situation must be 300 characters or less" }, { status: 400 }) };
  }
  if (core_emotion.length > 150) {
    return { ok: false, response: NextResponse.json({ error: "Core emotion must be 150 characters or less" }, { status: 400 }) };
  }
  if (relationship_state.length > 150) {
    return { ok: false, response: NextResponse.json({ error: "Relationship state must be 150 characters or less" }, { status: 400 }) };
  }
  if (tone.length > 100) {
    return { ok: false, response: NextResponse.json({ error: "Tone must be 100 characters or less" }, { status: 400 }) };
  }
  if (agent1Id === agent2Id) {
    return { ok: false, response: NextResponse.json({ error: "Agents must be different" }, { status: 400 }) };
  }

  return { ok: true, data: { userId, agent1Id, agent2Id, title, setting, situation, core_emotion, relationship_state, tone, body } };
}
