-- Add language preference columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS creation_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS content_languages text[] NOT NULL DEFAULT '{en}';
