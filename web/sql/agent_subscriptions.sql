-- Agent subscriptions table
-- Users can subscribe to agents they like for quick access in Create Clip page

create table if not exists public.agent_subscriptions (
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, user_id)
);

create index if not exists agent_subscriptions_agent_id_idx on public.agent_subscriptions (agent_id);
create index if not exists agent_subscriptions_user_id_idx on public.agent_subscriptions (user_id);

alter table public.agent_subscriptions enable row level security;

create policy "Users can view own subscriptions"
  on public.agent_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own subscription"
  on public.agent_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own subscription"
  on public.agent_subscriptions for delete
  using (auth.uid() = user_id);

-- Add subscriber_count column to agents table
alter table public.agents add column if not exists subscriber_count integer not null default 0;

-- Trigger: increment subscriber_count on subscribe
create or replace function public.inc_agent_subscriber_count()
returns trigger language plpgsql as $$
begin
  update public.agents set subscriber_count = subscriber_count + 1 where id = NEW.agent_id;
  return NEW;
end;
$$;

drop trigger if exists trg_inc_agent_subscriber_count on public.agent_subscriptions;
create trigger trg_inc_agent_subscriber_count
  after insert on public.agent_subscriptions
  for each row execute procedure public.inc_agent_subscriber_count();

-- Trigger: decrement subscriber_count on unsubscribe
create or replace function public.dec_agent_subscriber_count()
returns trigger language plpgsql as $$
begin
  update public.agents set subscriber_count = greatest(0, subscriber_count - 1) where id = OLD.agent_id;
  return OLD;
end;
$$;

drop trigger if exists trg_dec_agent_subscriber_count on public.agent_subscriptions;
create trigger trg_dec_agent_subscriber_count
  after delete on public.agent_subscriptions
  for each row execute procedure public.dec_agent_subscriber_count();

-- Backfill existing counts (run once after table creation)
update public.agents a
set subscriber_count = (
  select count(*) from public.agent_subscriptions s where s.agent_id = a.id
);
