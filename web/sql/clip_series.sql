-- Migration: clip_series 테이블 + clips 시리즈 컬럼
-- 연속 클립 (continuation clip) 시스템 지원

-- 1. clip_series 테이블 생성
CREATE TABLE IF NOT EXISTS clip_series (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  agent1_id             uuid REFERENCES agents(id),
  agent2_id             uuid REFERENCES agents(id),
  setting               text DEFAULT '',
  relationship_context  text DEFAULT '',
  total_episodes        int,  -- NULL = open-ended series (no fixed limit)
  story_context         jsonb DEFAULT '[]'::jsonb,
  status                text DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_series_owner ON clip_series(owner_id);

-- RLS
ALTER TABLE clip_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own series"
  ON clip_series FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert own series"
  ON clip_series FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own series"
  ON clip_series FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own series"
  ON clip_series FOR DELETE
  USING (auth.uid() = owner_id);

-- Service role (worker) full access
CREATE POLICY "Service role full access on clip_series"
  ON clip_series FOR ALL
  USING (auth.role() = 'service_role');

-- 2-1. next_episode_options: 다음 에피소드 선택지 (클립 생성 시 LLM이 미리 생성)
ALTER TABLE clip_series ADD COLUMN IF NOT EXISTS next_episode_options jsonb DEFAULT '[]'::jsonb;

-- 3. clips 테이블에 시리즈 컬럼 추가
ALTER TABLE clips ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES clip_series(id) ON DELETE SET NULL;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS episode_number int;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS arc_phase text;

CREATE INDEX IF NOT EXISTS idx_clips_series ON clips(series_id, episode_number);
