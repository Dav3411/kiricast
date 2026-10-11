-- Add language column to clip_series and clips tables
ALTER TABLE public.clip_series
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

-- Index for feed filtering by language
CREATE INDEX IF NOT EXISTS idx_clips_language ON public.clips (language);
CREATE INDEX IF NOT EXISTS idx_clip_series_language ON public.clip_series (language);
