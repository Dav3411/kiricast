-- 에이전트 생성 시 크레딧 차감: credit_ledger에 agent_id 추가 및 즉시 차감/환불 함수
-- Supabase SQL Editor에서 한 번 실행.

-- job_id를 nullable로 변경 (에이전트 건은 job_id 없음)
alter table public.credit_ledger
  alter column job_id drop not null;

-- 에이전트 건용 컬럼 추가
alter table public.credit_ledger
  add column if not exists agent_id uuid;

-- 에이전트 생성 시 크레딧 즉시 차감 (status = 'captured')
-- p_agent_id: 에이전트 생성 전이면 null 가능 (생성 후 동일 ledger 행에 agent_id 업데이트 가능)
create or replace function public.deduct_agent_credits(p_user_id uuid, p_agent_id uuid, p_amount integer)
returns uuid language plpgsql as $$
declare
  ledger_id uuid;
  current_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;

  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into current_balance from public.credit_wallets where user_id = p_user_id;
  if current_balance < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.credit_wallets
  set balance = balance - p_amount, updated_at = now()
  where user_id = p_user_id;

  ledger_id := gen_random_uuid();
  insert into public.credit_ledger (id, user_id, job_id, agent_id, amount, status, updated_at)
  values (ledger_id, p_user_id, null, p_agent_id, p_amount, 'captured', now());

  return ledger_id;
end;
$$;

-- 에이전트 생성 실패 시 환불 (지갑 잔액 복구 + ledger에 refund 행). p_agent_id는 null 가능.
create or replace function public.refund_agent_credits(p_user_id uuid, p_agent_id uuid, p_amount integer)
returns void language plpgsql as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  update public.credit_wallets
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (id, user_id, job_id, agent_id, amount, status, updated_at)
  values (gen_random_uuid(), p_user_id, null, p_agent_id, -p_amount, 'refund', now());
end;
$$;
