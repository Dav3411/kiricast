-- clips 테이블에 비공개 처리 컬럼 추가
ALTER TABLE clips ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- 신고 테이블
CREATE TABLE IF NOT EXISTS clip_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('defamation', 'copyright', 'privacy', 'inappropriate', 'other')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clip_reports_clip_id_idx ON clip_reports(clip_id);
CREATE INDEX IF NOT EXISTS clip_reports_reporter_idx ON clip_reports(reporter_id);

-- RLS: 인증된 사용자만 신고 추가 가능, 서비스 롤은 전체 접근
ALTER TABLE clip_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY clip_reports_insert ON clip_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY clip_reports_service ON clip_reports
  FOR ALL TO service_role
  USING (true);
