-- 리워드 이중 지급 방지: reward_payouts에 applied_at 추가
-- 출금 요청: withdrawal_requests 테이블 (현금 출금 가능)

-- 1) reward_payouts에 applied_at 컬럼 추가 (이미 있으면 무시)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reward_payouts' and column_name = 'applied_at'
  ) then
    alter table public.reward_payouts
    add column applied_at timestamptz;
  end if;
end $$;

-- 2) 출금 요청 테이블 (현금 출금)
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount_usd numeric not null check (amount_usd > 0),
  status text not null default 'pending',  -- pending | completed | rejected
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  note text
);

create index if not exists withdrawal_requests_user_id_idx on public.withdrawal_requests (user_id);
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status);

comment on table public.withdrawal_requests is '유저 리워드 현금 출금 요청. pending → completed 시 실제 송금 처리';
