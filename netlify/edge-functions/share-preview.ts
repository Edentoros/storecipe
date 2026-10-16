// Link previews for shared recipes. Telegram, WhatsApp, iMessage and others
// build their preview card from the page's <meta> tags without running its
// JavaScript, and share.html is the same file for every recipe. This fills in
// the recipe's title, description and photo before the page is sent.
//
// Uses the shared-recipe Supabase function, so it shows exactly what the page
// would (nothing for links that aren't shared). If anything goes wrong, the
// page is sent unchanged.

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const LOOKUP_TIMEOUT_MS = 3000;
const MARKER = "<!-- share-preview -->";

type Context = { next: () => Promise<Response> };
declare const Netlify: { env: { get: (name: string) => string | undefined } };

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shorten(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

type Shared = { recipe?: Record<string, unknown>; photoUrl?: string | null; sharedBy?: string | null };

// "Dima sent you a recipe." in the recipe's own language (Russian if it's
// written in Cyrillic), since the preview card is shown whichever app the
// link was sent through, even when the message text gets dropped.
function senderLine(name: string, recipeText: string) {
  return /[\u0400-\u04FF]/.test(recipeText) ? `${name} делится с вами рецептом.` : `${name} sent you a recipe.`;
}

async function lookup(token: string): Promise<Shared | null> {
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return null;
  const response = await fetch(`${url}/functions/v1/shared-recipe`, {
    method: "POST",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  if (!response.ok) return null;
  return await response.json();
}

export function previewTags(shared: Shared, pageUrl: string, origin: string): { title: string; tags: string } {
  const recipe = shared.recipe || {};
  const title = shorten(String(recipe.title || "Recipe"), 90);
  const ingredients = String(recipe.ingredients || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const about = String(recipe.description || "").trim() || ingredients.slice(0, 4).join(", ");
  const name = shorten(String(shared.sharedBy || ""), 40);
  const sender = name ? senderLine(name, `${recipe.title || ""} ${about}`) : "";
  const description = shorten([sender, about].filter(Boolean).join(" "), 220);
  const image = /^https:\/\//i.test(String(shared.photoUrl || "")) ? String(shared.photoUrl) : `${origin}/icons/icon-512.png`;
  const tags = [
    ["og:type", "article"],
    ["og:site_name", "Storecipe"],
    ["og:title", title],
    ["og:description", description],
    ["og:url", pageUrl],
    ["og:image", image],
    ["og:image:alt", title]
  ]
    .map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}" />`)
    .concat([
      `<meta name="twitter:card" content="${shared.photoUrl ? "summary_large_image" : "summary"}" />`,
      `<meta name="description" content="${escapeAttr(description)}" />`
    ])
    .join("\n    ");
  return { title: `${title} – Storecipe`, tags };
}

export default async (request: Request, context: Context) => {
  const response = await context.next();
  const token = new URL(request.url).searchParams.get("token") || "";
  const type = response.headers.get("content-type") || "";
  if (!TOKEN_RE.test(token) || !response.ok || !type.includes("text/html")) return response;

  try {
    const shared = await lookup(token);
    if (!shared?.recipe) return response;
    const page = await response.text();
    const { origin } = new URL(request.url);
    const { title, tags } = previewTags(shared, request.url, origin);
    const html = page
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`)
      .replace(/<meta name="description"[^>]*>\s*/, "")
      .replace(MARKER, tags);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    // The photo link inside expires after an hour, so don't keep this page.
    headers.set("cache-control", "no-store");
    return new Response(html, { status: response.status, headers });
  } catch (error) {
    console.error("share-preview: falling back to the plain page", error);
    return response;
  }
};

export const config = { path: ["/share.html", "/share"] };
