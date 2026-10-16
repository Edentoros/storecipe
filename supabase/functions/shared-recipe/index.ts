// shared-recipe: the recipe behind a share link (share.html?token=…), and
// "Save to my recipes" for whoever opens it.
//
// - { token }: anyone with the link. Returns only that recipe's own fields
//   (never the owner's email, id or other recipes), the sharer's display name
//   if they set one, and a one-hour link to the photo (photos are private).
// - { action: "save", token }: signed-in users. Copies the recipe, and its
//   photo into their own folder, into their recipes. Saving the same recipe
//   again returns the copy they already have; the owner gets their own recipe.
//
// Lookups need the exact token (128 random bits) and is_public = true, so links
// can't be guessed or listed. Runs with the service role key because signed-out
// visitors have no access to the recipes table (see sql/sharing.sql).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "recipes";
const PHOTO_LINK_SECONDS = 60 * 60;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

// What a visitor gets to see.
const PUBLIC_FIELDS = [
  "title", "description", "category", "ingredients", "method", "notes",
  "prep_time", "cooking_time", "total_time", "serves", "difficulty", "source_url"
];
// Copied into the saver's recipes when present (older databases may lack some).
const OPTIONAL_COPY_FIELDS = [
  "category", "prep_time", "cooking_time", "total_time", "serves", "difficulty", "source_url",
  "copied_from_recipe_id", "copied_from_user_id"
];

class ShareError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

const serviceHeaders = () => ({ apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` });

type Recipe = Record<string, unknown> & { id: string; user_id: string; image_url?: string | null };

async function findSharedRecipe(token: string): Promise<Recipe> {
  const query = new URLSearchParams({ select: "*", share_token: `eq.${token}`, is_public: "eq.true", limit: "1" });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/recipes?${query}`, { headers: serviceHeaders() });
  if (!response.ok) {
    console.error("shared-recipe: lookup failed", response.status, await response.text());
    throw new ShareError(503, "unavailable", "Shared recipes aren't set up yet. Run sql/sharing.sql in Supabase.");
  }
  const rows = await response.json().catch(() => []);
  const recipe = Array.isArray(rows) ? rows[0] : null;
  if (!recipe) throw new ShareError(404, "not_found", "This recipe isn't shared any more.");
  return recipe as Recipe;
}

