## recipe-import edge function

Imports a recipe from a web page link and returns structured fields for the
Storecipe add-recipe form. The user always reviews the result before saving.

### How it works

1. **Signed-in users only.** The caller's Supabase token is verified.
2. **Free limit.** Each user gets `FREE_IMPORT_LIMIT` imports (default 5),
   counted in the `recipe_imports` table. The limit is checked *before* any page
   is fetched or AI is called. Users listed in `IMPORT_UNLIMITED_USER_IDS` are
   never limited.
3. **Safe fetching.** Only public `http`/`https` addresses on standard ports.
   Every redirect hop is re-checked, and hostnames are resolved so a public
   name pointing at a private or cloud-metadata address is refused. Pages are
   capped at 1.5 MB and 12 seconds.
4. **Built-in recipe data first.** Most recipe sites embed schema.org `Recipe`
   data. When present it's used directly: exact, instant, and no AI cost.
5. **AI fallback.** Otherwise the page text goes to OpenAI with a fixed,
   server-side prompt (the browser cannot supply one). The model also judges
   whether the page is a recipe at all, and every result must contain at least
   two ingredients and one step, regardless of what the model says.

What uses up a free import: a successful import, or a page the AI was asked
about and rejected as not-a-recipe. Sites that block us, bad links and our own
errors don't count.

### Setup

1. Run `sql/recipe-imports-migration.sql` in the Supabase SQL editor.
2. Set secrets:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
# Your own user id, so you're never limited (find it with: SELECT id, email FROM auth.users;)
supabase secrets set IMPORT_UNLIMITED_USER_IDS=<your-user-id>
# Optional
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
supabase secrets set FREE_IMPORT_LIMIT=5
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to edge functions
automatically.

3. Deploy (both files are needed — `index.ts` imports `lib.ts`):

```bash
supabase functions deploy recipe-import
```

### Responses

Success: `{ recipe, source: "json-ld" | "ai", remaining }` — `remaining` is
`null` for unlimited users.

Quota check: `POST { "action": "quota" }` → `{ unlimited, limit, remaining }`.

Errors: `{ error, code }` where `code` is one of `unauthenticated`,
`quota_exceeded`, `invalid_url`, `url_blocked`, `fetch_failed`, `not_html`,
`no_readable_text`, `not_recipe`, `ai_unavailable`, `ai_failed`,
`quota_unavailable`, `invalid_request`, `server_error`.
