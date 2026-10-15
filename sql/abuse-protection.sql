-- =========================================================================
-- Storecipe: abuse protection
--
-- Run in the Supabase SQL editor (safe to run more than once). It:
--   1. Stops any signed-in user listing everyone's profile (and email).
--      You can see your own profile, and those of people you follow or who
--      follow you. Finding someone new needs their exact email or invite code.
--   2. Makes following go through that same lookup, so nobody can follow
--      people by id without knowing their email or code (which would let them
--      read those people's shared recipes), and only lets a follow row's
--      "muted" switch be changed afterwards.
--   3. Adds what the edge functions need for usage limits: a count of all
--      imports in the last 24 hours (for a site-wide daily cap) and a table
--      recording photo-link fetches (for a per-person hourly cap).
-- =========================================================================

-- 1. Profiles: no more "list everyone" ------------------------------------
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self_and_friends" ON public.profiles;
CREATE POLICY "profiles_select_self_and_friends" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE (f.follower_id = auth.uid() AND f.followee_id = profiles.id)
         OR (f.followee_id = auth.uid() AND f.follower_id = profiles.id)
    )
  );

-- Exact email (any case) or invite code; one row or none.
CREATE OR REPLACE FUNCTION public.find_profile(lookup text)
RETURNS TABLE (id uuid, email text, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.display_name
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND length(trim(coalesce(lookup, ''))) > 0
    AND (lower(p.email) = lower(trim(lookup)) OR p.invite_code = upper(trim(lookup)))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_profile(text) TO authenticated;

-- 2. Following only by email or invite code --------------------------------
CREATE OR REPLACE FUNCTION public.follow_profile(lookup text)
RETURNS SETOF public.friendships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in.';
  END IF;
  SELECT p.id INTO target
  FROM public.profiles p
  WHERE length(trim(coalesce(lookup, ''))) > 0
    AND (lower(p.email) = lower(trim(lookup)) OR p.invite_code = upper(trim(lookup)))
  LIMIT 1;
  IF target IS NULL THEN
    RAISE EXCEPTION 'No one found with that email or code.';
  END IF;
  IF target = auth.uid() THEN
    RAISE EXCEPTION 'You can''t follow yourself.';
  END IF;
  INSERT INTO public.friendships (follower_id, followee_id)
  VALUES (auth.uid(), target)
  ON CONFLICT (follower_id, followee_id) DO NOTHING;
  RETURN QUERY
    SELECT * FROM public.friendships f WHERE f.follower_id = auth.uid() AND f.followee_id = target;
END;
$$;
REVOKE ALL ON FUNCTION public.follow_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_profile(text) TO authenticated;

-- Direct inserts are no longer allowed (they skipped the email/code check).
DROP POLICY IF EXISTS "friendships_insert_self" ON public.friendships;

-- After following, only "muted" can change (not who is being followed).
REVOKE UPDATE ON public.friendships FROM authenticated, anon;
GRANT UPDATE (is_muted) ON public.friendships TO authenticated;

-- 3a. Site-wide import count for the daily cap -----------------------------
-- Users can only read their own import rows, so the edge function asks this
-- function for the total. It returns a number only, never anyone's rows.
CREATE INDEX IF NOT EXISTS recipe_imports_created_at_idx ON public.recipe_imports(created_at);
CREATE OR REPLACE FUNCTION public.recipe_imports_last_24h()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.recipe_imports WHERE created_at > now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.recipe_imports_last_24h() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recipe_imports_last_24h() TO authenticated;

-- 3b. Photo-link fetches, for the per-person hourly cap --------------------
CREATE TABLE IF NOT EXISTS public.image_proxy_uses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_proxy_uses_user_time_idx ON public.image_proxy_uses(user_id, created_at);
ALTER TABLE public.image_proxy_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "image_proxy_uses_select_own" ON public.image_proxy_uses;
CREATE POLICY "image_proxy_uses_select_own" ON public.image_proxy_uses
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "image_proxy_uses_insert_own" ON public.image_proxy_uses;
CREATE POLICY "image_proxy_uses_insert_own" ON public.image_proxy_uses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- No update or delete policies: nobody can reset their own count.