async function findSharerName(userId: string): Promise<string | null> {
  try {
    const query = new URLSearchParams({ select: "display_name", id: `eq.${userId}`, limit: "1" });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${query}`, { headers: serviceHeaders() });
    if (!response.ok) return null;
    const rows = await response.json();
    const name = String(rows?.[0]?.display_name ?? "").trim();
    return name ? name.slice(0, 60) : null;
  } catch (_error) {
    return null;
  }
}

// The photo's path in our storage bucket, or null for an outside web address.
function storagePath(imageUrl: unknown): string | null {
  const value = String(imageUrl ?? "").trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "").replace(new RegExp(`^${BUCKET}/`), "");
  try {
    const { pathname } = new URL(value);
    for (const prefix of [`/storage/v1/object/public/${BUCKET}/`, `/storage/v1/object/sign/${BUCKET}/`]) {
      if (pathname.includes(prefix)) return decodeURIComponent(pathname.split(prefix)[1] || "");
    }
  } catch (_error) {
    // not a URL
  }
  return null;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function photoLink(imageUrl: unknown): Promise<string | null> {
  const path = storagePath(imageUrl);
  if (!path) {
    const value = String(imageUrl ?? "").trim();
    return /^https:\/\//i.test(value) ? value : null;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: PHOTO_LINK_SECONDS })
    });
    const data = await response.json().catch(() => ({}));
    const signed = data?.signedURL || data?.signedUrl;
    if (!response.ok || !signed) return null;
    return /^https?:\/\//i.test(signed) ? signed : `${SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
  } catch (_error) {
    return null;
  }
}

async function getCallerId(request: Request): Promise<string> {
  const authHeader = request.headers.get("Authorization") || "";
  const apiKey = request.headers.get("apikey") || SUPABASE_ANON_KEY;
  if (!/^Bearer\s+\S+/i.test(authHeader)) throw new ShareError(401, "unauthenticated", "Sign in to save recipes.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: authHeader } });
  const user = response.ok ? await response.json().catch(() => null) : null;
  if (!user?.id) throw new ShareError(401, "unauthenticated", "Sign in to save recipes.");
  return String(user.id);
}

async function findExistingCopy(callerId: string, sourceId: string): Promise<string | null> {
  const query = new URLSearchParams({
    select: "id", user_id: `eq.${callerId}`, copied_from_recipe_id: `eq.${sourceId}`, limit: "1"
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/recipes?${query}`, { headers: serviceHeaders() });
  if (!response.ok) return null; // e.g. the copied_from column doesn't exist yet
  const rows = await response.json().catch(() => []);
  return rows?.[0]?.id ? String(rows[0].id) : null;
}

// Copies a stored photo into the saver's folder; outside addresses are kept.
async function copyPhoto(imageUrl: unknown, callerId: string): Promise<string | null> {
  const path = storagePath(imageUrl);
  if (!path) {
    const value = String(imageUrl ?? "").trim();
    return /^https:\/\//i.test(value) ? value : null;
  }
  const extension = (path.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "jpg").toLowerCase();
  const destination = `${callerId}/shared-${crypto.randomUUID()}.${extension}`;
  try {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ bucketId: BUCKET, sourceKey: path, destinationKey: destination })
    });
    if (!response.ok) {
      console.error("shared-recipe: photo copy failed", response.status, await response.text());
      return null;
    }
    return destination;
  } catch (error) {
    console.error("shared-recipe: photo copy failed", error);
    return null;
  }
}

async function insertRecipe(row: Record<string, unknown>): Promise<string> {
  const attempt = async (payload: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/rest/v1/recipes`, {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
  let response = await attempt(row);
  if (!response.ok) {
    // Older databases may lack some optional columns: try with the basics only.
    const message = await response.text();
    console.error("shared-recipe: insert failed, retrying with basic columns", response.status, message);
    const basic = { ...row };
    for (const field of OPTIONAL_COPY_FIELDS) delete basic[field];
    response = await attempt(basic);
  }
  const rows = await response.json().catch(() => []);
  if (!response.ok || !rows?.[0]?.id) {
    console.error("shared-recipe: insert failed", response.status, rows);
    throw new ShareError(500, "save_failed", "Couldn't save the recipe. Please try again.");
  }
  return String(rows[0].id);
}

async function saveCopy(request: Request, token: string) {
  const callerId = await getCallerId(request);
  const source = await findSharedRecipe(token);
  if (String(source.user_id) === callerId) {
    return jsonResponse(200, { id: String(source.id), status: "yours" });
  }
  const existing = await findExistingCopy(callerId, String(source.id));
  if (existing) return jsonResponse(200, { id: existing, status: "already_saved" });

  const row: Record<string, unknown> = {
    user_id: callerId,
    title: String(source.title ?? "").slice(0, 300) || "Shared recipe",
    description: source.description ?? null,
    ingredients: source.ingredients ?? "",
    method: source.method ?? "",
    notes: source.notes ?? null,
    image_url: await copyPhoto(source.image_url, callerId),
    copied_from_recipe_id: source.id,
    copied_from_user_id: source.user_id
  };
  for (const field of OPTIONAL_COPY_FIELDS) {
    if (!(field in row) && field in source) row[field] = source[field];
  }
  const id = await insertRecipe(row);
  return jsonResponse(200, { id, status: "saved" });
}

async function viewShared(token: string) {
  const source = await findSharedRecipe(token);
  const recipe: Record<string, unknown> = {};
  for (const field of PUBLIC_FIELDS) recipe[field] = source[field] ?? null;
  const [photoUrl, sharedBy] = await Promise.all([photoLink(source.image_url), findSharerName(String(source.user_id))]);
  return jsonResponse(200, { recipe, photoUrl, sharedBy });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed.", code: "method_not_allowed" });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new ShareError(503, "unavailable", "Shared recipes aren't configured on the server.");
    }
    const raw = await request.text();
    if (raw.length > 2000) throw new ShareError(400, "invalid_request", "Request too large.");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || "{}");
    } catch (_error) {
      throw new ShareError(400, "invalid_request", "Request body must be JSON.");
    }
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) throw new ShareError(404, "not_found", "This recipe isn't shared any more.");
    return body?.action === "save" ? await saveCopy(request, token) : await viewShared(token);
  } catch (error) {
    if (error instanceof ShareError) return jsonResponse(error.status, { error: error.message, code: error.code });
    console.error("shared-recipe: unexpected error", error);
    return jsonResponse(500, { error: "Something went wrong.", code: "server_error" });
  }
});
