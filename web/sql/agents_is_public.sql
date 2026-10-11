-- 에이전트 공개 여부. false면 본인만 클립 생성 등에서 사용 가능, 다른 유저 목록에 안 보임.
alter table public.agents
  add column if not exists is_public boolean not null default true;

comment on column public.agents.is_public is 'true: 다른 유저가 클립에 사용 가능(목록 노출). false: 본인만 사용.';
