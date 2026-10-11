-- 리워드 에이전트 재분배: 클립 수익의 15%를 해당 클립에 사용된 "다른 유저" 에이전트 제작자에게 지급.
-- 클립당 최대 2명(에이전트 2개) × 15% = 최대 30%. 본인 에이전트는 제외.

create table if not exists public.reward_agent_shares (
  month text not null,
  clip_id uuid not null references public.clips(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_user_id uuid not null,
  share_usd numeric not null check (share_usd >= 0),
  created_at timestamptz not null default now(),
  primary key (month, clip_id, agent_id)
);

create index if not exists reward_agent_shares_month_agent_user_idx
  on public.reward_agent_shares (month, agent_user_id);

comment on table public.reward_agent_shares is '월별 정산 시 클립 리워드의 15%를 해당 클립에 사용된 타인 소유 에이전트 제작자에게 지급하는 내역';
