-- Add language column to agents table for content language tagging
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_agents_language ON public.agents (language);
