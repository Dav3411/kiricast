-- 일별 클립 조회수 (Now Trending 최근 7일 기준)
create table if not exists public.clip_views_daily (
  day date not null,
  clip_id uuid not null references public.clips(id) on delete cascade,
  views bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, clip_id)
);

create index if not exists clip_views_daily_day_idx on public.clip_views_daily (day desc);

create or replace function public.increment_clip_view_daily(p_clip_id uuid)
returns void language plpgsql as $$
declare
  today date := current_date;
begin
  insert into public.clip_views_daily (day, clip_id, views, updated_at)
  values (today, p_clip_id, 1, now())
  on conflict (day, clip_id)
  do update set views = public.clip_views_daily.views + 1, updated_at = now();
end;
$$;
