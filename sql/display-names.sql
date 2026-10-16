-- =========================================================================
-- Storecipe: your name on shared recipes
--
-- Run in the Supabase SQL editor after friends-migration.sql (which creates
-- profiles). Idempotent — safe to run more than once.
--
-- The sign-up form sends the name as user metadata (display_name). The
-- sign-up trigger now copies it into profiles.display_name. People can change
-- it later in Settings (their existing "update own profile" policy).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_code text;
  attempt int := 0;
  -- Trimmed, at most 40 characters, NULL when empty.
  name text := NULLIF(left(btrim(regexp_replace(coalesce(NEW.raw_user_meta_data->>'display_name', ''), '\s+', ' ', 'g')), 40), '');
BEGIN
  -- Retry a few times on the unlikely invite code collision.
  LOOP
    new_code := public.generate_invite_code();
    BEGIN
      INSERT INTO public.profiles (id, email, invite_code, display_name)
      VALUES (NEW.id, NEW.email, new_code, name);
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      attempt := attempt + 1;
      IF attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

-- People who signed up with a name before this ran.
UPDATE public.profiles p
SET display_name = NULLIF(left(btrim(u.raw_user_meta_data->>'display_name'), 40), '')
FROM auth.users u
WHERE u.id = p.id AND p.display_name IS NULL AND u.raw_user_meta_data ? 'display_name';

-- Names are short.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_length;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length CHECK (display_name IS NULL OR char_length(display_name) <= 40) NOT VALID;
