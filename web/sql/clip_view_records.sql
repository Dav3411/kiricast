-- 조회수 리워드 어뷰징 방지: 계정당 클립당 24시간에 1회만 유효 조회로 인정
-- (clip_view_records.last_viewed_at 기준으로 24h 내 중복 조회는 카운트하지 않음)
create table if not exists public.clip_view_records (
  viewer_id uuid not null,
  clip_id uuid not null references public.clips(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (viewer_id, clip_id)
);

create index if not exists clip_view_records_viewer_recent_idx
  on public.clip_view_records (viewer_id, last_viewed_at desc);

comment on table public.clip_view_records is 'Per-account per-clip last view time; used to enforce 1 valid view per 24h for rewards.';
