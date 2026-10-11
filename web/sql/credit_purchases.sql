-- Stripe 결제 완료 시 크레딧 지급 이중 처리 방지용.
-- Supabase SQL Editor에서 실행 후, Stripe 웹훅에서 이 테이블을 조회/삽입합니다.

create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  credits integer not null,
  amount_usd numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_purchases_user_id_idx on public.credit_purchases (user_id);
create index if not exists credit_purchases_stripe_session_id_idx on public.credit_purchases (stripe_session_id);

comment on table public.credit_purchases is 'Stripe Checkout 결제 완료 건 (이중 지급 방지용)';
