-- Admin 계정 소유 에이전트 share: 지급하지 않고 사실·금액만 기록하기 위한 컬럼.
-- payout_skipped_reason = 'admin' 이면 apply_rewards 시 지갑에 넣지 않음.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reward_agent_shares' and column_name = 'payout_skipped_reason'
  ) then
    alter table public.reward_agent_shares
    add column payout_skipped_reason text;
  end if;
end $$;

comment on column public.reward_agent_shares.payout_skipped_reason is 'admin: 에이전트 소유자가 admin인 경우, share 금액은 기록만 하고 실제 지급하지 않음';
