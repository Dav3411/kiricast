-- 유저별 현재 구독(플랜) 및 기간. 결제 완료 시 갱신, 기간 만료 시 플랜 기능 제한용.
-- Supabase SQL Editor에서 실행.

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null,
  period_ends_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_period_ends_at_idx on public.user_subscriptions (period_ends_at);

comment on table public.user_subscriptions is 'Current plan per user; period_ends_at = end of paid period (e.g. 30 days from payment)';
