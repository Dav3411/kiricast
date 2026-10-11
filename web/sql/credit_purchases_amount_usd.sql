-- credit_purchases: amount_krw 제거, 달러 기준 amount_usd만 사용.
-- 이미 amount_usd가 있는 DB는 amount_krw만 제거.

alter table public.credit_purchases
  add column if not exists amount_usd numeric;

-- 기존 amount_krw 값이 있으면 amount_usd가 비어 있을 수 있음 → 0으로 채운 뒤 not null 적용
update public.credit_purchases
  set amount_usd = 0
  where amount_usd is null;

alter table public.credit_purchases
  alter column amount_usd set not null;

alter table public.credit_purchases
  drop column if exists amount_krw;

comment on column public.credit_purchases.amount_usd is '결제 금액 (USD)';
