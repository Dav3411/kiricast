-- Create analytics events table for lightweight product metrics.
-- Run this in the Supabase SQL editor.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  anon_id text not null,
  event_name text not null,
  url text null,
  properties jsonb null,
  user_agent text null
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_name_idx
  on public.analytics_events (event_name);

create index if not exists analytics_events_user_id_idx
  on public.analytics_events (user_id);

create index if not exists analytics_events_anon_id_idx
  on public.analytics_events (anon_id);

