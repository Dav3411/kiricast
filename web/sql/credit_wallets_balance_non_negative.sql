-- credit_wallets.balance 가 음수가 되지 않도록 제약 추가.
-- 동시 요청 시 reserve_job_credits 내부에서 FOR UPDATE 로 행 잠금 후 차감해 레이스 방지.
-- Supabase SQL Editor에서 실행.

-- 1) 음수 잔액 방지 CHECK 제약 (기존 제약 있으면 스킵)
alter table public.credit_wallets
  drop constraint if exists credit_wallets_balance_non_negative;
alter table public.credit_wallets
  add constraint credit_wallets_balance_non_negative check (balance >= 0);

-- 2) reserve_job_credits: SELECT ... FOR UPDATE 로 동시 요청 시 한 요청만 통과하도록 원자화
create or replace function public.reserve_job_credits(p_user_id uuid, p_job_id uuid, p_amount integer)
returns uuid language plpgsql as $$
declare
  ledger_id uuid;
  current_balance integer;
begin
  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into current_balance
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  if not found or current_balance is null then
    current_balance := 0;
  end if;
  if current_balance < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.credit_wallets
  set balance = balance - p_amount, updated_at = now()
  where user_id = p_user_id;

  ledger_id := gen_random_uuid();
  insert into public.credit_ledger (id, user_id, job_id, amount, status, updated_at)
  values (ledger_id, p_user_id, p_job_id, p_amount, 'reserved', now());

  return ledger_id;
end;
$$;

comment on constraint credit_wallets_balance_non_negative on public.credit_wallets is 'Prevent negative credit balance';
