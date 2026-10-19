-- =========================================================================
-- Storecipe: every recipe can be shared by link
--
-- Run in the Supabase SQL editor (after sharing.sql). Idempotent.
--
-- Recipes aren't private: each one gets a link code when it's created, so
-- Share always just works and there's no "stop sharing". A recipe is still
-- only visible to someone who has its link: shared recipes can't be listed
-- or searched (see sharing.sql).
-- =========================================================================

ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS share_token text;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_share_token_key
  ON public.recipes(share_token) WHERE share_token IS NOT NULL;

-- 16 URL-safe characters (about 90 random bits, from a random UUID), the
-- same shape as the codes the app makes: /r/<code>.
CREATE OR REPLACE FUNCTION public.new_share_token()
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT substr(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_'), 1, 16)
$$;

-- New recipes (including copies saved from someone's link) come shared.
ALTER TABLE public.recipes ALTER COLUMN is_public SET DEFAULT true;
ALTER TABLE public.recipes ALTER COLUMN share_token SET DEFAULT public.new_share_token();

-- Existing recipes: share them all, keeping any links already sent.
UPDATE public.recipes SET share_token = public.new_share_token() WHERE share_token IS NULL;
UPDATE public.recipes SET is_public = true WHERE is_public IS DISTINCT FROM true;
