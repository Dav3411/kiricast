-- Script generation jobs only (separate from main jobs table).
-- Worker processes queued rows, calls Generator /api/clips/script, stores result here.
create table if not exists public.script_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed')),
  progress int default 0,
  payload jsonb not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz
);

comment on table public.script_generation_jobs is 'Script generation requests; processed by Worker calling Generator /api/clips/script.';

create index if not exists idx_script_generation_jobs_user_created
  on public.script_generation_jobs (user_id, created_at desc);
create index if not exists idx_script_generation_jobs_status_started
  on public.script_generation_jobs (status, started_at)
  where status in ('queued', 'processing');

alter table public.script_generation_jobs enable row level security;

create policy "Users can view own script_generation_jobs"
  on public.script_generation_jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert own script_generation_jobs"
  on public.script_generation_jobs for insert
  with check (auth.uid() = user_id);

-- Service role (Worker) needs full access; use service_role key for Worker.
