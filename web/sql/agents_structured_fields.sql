-- 에이전트 구조화 필드: system_prompt 단일 필드 → personality, concept, speaking_style, appearance 분리
-- 기존 system_prompt 컬럼은 유지 (하위 호환 + 점진적 마이그레이션)

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS personality text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS concept text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS speaking_style text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS appearance text;
