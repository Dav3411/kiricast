-- Basic referrals table (invite link → pending → rewarded on first clip).
-- Run this in the Supabase SQL editor.

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  referrer_user_id uuid not null,
  referred_user_id uuid not null unique,
  status text not null default 'pending',
  rewarded_at timestamptz null
);

create index if not exists referrals_referrer_user_id_idx
  on public.referrals (referrer_user_id);

create index if not exists referrals_referred_user_id_idx
  on public.referrals (referred_user_id);

