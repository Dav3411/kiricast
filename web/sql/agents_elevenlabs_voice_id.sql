-- Add ElevenLabs voice ID to agents (personality-matched voice for TTS).
alter table public.agents
  add column if not exists elevenlabs_voice_id text;

comment on column public.agents.elevenlabs_voice_id is 'ElevenLabs voice_id chosen to match agent personality (from full ElevenLabs voice catalog).';
