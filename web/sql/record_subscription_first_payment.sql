-- 구독 첫 결제 기록 + 크레딧 지급을 한 트랜잭션에서 처리 (이중 지급·미지급 방지).
-- paypal_subscription_payments_first.sql 실행 후 사용.
-- Supabase SQL Editor에서 실행.

create or replace function public.record_subscription_first_payment(
  p_subscription_id text,
  p_user_id uuid,
  p_plan_id text,
  p_credits integer,
  p_amount_usd numeric,
  p_paid_at timestamptz,
  p_paypal_sale_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.paypal_subscription_payments (
    subscription_id, user_id, plan_id, credits, amount_usd, paid_at, paypal_sale_id, is_first_payment
  )
  values (
    p_subscription_id, p_user_id, p_plan_id, p_credits, p_amount_usd, p_paid_at, p_paypal_sale_id, true
  )
  on conflict (subscription_id) where (is_first_payment = true) do nothing
  returning id into v_id;

  if v_id is null then
    return 'already_recorded';
  end if;

  insert into public.credit_wallets (user_id, balance, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  update public.credit_wallets
  set balance = balance + p_credits, updated_at = now()
  where user_id = p_user_id;

  return 'credited';
end;
$$;

comment on function public.record_subscription_first_payment is '구독 첫 결제 1회만 기록하고 크레딧 지급. 이미 기록된 구독이면 스킵. complete/웹훅 둘 다 호출 가능.';
