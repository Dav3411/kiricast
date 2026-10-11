-- Intro TTS: R2 object key and duration (30초 이하 인트로 mp3).
alter table public.agents
  add column if not exists intro_mp3 text,
  add column if not exists intro_seconds real;

comment on column public.agents.intro_mp3 is 'R2 object key for intro TTS mp3 (e.g. agents/{user_id}/{id}_intro.mp3).';
comment on column public.agents.intro_seconds is 'Intro mp3 duration in seconds (target ≤30s).';
