-- PayPal 결제 주문 추적 및 캡처 후 크레딧 지급용.
-- Supabase SQL Editor에서 실행.

create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  credits integer not null,
  amount_usd numeric not null,
  status text not null default 'pending',  -- pending | captured | failed
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

create index if not exists paypal_orders_order_id_idx on public.paypal_orders (order_id);
create index if not exists paypal_orders_user_id_idx on public.paypal_orders (user_id);

comment on table public.paypal_orders is 'PayPal Checkout orders; capture 후 크레딧 지급 및 이중 처리 방지';
