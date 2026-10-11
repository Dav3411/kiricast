-- agents.id는 UUID 전용. 프리셋(agents.json) 이전 시 예전 문자열 id를 매핑하기 위한 컬럼.
-- GET /api/agents/[id]에서 id가 UUID가 아니면 legacy_preset_id로 조회해 동일 행 반환.
alter table public.agents
  add column if not exists legacy_preset_id text unique;

comment on column public.agents.legacy_preset_id is 'Optional: preset id from agents.json (e.g. aika_tsainy_0ab3d4). Used when agents.id is UUID-only.';

-- 기존 인덱스가 없다면 조회용 인덱스(선택)
create index if not exists idx_agents_legacy_preset_id on public.agents(legacy_preset_id) where legacy_preset_id is not null;
