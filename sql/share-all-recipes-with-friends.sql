-- =========================================================================
-- Storecipe: every recipe is visible to friends
--
-- Run in the Supabase SQL editor. Safe to run more than once.
-- "Visible to friends" means people who follow you (they added your invite
-- code or email). It does NOT make recipes public to anyone with a link.
-- =========================================================================

-- Existing recipes
UPDATE public.recipes
SET is_shared_with_friends = true
WHERE is_shared_with_friends IS DISTINCT FROM true;

-- New recipes, even if something saves one without the field
ALTER TABLE public.recipes ALTER COLUMN is_shared_with_friends SET DEFAULT true;
