-- 클립 좋아요 (유저당 클립당 1회만)
create table if not exists public.clip_likes (
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);

create index if not exists clip_likes_clip_id_idx on public.clip_likes (clip_id);

-- RLS: 본인만 자신의 좋아요 행 조회/삽입 가능
alter table public.clip_likes enable row level security;

create policy "Users can view own likes"
  on public.clip_likes for select
  using (auth.uid() = user_id);

create policy "Users can insert own like"
  on public.clip_likes for insert
  with check (auth.uid() = user_id);

-- 서버(service role)에서 전체 조회/삽입 가능하므로 별도 정책 없음
-- (supabaseAdmin은 service role 사용)

-- (좋아요 수는 clips.like_count 에 통합. clip_like_counts 제거 시 drop_clip_like_counts.sql 실행)
