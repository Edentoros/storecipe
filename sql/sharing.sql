-- =========================================================================
-- Storecipe: share a recipe by link
--
-- Run in the Supabase SQL editor. Idempotent — safe to run more than once.
--
-- A shared recipe has is_public = true and a long random share_token; the link
-- is share.html?token=<share_token>. Owners turn sharing on and off through
-- their existing "update own recipes" policy.
--
-- There is deliberately NO policy letting signed-out visitors read recipes:
-- with one, anyone could list every shared recipe (is_public=eq.true) without
-- having a link. Shared recipes are read only through the shared-recipe edge
-- function, which looks a recipe up by its exact token and returns just the
-- recipe (never the owner's email or other recipes), with a short-lived link
-- to its photo.
-- =========================================================================

ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS share_token text;

-- One recipe per token, and fast lookups by token.
CREATE UNIQUE INDEX IF NOT EXISTS recipes_share_token_key
  ON public.recipes(share_token) WHERE share_token IS NOT NULL;

-- Saved copies remember where they came from, so saving the same shared
-- recipe twice opens the copy you already have (also added by
-- friends-migration.sql; repeated here so sharing works without friends).
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS copied_from_recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS copied_from_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- If an earlier experiment added a policy that lets anyone read public
-- recipes, it would allow listing them all. Check with:
--   SELECT policyname, roles, qual FROM pg_policies WHERE tablename = 'recipes';
-- and drop any SELECT policy for the anon role, e.g.:
--   DROP POLICY "<policy name>" ON public.recipes;
