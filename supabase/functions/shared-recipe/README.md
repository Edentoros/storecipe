## shared-recipe edge function

Backs recipe sharing by link (`share.html?token=…`).

- `POST { "token": "…" }`, for anyone with the link: the recipe's own fields
  (title, description, category, ingredients, method, notes, times, serves,
  difficulty, source link), the sharer's display name if they set one, and a
  one-hour link to the photo. Never the owner's email, ids or other recipes.
- `POST { "action": "save", "token": "…" }`, for signed-in users: copies the
  recipe, and its photo into their own storage folder, into their recipes.
  Saving again returns the existing copy (`already_saved`); the owner gets
  their own recipe back (`yours`). Otherwise `{ id, status: "saved" }`.

Errors: `{ error, code }` with `not_found` (unknown token, or no longer
shared), `unauthenticated`, `unavailable` (not set up), `save_failed`,
`invalid_request`, `server_error`.

### Setup

1. Run `sql/sharing.sql` in the Supabase SQL editor.
2. Deploy **without JWT verification**: visitors who open a link aren't signed
   in, so they have no Supabase token. The function checks sign-in itself for
   saving.

```bash
supabase functions deploy shared-recipe --no-verify-jwt
```

In the dashboard editor: create a function named `shared-recipe`, paste
`index.ts` (it has no other files), deploy, then turn off **Enforce JWT
verification** in its settings.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to edge functions automatically. The service role key is needed because
signed-out visitors can't read the recipes table: there's deliberately no
public read policy, so shared recipes can't be listed without their links.
