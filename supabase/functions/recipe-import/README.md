## recipe-import edge function

Imports a recipe from a web page link, from text the user typed or pasted, or
from a photo or screenshot, and returns structured fields for the Storecipe
add-recipe form. The same AI editor and house style apply to all three; text is
also how the form's "Tidy up" button works.

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
4. **AI editor on every import.** The page is sent to OpenAI with a fixed,
   server-side prompt (`buildSystemPrompt` in `lib.ts`, the "house style"): clean
   dish-name title, 1-2 sentence description, tidy ingredients, 4-10 concise method
   steps, up to 3 useful tips into Notes, metric units only. The AI receives the
   site's own schema.org `Recipe` data (exact quantities) when there is any, plus
   the visible page text (up to 24k characters, minus nav/footer/forms) for what
   that data lacks, such as prep vs cook time and the recipe notes.
5. **Output language** is the app's current language (`en` or `ru`), translating
   if needed. The browser can only pick from that fixed list.
6. **Recipe check.** The model judges whether the page is a recipe; pages with
   structured Recipe data always count as one. Every result must still contain
   at least two ingredients and one step.
7. **Fallback.** If the AI is unavailable and the site has structured data, that
   data is returned untidied (`tidied: false`) rather than failing.

8. **Site-wide daily cap.** At most `SITE_DAILY_IMPORT_LIMIT` imports (default
   100) per 24 hours across all accounts, so mass sign-ups can't run up the AI
   bill. Unlimited users are exempt. Inactive until `sql/abuse-protection.sql`
   has been run.

9. **Text and photos.** `{ text }` (20 to 20,000 characters) or `{ image }` (a
   JPEG, PNG or WebP `data:` URL, at most 4 MB; the app shrinks photos first)
   skip the page fetch and go straight to the AI editor, with the prompt
   adjusted for messy typed text or a photo. Same limits and recording as links,
   with `text` or `photo` in `source_url`. The result never has a link or photo.

What uses up a free import: a successful import, or a page the AI was asked
about and rejected as not-a-recipe. Sites that block us, bad links and our own
errors don't count.

### Setup

1. Run `sql/recipe-imports-migration.sql`, `sql/recipe-source-url-migration.sql`
   and `sql/abuse-protection.sql` in the Supabase SQL editor.
2. Set secrets:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
# Your own user id, so you're never limited (find it with: SELECT id, email FROM auth.users;)
supabase secrets set IMPORT_UNLIMITED_USER_IDS=<your-user-id>
# Optional: default is gpt-4.1-nano (cheapest); gpt-4.1-mini rewrites/translates better
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
supabase secrets set FREE_IMPORT_LIMIT=5
# Optional: imports per 24h across everyone (default 100, 0 = no cap)
supabase secrets set SITE_DAILY_IMPORT_LIMIT=100
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to edge functions
automatically.

3. Deploy (both files are needed — `index.ts` imports `lib.ts`). If deploying by
   pasting into the dashboard editor instead, paste a single-file build: `lib.ts`
   with `export ` removed, followed by `index.ts` without its `./lib.ts` import.

```bash
supabase functions deploy recipe-import
```

### Responses

Request: `POST { "url": "https://…", "language": "en" | "ru" }`, or
`{ "text": "…", "language": … }`, or `{ "image": "data:image/jpeg;base64,…", "language": … }`.

Success: `{ recipe, source: "ai" | "json-ld", tidied, remaining }` — `remaining` is
`null` for unlimited users.

Quota check: `POST { "action": "quota" }` → `{ unlimited, limit, remaining }`.

Errors: `{ error, code }` where `code` is one of `unauthenticated`,
`quota_exceeded`, `invalid_url`, `url_blocked`, `fetch_failed`, `not_html`,
`no_readable_text`, `not_recipe`, `ai_unavailable`, `ai_failed`,
`quota_unavailable`, `busy` (site-wide daily cap reached), `invalid_text`,
`invalid_image`, `invalid_request`,
`server_error`.

### image-proxy

`supabase/functions/image-proxy` downloads a recipe photo from another site for
the app to store. It shares this folder's URL-safety checks (`lib.ts`): signed-in
users only, public addresses only (every redirect re-checked), images only, at
most 10 MB and 10 s, and at most `PHOTO_FETCHES_PER_HOUR` (default 30) per person
(needs `sql/abuse-protection.sql`). For the dashboard editor, paste a single-file
build: `lib.ts` with `export ` removed, followed by its `index.ts` without the
`../recipe-import/lib.ts` import.
