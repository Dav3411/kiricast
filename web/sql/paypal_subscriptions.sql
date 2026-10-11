-- PayPal 구독(정기 결제) 추적. checkout 시 insert, 승인/웹훅 시 갱신.
-- Supabase SQL Editor에서 실행.

create table if not exists public.paypal_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscription_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  credits integer not null,
  amount_usd numeric not null,
  status text not null default 'pending',  -- pending | active | cancelled | suspended | expired
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create index if not exists paypal_subscriptions_subscription_id_idx on public.paypal_subscriptions (subscription_id);
create index if not exists paypal_subscriptions_user_id_idx on public.paypal_subscriptions (user_id);

comment on table public.paypal_subscriptions is 'PayPal Subscriptions; 정기 결제 구독 추적';
