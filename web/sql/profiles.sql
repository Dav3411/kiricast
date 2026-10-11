-- User profiles (nickname). Run in Supabase SQL editor.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_nickname_idx on public.profiles (lower(nickname));

alter table public.profiles enable row level security;

create policy "Profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 새 유저 가입 시 profiles + credit_wallets 행 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  nick text;
begin
  nick := trim(coalesce(new.raw_user_meta_data->>'nickname', ''));
  if nick = '' or length(nick) < 1 or length(nick) > 32 then
    nick := 'User-' || left(new.id::text, 8);
  end if;
  insert into public.profiles (user_id, nickname, updated_at)
  values (new.id, nick, now())
  on conflict (user_id) do update set
    nickname = coalesce(excluded.nickname, profiles.nickname),
    updated_at = now();

  insert into public.credit_wallets (user_id, balance, updated_at)
  values (new.id, 0, now())
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
