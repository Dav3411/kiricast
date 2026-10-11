-- 리워드 출금 수령처 (전자결제 자동화용).
-- 유저별 PayPal 이메일 등록 시 자동 출금에 사용.

create table if not exists public.payout_destinations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null default 'paypal',  -- paypal | (추후 stripe, bank 등)
  paypal_email text,
  updated_at timestamptz not null default now()
);

create index if not exists payout_destinations_method_idx on public.payout_destinations (method);

comment on table public.payout_destinations is '리워드 출금 수령처. paypal_email 있으면 PayPal Payouts로 자동 송금 시도';

-- RLS: 본인만 읽기/쓰기
alter table public.payout_destinations enable row level security;

drop policy if exists "Users can read own payout destination" on public.payout_destinations;
create policy "Users can read own payout destination"
  on public.payout_destinations for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own payout destination" on public.payout_destinations;
create policy "Users can insert own payout destination"
  on public.payout_destinations for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own payout destination" on public.payout_destinations;
create policy "Users can update own payout destination"
  on public.payout_destinations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
