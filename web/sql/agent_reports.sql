-- agents 테이블에 신고 비공개 처리 컬럼 추가
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- 에이전트 신고 테이블
CREATE TABLE IF NOT EXISTS agent_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('defamation', 'copyright', 'privacy', 'inappropriate', 'other')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_reports_agent_id_idx ON agent_reports(agent_id);

ALTER TABLE agent_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_reports_insert ON agent_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY agent_reports_service ON agent_reports
  FOR ALL TO service_role USING (true);
