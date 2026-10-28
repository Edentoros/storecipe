import {
  blockedUrlReason,
  buildSystemPrompt,
  buildTextMessage,
  buildUserMessage,
  cleanRecipeText,
  decodeHtml,
  extractJsonLdBlocks,
  extractMainText,
  extractMetaContent,
  extractTitle,
  findRecipeNode,
  isIpLiteral,
  isPrivateAddress,
  looksLikeRecipe,
  normalizeAiRecipe,
  parseHttpUrl,
  parseImageDataUrl,
  recipeFromJsonLd,
  resolveLanguage,
  summariseStructuredRecipe,
  RECIPE_JSON_SCHEMA,
  MAX_IMAGE_DATA_URL_CHARS,
  type ImportedRecipe,
  type SourceKind
} from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
// Cheapest model that works with this request shape (temperature + strict JSON
// schema). Override with the OPENAI_MODEL secret, e.g. gpt-4.1-mini for better
// rewriting/translation. Reasoning models (gpt-5*) need request changes first.
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-nano";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Successful imports (plus pages the AI rejected as not-a-recipe) per user per
// 24 hours (a rolling window, so it doesn't depend on anyone's time zone).
const FREE_IMPORT_LIMIT = Math.max(0, Number(Deno.env.get("FREE_IMPORT_LIMIT") ?? 5) || 0);
// Comma-separated auth user ids that are never limited (the app owner).
// Site-wide ceiling on imports per 24 hours, across all accounts (new accounts
// each get FREE_IMPORT_LIMIT a day, so this caps what mass sign-ups could cost).
// Unlimited users aren't affected. 0 turns it off. Needs sql/abuse-protection.sql.
const SITE_DAILY_IMPORT_LIMIT = Math.max(0, Number(Deno.env.get("SITE_DAILY_IMPORT_LIMIT") ?? 100) || 0);
const UNLIMITED_USER_IDS = new Set(
  (Deno.env.get("IMPORT_UNLIMITED_USER_IDS") || "").split(",").map((id) => id.trim()).filter(Boolean)
);

const MAX_HTML_BYTES = 1_500_000;
// Blog-style sites put the recipe card (and its notes) at the end of a long
// article, so keep enough text to reach it. ~6k tokens: still a fraction of a cent.
const MAX_TEXT_CHARS = 24_000;
const MAX_REDIRECTS = 5;
const PAGE_TIMEOUT_MS = 12_000;
// Page (12s) + AI (30s) must stay under the browser's 45s request timeout, or the
// browser could give up while we still finish and use a credit.
const OPENAI_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 StorecipeImporter/1.0";

class ImportError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function errorResponse(error: ImportError, extra: Record<string, unknown> = {}) {
  return jsonResponse(error.status, { error: error.message, code: error.code, ...extra });
}

// ── Auth & quota ────────────────────────────────────────────────────────────
// All database access uses the caller's own token, so row-level security
// applies. The table lets users read and insert their own rows but never update
// or delete them, so nobody can reset their own counter.

type Caller = { id: string; authHeader: string; apiKey: string };

async function getCaller(request: Request): Promise<Caller> {
  const authHeader = request.headers.get("Authorization") || "";
  const apiKey = request.headers.get("apikey") || SUPABASE_ANON_KEY;
  if (!/^Bearer\s+\S+/i.test(authHeader) || !SUPABASE_URL || !apiKey) {
    throw new ImportError("unauthenticated", 401, "Please sign in to import recipes.");
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: authHeader }
  });
  const user = response.ok ? await response.json().catch(() => null) : null;
  if (!user?.id) {
    throw new ImportError("unauthenticated", 401, "Please sign in to import recipes.");
  }
  return { id: String(user.id), authHeader, apiKey };
}

