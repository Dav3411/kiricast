-- clips 테이블에 좋아요 수 컬럼 통합
alter table public.clips
  add column if not exists like_count int not null default 0;

-- clip_likes INSERT/DELETE 시 clips.like_count 자동 반영
create or replace function public.clip_likes_sync_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.clips set like_count = like_count + 1 where id = new.clip_id;
  elsif tg_op = 'DELETE' then
    update public.clips set like_count = greatest(0, like_count - 1) where id = old.clip_id;
  end if;
  return null;
end;
$$;

drop trigger if exists clip_likes_sync_count_trigger on public.clip_likes;
create trigger clip_likes_sync_count_trigger
  after insert or delete on public.clip_likes
  for each row execute function public.clip_likes_sync_count();

-- 기존 clip_likes 기준으로 like_count 백필
update public.clips c
set like_count = coalesce(
  (select count(*)::int from public.clip_likes cl where cl.clip_id = c.id),
  0
);
