-- 구독 첫 결제 1회만 기록·지급 (이중 지급·미지급 방지).
-- Supabase SQL Editor에서 실행.

-- 1) is_first_payment 컬럼 추가
alter table public.paypal_subscription_payments
  add column if not exists is_first_payment boolean not null default false;

-- 2) 기존 데이터: 구독별 가장 첫 결제 행만 is_first_payment = true
update public.paypal_subscription_payments p
set is_first_payment = true
where p.id in (
  select distinct on (subscription_id) id
  from public.paypal_subscription_payments
  order by subscription_id, paid_at asc
);

-- 3) 구독당 첫 결제 1건만 허용하는 partial unique index (동시 요청·complete/웹훅 경쟁 시 한 쪽만 insert 성공)
create unique index if not exists paypal_subscription_payments_first_per_sub_idx
  on public.paypal_subscription_payments (subscription_id)
  where (is_first_payment = true);

comment on column public.paypal_subscription_payments.is_first_payment is '구독 첫 결제 여부. 구독당 1건만 true 허용(partial unique)';
