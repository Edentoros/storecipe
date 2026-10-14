-- =========================================================================
-- Storecipe: recipe import usage tracking (free import limit)
--
-- Run in the Supabase SQL editor. Idempotent — safe to run more than once.
--
-- One row per import attempt that counts against a user's free limit:
--   status 'ok'       - a recipe was imported
--   status 'rejected' - the AI was asked and judged the page not a recipe
-- Failed fetches, blocked links and our own errors are never recorded.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.recipe_imports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url text,
  source text NOT NULL CHECK (source IN ('json-ld', 'ai')),
  status text NOT NULL CHECK (status IN ('ok', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipe_imports_user_idx ON public.recipe_imports(user_id);

ALTER TABLE public.recipe_imports ENABLE ROW LEVEL SECURITY;

-- The edge function counts and records usage with the caller's own token, so
-- users need to read and insert their own rows.
DROP POLICY IF EXISTS "recipe_imports_select_own" ON public.recipe_imports;
CREATE POLICY "recipe_imports_select_own" ON public.recipe_imports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "recipe_imports_insert_own" ON public.recipe_imports;
CREATE POLICY "recipe_imports_insert_own" ON public.recipe_imports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Deliberately NO update or delete policy: with RLS on, both are denied, so a
-- user can't wipe their own rows to reset the free limit. Inserting extra rows
-- by hand only uses up their own allowance.

-- Check your usage:
--   SELECT status, source, count(*) FROM public.recipe_imports GROUP BY 1, 2;
-- Find your own user id (for IMPORT_UNLIMITED_USER_IDS):
--   SELECT id, email FROM auth.users;
