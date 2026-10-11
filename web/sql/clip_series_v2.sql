-- Migration v2: AI 오디오 드라마 연재 파이프라인 확장
-- 시리즈 문서, 아크 문서, 3계층 메모리, FSM, Rate Limiter, Info Budget

-- 1. 시리즈 문서 & 아크 문서
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS series_document jsonb DEFAULT NULL;
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS arc_document jsonb DEFAULT NULL;
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false;
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS locked_at timestamptz DEFAULT NULL;

-- 2. 3계층 메모리
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS rolling_summary text DEFAULT '';
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS core_memory jsonb DEFAULT '{"relationship_status":{}, "revealed_secrets":[], "key_events":[]}'::jsonb;

-- 3. 캐릭터 감정 FSM
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS character_fsm jsonb DEFAULT '{}'::jsonb;

-- 4. 내러티브 속도 제한기 (마지막 발생 에피소드 번호)
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS rate_limiter jsonb DEFAULT '{"relationship_change":0, "secret_reveal":0, "major_conflict":0}'::jsonb;

-- 5. 정보 공개 예산
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS info_budget integer DEFAULT 20;

-- 6. 클립에 시나리오/에피소드 타입 저장
ALTER TABLE clips ADD COLUMN IF NOT EXISTS scenario jsonb DEFAULT NULL;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS episode_type text DEFAULT NULL;
