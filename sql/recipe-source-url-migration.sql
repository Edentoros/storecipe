-- =========================================================================
-- Storecipe: remember where an imported recipe came from
--
-- Run in the Supabase SQL editor. Safe to run more than once.
-- Imported recipes then show a "Source: site.com" link to the full original.
-- Until this is run, recipes still save fine, just without the link.
-- =========================================================================

ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS source_url text;
