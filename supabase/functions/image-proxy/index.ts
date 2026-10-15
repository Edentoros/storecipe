// image-proxy: downloads a recipe photo from another website for the app to
// store (browsers can't fetch most sites' images directly because of CORS).
//
// Because it fetches addresses users give it, it is locked down:
// - signed-in users only (a real session, not just the app's public key);
// - public http(s) addresses only: private/internal networks and cloud
//   metadata addresses are refused, and every redirect is checked again;
// - images only, at most 10 MB (refused as soon as it's over, not after
//   downloading everything), 10 seconds per photo;
// - at most PHOTO_FETCHES_PER_HOUR per person (needs sql/abuse-protection.sql).
import { blockedUrlReason, isIpLiteral, isPrivateAddress, parseHttpUrl } from "../recipe-import/lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const PHOTO_FETCHES_PER_HOUR = Math.max(1, Number(Deno.env.get("PHOTO_FETCHES_PER_HOUR") ?? 30) || 30);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

class ProxyError extends Error {
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
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

type Caller = { id: string; authHeader: string; apiKey: string };

async function getCaller(request: Request): Promise<Caller> {
  const authHeader = request.headers.get("Authorization") || "";
  const apiKey = request.headers.get("apikey") || SUPABASE_ANON_KEY;
  if (!/^Bearer\s+\S+/i.test(authHeader) || !SUPABASE_URL || !apiKey) {
    throw new ProxyError(401, "unauthenticated", "Please sign in.");
  }
  // The app's public key is also a valid token at the gateway, so check there's
  // an actual signed-in user behind this one.
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: authHeader } });
  const user = response.ok ? await response.json().catch(() => null) : null;
  if (!user?.id) throw new ProxyError(401, "unauthenticated", "Please sign in.");
  return { id: String(user.id), authHeader, apiKey };
}

// Uses the caller's own token, so row-level security limits this to their rows.
async function assertUnderHourlyLimit(caller: Caller) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/image_proxy_uses?select=id&user_id=eq.${encodeURIComponent(caller.id)}&created_at=gt.${encodeURIComponent(since)}`,
    { method: "HEAD", headers: { apikey: caller.apiKey, Authorization: caller.authHeader, Prefer: "count=exact" } }
  );
  const used = Number((response.headers.get("content-range") || "").split("/")[1]);
  if (!response.ok || !Number.isFinite(used)) {
    // Table not created yet (sql/abuse-protection.sql): keep working, but say so in the logs.
    console.error("image-proxy: usage limit unavailable", response.status);
    return;
  }
  if (used >= PHOTO_FETCHES_PER_HOUR) {
    throw new ProxyError(429, "rate_limited", "Too many photo downloads. Please try again in a while.");
  }
}

async function recordUse(caller: Caller) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/image_proxy_uses`, {
      method: "POST",
      headers: {
        apikey: caller.apiKey,
        Authorization: caller.authHeader,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{ user_id: caller.id }])
    });
  } catch (error) {
    console.error("image-proxy: failed to record use", error);
  }
}

async function assertPublicDestination(url: URL) {
  const reason = blockedUrlReason(url);
  if (reason) throw new ProxyError(400, "url_blocked", reason);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host) || typeof Deno.resolveDns !== "function") return;
  const lookups = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  const addresses = lookups.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new ProxyError(400, "url_blocked", "That link points to a private network address.");
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ProxyError(413, "too_large", "Image too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchImage(startUrl: URL): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = startUrl;
    let sendReferer = true;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicDestination(current);
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      };
      // Some hosts only serve images to their own pages; others block any Referer.
      if (sendReferer) headers.Referer = `${current.protocol}//${current.host}/`;
      const response = await fetch(current, { headers, redirect: "manual", signal: controller.signal });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new ProxyError(502, "fetch_failed", "The image link redirected nowhere.");
        current = new URL(location, current);
        continue;
      }
      if ((response.status === 401 || response.status === 403) && sendReferer) {
        await response.body?.cancel().catch(() => {});
        sendReferer = false;
        hop--; // same address again without the Referer, not a redirect
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ProxyError(response.status === 404 ? 404 : 502, "fetch_failed", `Upstream status ${response.status}`);
      }
      const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        await response.body?.cancel().catch(() => {});
        throw new ProxyError(415, "not_image", `Unsupported content-type: ${contentType || "unknown"}`);
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new ProxyError(413, "too_large", "Image too large.");
      }
      return { bytes: await readCapped(response, MAX_BYTES), contentType };
    }
    throw new ProxyError(502, "fetch_failed", "The image link redirected too many times.");
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    if (controller.signal.aborted) throw new ProxyError(504, "timeout", "The image took too long to download.");
    throw new ProxyError(502, "fetch_failed", "Couldn't download that image.");
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const caller = await getCaller(request);

    const rawBody = await request.text();
    if (rawBody.length > 5_000) throw new ProxyError(400, "invalid_request", "Request too large.");
    let body: { url?: unknown };
    try {
      body = JSON.parse(rawBody || "{}");
    } catch (_error) {
      throw new ProxyError(400, "invalid_request", "Invalid JSON body");
    }
    const target = parseHttpUrl(body?.url);
    if (!target) throw new ProxyError(400, "invalid_url", "Missing or invalid url");
    // Obviously blocked addresses are refused before anything is counted or fetched.
    const blocked = blockedUrlReason(target);
    if (blocked) throw new ProxyError(400, "url_blocked", blocked);

    await assertUnderHourlyLimit(caller);
    // Counted before fetching, so failed or slow downloads count too.
    await recordUse(caller);

    const { bytes, contentType } = await fetchImage(target);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof ProxyError) return jsonResponse(error.status, { error: error.message, code: error.code });
    console.error("image-proxy: unexpected error", error);
    return jsonResponse(500, { error: "Something went wrong downloading that image.", code: "server_error" });
  }
});
