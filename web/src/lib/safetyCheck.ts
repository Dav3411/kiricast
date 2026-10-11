/**
 * 콘텐츠 안전 검사 유틸리티
 *
 * 서비스 운영 가이드에 따라 5가지 금지 항목을 LLM으로 분류합니다.
 * openai npm 패키지 없이 fetch로 직접 호출합니다.
 */

export type SafetyResult = {
  safe: boolean;
  issues: string[];
  reason?: string;
};

const SAFETY_ISSUES = [
  "REAL_PERSON_CLAIM",
  "PERSONAL_INFO",
  "SEXUAL_CONTENT",
  "HARM_CONTENT",
  "COPYRIGHT_CHARACTER",
] as const;

export type SafetyIssue = (typeof SAFETY_ISSUES)[number];

const CLASSIFICATION_PROMPT = `You are a content safety classifier for a fictional AI character dialogue platform.
Analyze the following text and check for these 5 prohibited content types (answer YES or NO for each):

1. REAL_PERSON_CLAIM: Does the text claim to represent, quote, or speak as a real identifiable person? (confessions, interviews, leaked recordings, etc.)
2. PERSONAL_INFO: Does the text contain personal information such as phone numbers, email addresses, home addresses, or national ID numbers?
3. SEXUAL_CONTENT: Does the text contain explicit sexual acts or graphic sexual descriptions?
4. HARM_CONTENT: Does the text promote or instruct on crimes, self-harm, suicide, or dangerous illegal activities?
5. COPYRIGHT_CHARACTER: Does the text reproduce a specific copyrighted character (from anime, games, movies) speaking as themselves?

Return ONLY valid JSON in this format:
{"safe": true_or_false, "issues": ["ISSUE_NAME", ...], "reason": "brief explanation in Korean"}

If no issues found, return: {"safe": true, "issues": [], "reason": null}`;

/** 안전 검사에 사용할 OpenAI 모델. OPENAI_API_MODEL 미설정 시 gpt-5-mini */
const SAFETY_CHECK_MODEL =
  (process.env.OPENAI_API_MODEL ?? "gpt-5-mini").trim() || "gpt-5-mini";

/**
 * OpenAI로 텍스트 안전 검사를 수행합니다.
 * 모델은 OPENAI_API_MODEL로 지정 가능하며, 미설정 시 gpt-4o-mini 사용.
 * API 오류 시 safe:true로 폴백하여 서비스 장애를 방지합니다.
 */
export async function checkContentSafety(text: string): Promise<SafetyResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[safetyCheck] OPENAI_API_KEY 없음 - 안전 검사 건너뜀");
    return { safe: true, issues: [] };
  }

  // 개인정보 패턴이 텍스트에 있으면 LLM 호출 없이 즉시 차단
  const piResult = checkPersonalInfoPatterns(text);
  if (!piResult.safe) {
    return piResult;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SAFETY_CHECK_MODEL,
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          { role: "user", content: `Text to analyze:\n${text.slice(0, 2000)}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      console.warn(`[safetyCheck] OpenAI API 오류 ${response.status} - 폴백`);
      return { safe: true, issues: [] };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as {
      safe?: boolean;
      issues?: string[];
      reason?: string | null;
    };

    return {
      safe: parsed.safe !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      reason: parsed.reason ?? undefined,
    };
  } catch (err) {
    console.warn("[safetyCheck] 안전 검사 실패, 폴백:", err);
    return { safe: true, issues: [] };
  }
}

/**
 * 정규식으로 개인정보 패턴을 빠르게 검사합니다. (LLM 호출 없음)
 */
function checkPersonalInfoPatterns(text: string): SafetyResult {
  const patterns = [
    // 한국 휴대폰·일반전화
    /\b01[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
    /\b0[2-9]\d[-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
    // 이메일
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    // 주민등록번호 패턴 (6자리-7자리)
    /\b\d{6}[-\s]?\d{7}\b/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return {
        safe: false,
        issues: ["PERSONAL_INFO"],
        reason: "개인정보(전화번호, 이메일, 식별번호 등)가 포함되어 있습니다.",
      };
    }
  }

  return { safe: true, issues: [] };
}

/**
 * 텍스트에서 개인정보 패턴을 제거하여 반환합니다.
 */
export function stripPersonalInfo(text: string): string {
  return text
    .replace(/\b01[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[전화번호 삭제]")
    .replace(/\b0[2-9]\d[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[전화번호 삭제]")
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[이메일 삭제]")
    .replace(/\b\d{6}[-\s]?\d{7}\b/g, "[식별번호 삭제]");
}
