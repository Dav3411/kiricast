-- clips 테이블에 agent1_id, agent2_id 컬럼 추가
-- 클립 생성 시 사용된 에이전트 정보를 직접 저장하여 jobs 테이블 간접 조회 제거

alter table public.clips add column if not exists agent1_id uuid;
alter table public.clips add column if not exists agent2_id uuid;

-- 인덱스: 에이전트별 클립 조회 최적화
create index if not exists idx_clips_agent1_id on public.clips (agent1_id) where agent1_id is not null;
create index if not exists idx_clips_agent2_id on public.clips (agent2_id) where agent2_id is not null;

-- 기존 클립에 대해 jobs 테이블에서 agent1_id, agent2_id 역채움 (backfill)
update public.clips c
set
  agent1_id = (j.payload->>'agent1_id')::uuid,
  agent2_id = (j.payload->>'agent2_id')::uuid
from public.jobs j
where j.clip_id = c.id
  and c.agent1_id is null
  and j.payload->>'agent1_id' is not null
  and j.payload->>'agent2_id' is not null;