async function countUsedImports(caller: Caller): Promise<number> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/recipe_imports?select=id&user_id=eq.${encodeURIComponent(caller.id)}` +
      `&created_at=gte.${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}`,
    { method: "HEAD", headers: { apikey: caller.apiKey, Authorization: caller.authHeader, Prefer: "count=exact" } }
  );
  const total = Number((response.headers.get("content-range") || "").split("/")[1]);
  if (!response.ok || !Number.isFinite(total)) {
    throw new ImportError(
      "quota_unavailable",
      503,
      "Import limits aren't set up yet. Run sql/recipe-imports-migration.sql in Supabase."
    );
  }
  return total;
}

async function assertUnderSiteDailyLimit(caller: Caller) {
  if (!SITE_DAILY_IMPORT_LIMIT) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_imports_last_24h`, {
      method: "POST",
      headers: { apikey: caller.apiKey, Authorization: caller.authHeader, "Content-Type": "application/json" },
      body: "{}"
    });
    const total = response.ok ? Number(await response.json()) : NaN;
    if (!Number.isFinite(total)) {
      // Not set up yet: carry on (the OpenAI budget is the backstop), but log it.
      console.error("recipe-import: site-wide daily limit unavailable", response.status);
      return;
    }
    if (total >= SITE_DAILY_IMPORT_LIMIT) {
      throw new ImportError("busy", 429, "Importing is paused for today because of unusually heavy use.");
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    console.error("recipe-import: site-wide daily limit check failed", error);
  }
}

async function recordImport(caller: Caller, sourceUrl: string, source: "json-ld" | "ai", status: "ok" | "rejected") {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/recipe_imports`, {
      method: "POST",
      headers: {
        apikey: caller.apiKey,
        Authorization: caller.authHeader,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{ user_id: caller.id, source_url: sourceUrl.slice(0, 2000), source, status }])
    });
    if (!response.ok) console.error("recipe-import: failed to record usage", response.status, await response.text());
  } catch (error) {
    console.error("recipe-import: failed to record usage", error);
  }
}

// ── Safe page fetch ─────────────────────────────────────────────────────────
// The function fetches whatever URL a user pastes, from inside our
// infrastructure. Every hop (including redirects) is checked so a link can't be
// used to reach private addresses or cloud metadata endpoints.

async function assertPublicDestination(url: URL) {
  const reason = blockedUrlReason(url);
  if (reason) throw new ImportError("url_blocked", 400, reason);

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host) || typeof Deno.resolveDns !== "function") return;

  const lookups = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  const addresses = lookups.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new ImportError("url_blocked", 400, "That link points to a private network address.");
  }
  const allNotFound = lookups.every(
    (result) => result.status === "rejected" && result.reason instanceof Deno.errors.NotFound
  );
  if (!addresses.length && allNotFound) {
    throw new ImportError("fetch_failed", 502, "Couldn't find that website. Check the link.");
  }
  // Any other DNS failure (e.g. lookups unsupported in this runtime) falls back
  // to the hostname checks above rather than blocking every import.
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = maxBytes - total;
    chunks.push(value.byteLength > room ? value.slice(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchPage(startUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicDestination(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en,ru;q=0.8"
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new ImportError("fetch_failed", 502, "That website sent us nowhere. Try the link again.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ImportError(
          "fetch_failed",
          502,
          response.status === 403 || response.status === 429
            ? "That website blocks automatic imports."
            : `That website didn't return the page (status ${response.status}).`
        );
      }
      const contentType = response.headers.get("content-type");
      if (contentType && !/html|xml/i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        throw new ImportError("not_html", 422, "That link isn't a web page (it looks like a file or image).");
      }
      const bytes = await readCapped(response, MAX_HTML_BYTES);
      return { html: decodeHtml(bytes, contentType), finalUrl: current };
    }
    throw new ImportError("fetch_failed", 502, "That link redirected too many times.");
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (controller.signal.aborted) throw new ImportError("fetch_failed", 502, "That website took too long to respond.");
    throw new ImportError("fetch_failed", 502, "Couldn't reach that website. Check the link.");
  } finally {
    clearTimeout(timer);
  }
}

// ── AI extraction ───────────────────────────────────────────────────────────

// userContent: plain text, or text plus an image for photos.
type UserContent = string | Array<Record<string, unknown>>;

