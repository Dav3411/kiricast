-- Migration: jobs, script_generation_jobs에 source 컬럼 추가
-- 로컬 워커와 프로덕션 워커가 자기 source의 job만 처리하도록 분리

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source text DEFAULT 'production';
ALTER TABLE script_generation_jobs ADD COLUMN IF NOT EXISTS source text DEFAULT 'production';

CREATE INDEX IF NOT EXISTS idx_jobs_source_status ON jobs(source, status);
CREATE INDEX IF NOT EXISTS idx_script_jobs_source_status ON script_generation_jobs(source, status);