async function extractWithAi(kind: SourceKind, userContent: UserContent, language: string) {
  if (!OPENAI_API_KEY) {
    throw new ImportError("ai_unavailable", 503, "AI import isn't configured yet (missing OPENAI_API_KEY).");
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_completion_tokens: 3000,
      response_format: { type: "json_schema", json_schema: RECIPE_JSON_SCHEMA },
      messages: [
        { role: "system", content: buildSystemPrompt(language, kind) },
        { role: "user", content: userContent }
      ]
    })
  }).catch((error) => {
    console.error(`recipe-import: OpenAI ${error?.name === "TimeoutError" ? `timed out after ${OPENAI_TIMEOUT_MS / 1000}s` : "unreachable"}`, kind, String(error));
    throw new ImportError("ai_failed", 502, "The AI service didn't respond. Please try again.");
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 429 with code insufficient_quota: out of credit or over the spending limit.
    console.error("recipe-import: OpenAI error", response.status, data?.error?.code, data?.error?.type, data?.error?.message);
    throw new ImportError("ai_failed", 502, "The AI service couldn't process this. Please try again.");
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  try {
    return JSON.parse(String(content)) as Record<string, unknown>;
  } catch (_error) {
    console.error(
      "recipe-import: unreadable AI answer", kind,
      "finish_reason:", choice?.finish_reason,
      "refusal:", choice?.message?.refusal ?? null,
      "length:", String(content ?? "").length
    );
    throw new ImportError("ai_failed", 502, "The AI returned an unreadable answer. Please try again.");
  }
}

// ── Text and photo imports ──────────────────────────────────────────────────
// Recorded like page imports, with "text" or "photo" in place of the link.

async function importWithoutPage(
  caller: Caller,
  body: Record<string, unknown>,
  used: number,
  unlimited: boolean
) {
  const language = resolveLanguage(body?.language);
  let kind: SourceKind;
  let userContent: UserContent;
  if (body.image !== undefined) {
    const image = parseImageDataUrl(body.image);
    if (!image) throw new ImportError("invalid_image", 400, "Send a JPEG, PNG or WebP photo.");
    kind = "photo";
    userContent = [
      { type: "text", text: "The photo:" },
      { type: "image_url", image_url: { url: image, detail: "high" } }
    ];
  } else {
    const text = cleanRecipeText(body.text);
    if (!text) throw new ImportError("invalid_text", 400, "Write or paste a bit more of the recipe first.");
    kind = "text";
    userContent = buildTextMessage(text);
  }

  const raw = await extractWithAi(kind, userContent, language);
  // No link and no page photo: never take an image address the AI came up with.
  const recipe: ImportedRecipe = { ...normalizeAiRecipe(raw, "", "", null), image_url: null, source_url: "" };
  if (raw.is_recipe === true && looksLikeRecipe(recipe)) {
    await recordImport(caller, kind, "ai", "ok");
    return jsonResponse(200, { recipe, source: "ai", tidied: true, remaining: remainingAfter(used + 1, unlimited) });
  }
  await recordImport(caller, kind, "ai", "rejected");
  return errorResponse(new ImportError("not_recipe", 422, "That doesn't look like a cooking recipe."), {
    remaining: remainingAfter(used + 1, unlimited)
  });
}

// ── Handler ─────────────────────────────────────────────────────────────────

function remainingAfter(used: number, unlimited: boolean): number | null {
  return unlimited ? null : Math.max(0, FREE_IMPORT_LIMIT - used);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed.", code: "method_not_allowed" });

  try {
    const caller = await getCaller(request);
    const unlimited = UNLIMITED_USER_IDS.has(caller.id);

    const rawBody = await request.text();
    // Photos arrive as data URLs; everything else is a few hundred bytes.
    if (rawBody.length > MAX_IMAGE_DATA_URL_CHARS + 10_000) {
      throw new ImportError("invalid_image", 413, "That photo is too large. Try a smaller one.");
    }
    const body = (() => {
      try {
        return JSON.parse(rawBody || "{}");
      } catch (_error) {
        throw new ImportError("invalid_request", 400, "Request body must be JSON.");
      }
    })();

    // Charge nothing and fetch nothing until we know the caller still has quota.
    const used = unlimited ? 0 : await countUsedImports(caller);

    if (body?.action === "quota") {
      return jsonResponse(200, { unlimited, limit: FREE_IMPORT_LIMIT, remaining: remainingAfter(used, unlimited) });
    }

    if (!unlimited && used >= FREE_IMPORT_LIMIT) {
      return errorResponse(
        new ImportError("quota_exceeded", 402, `You've used today's ${FREE_IMPORT_LIMIT} free imports. More tomorrow.`),
        { remaining: 0 }
      );
    }

    if (!unlimited) await assertUnderSiteDailyLimit(caller);

    // Typed/pasted text and photos: no page to fetch, straight to the AI editor.
    if (body?.text !== undefined || body?.image !== undefined) {
      return await importWithoutPage(caller, body, used, unlimited);
    }

    const requestedUrl = parseHttpUrl(body?.url);
    if (!requestedUrl) throw new ImportError("invalid_url", 400, "Paste a full web address starting with http:// or https://.");

    const { html, finalUrl } = await fetchPage(requestedUrl);
    const sourceUrl = finalUrl.toString();
    const pageTitle = extractMetaContent(html, "og:title") || extractTitle(html) || "Imported recipe";
    const ogImage = parseHttpUrl(extractMetaContent(html, "og:image"))?.toString() || null;

    const language = resolveLanguage(body?.language);

    // The site's own schema.org Recipe data, when it has any. Exact quantities,
    // but often messy (note references, junk descriptions), so it's input for the
    // AI editor rather than the final result.
    const node = findRecipeNode(extractJsonLdBlocks(html));
    const structuredRecipe = node ? recipeFromJsonLd(node, sourceUrl, pageTitle, ogImage) : null;
    const hasStructuredRecipe = Boolean(structuredRecipe && looksLikeRecipe(structuredRecipe));
    const pageText = extractMainText(html).slice(0, MAX_TEXT_CHARS);
    if (!hasStructuredRecipe && pageText.length < 80) {
      throw new ImportError("no_readable_text", 422, "That page didn't have readable text to import.");
    }

    const useStructuredFallback = async () => {
      await recordImport(caller, sourceUrl, "json-ld", "ok");
      return jsonResponse(200, {
        recipe: structuredRecipe,
        source: "json-ld",
        tidied: false,
        remaining: remainingAfter(used + 1, unlimited)
      });
    };

    let raw: Record<string, unknown>;
    try {
      raw = await extractWithAi(
        "page",
        buildUserMessage(sourceUrl, pageTitle, ogImage, node ? summariseStructuredRecipe(node) : null, pageText),
        language
      );
    } catch (error) {
      // AI down or not configured: the site's own data is better than nothing.
      if (hasStructuredRecipe) return await useStructuredFallback();
      throw error;
    }

    const recipe: ImportedRecipe = normalizeAiRecipe(raw, sourceUrl, pageTitle, ogImage);
    // Structured Recipe data is proof enough that it's a recipe, even if the
    // model says otherwise; the AI only gets to reject pages without it.
    const confirmedRecipe = raw.is_recipe === true || hasStructuredRecipe;

    if (confirmedRecipe && looksLikeRecipe(recipe)) {
      await recordImport(caller, sourceUrl, "ai", "ok");
      return jsonResponse(200, { recipe, source: "ai", tidied: true, remaining: remainingAfter(used + 1, unlimited) });
    }
    if (hasStructuredRecipe) return await useStructuredFallback();

    // A rejected page still cost an AI call, so it uses a free import. That's
    // what makes pointing the importer at random pages pointless.
    await recordImport(caller, sourceUrl, "ai", "rejected");
    return errorResponse(new ImportError("not_recipe", 422, "That page doesn't look like a cooking recipe."), {
      remaining: remainingAfter(used + 1, unlimited)
    });
  } catch (error) {
    if (error instanceof ImportError) {
      return errorResponse(error);
    }
    console.error("recipe-import: unexpected error", error);
    return jsonResponse(500, { error: "Something went wrong importing that recipe.", code: "server_error" });
  }
});
