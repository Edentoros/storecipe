// Runs supabase/functions/image-proxy/index.ts under Node with a fake Deno
// runtime, fake Supabase and fake websites.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";

const SUPA = "https://proj.supabase.co";
const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon-key", PHOTO_FETCHES_PER_HOUR: "3" };
class NotFound extends Error {}
let handler;
let dns, sites, uses, calls, tableMissing;

globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (h) => { handler = h; },
  errors: { NotFound },
  resolveDns: async (host, type) => {
    if (type === "AAAA") throw new NotFound("no AAAA");
    if (!dns[host]) throw new NotFound("NXDOMAIN");
    return dns[host];
  }
};

const users = { "Bearer user-token": "user-1" };
const jpeg = (n) => new Uint8Array(n).fill(7);

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  const headers = new Headers(init.headers || {});
  calls.push({ url, method, referer: headers.get("referer") });

  if (url === `${SUPA}/auth/v1/user`) {
    const id = users[headers.get("authorization")];
    return id ? Response.json({ id }) : new Response("{}", { status: 401 });
  }
  if (url.startsWith(`${SUPA}/rest/v1/image_proxy_uses`)) {
    if (tableMissing) return new Response(JSON.stringify({ message: "relation does not exist" }), { status: 404 });
    const uid = users[headers.get("authorization")];
    if (method === "HEAD") {
      const n = uses.filter((u) => u.user_id === uid).length;
      return new Response(null, { status: 200, headers: { "content-range": `*/${n}` } });
    }
    if (method === "POST") { uses.push(...JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  }
  const site = sites[url];
  if (!site) throw new TypeError("network error: " + url);
  if (typeof site === "function") return site(headers);
  return new Response(site.body ?? null, { status: site.status ?? 200, headers: site.headers ?? {} });
};

await import(new URL("../supabase/functions/image-proxy/index.ts", import.meta.url).href);
assert.ok(handler, "Deno.serve handler captured");

const call = async (url, token = "user-token") => {
  const headers = { apikey: "anon-key", "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(new Request("https://fn/image-proxy", { method: "POST", headers, body: JSON.stringify({ url }) }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, type, data: type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
};
const siteCalls = () => calls.filter((c) => !c.url.startsWith(SUPA));

beforeEach(() => {
  dns = { "img.example": ["93.184.216.34"], "cdn.example": ["93.184.216.35"], "sneaky.example": ["169.254.169.254"], "big.example": ["93.184.216.36"] };
  sites = {
    "https://img.example/a.jpg": { body: jpeg(2048), headers: { "content-type": "image/jpeg" } },
    "https://img.example/page.html": { body: "<html>", headers: { "content-type": "text/html" } },
    "https://img.example/to-private": { status: 302, headers: { location: "http://10.0.0.5/secret.jpg" } },
    "https://img.example/to-cdn": { status: 301, headers: { location: "https://cdn.example/b.png" } },
    "https://cdn.example/b.png": { body: jpeg(100), headers: { "content-type": "image/png" } },
    "https://big.example/huge.jpg": { body: jpeg(11 * 1024 * 1024), headers: { "content-type": "image/jpeg" } },
    "https://big.example/lies.jpg": { body: jpeg(11 * 1024 * 1024), headers: { "content-type": "image/jpeg", "content-length": "500" } },
    "https://img.example/hotlink.jpg": (headers) =>
      headers.get("referer") ? new Response("no", { status: 403 }) : new Response(jpeg(10), { headers: { "content-type": "image/jpeg" } }),
    "https://img.example/logo.svg": { body: "<svg/>", headers: { "content-type": "image/svg+xml" } }
  };
  uses = [];
  calls = [];
  tableMissing = false;
});

test("signed-in user gets the image", async () => {
  const r = await call("https://img.example/a.jpg");
  assert.equal(r.status, 200);
  assert.equal(r.type, "image/jpeg");
  assert.equal(r.data.byteLength, 2048);
  assert.equal(uses.length, 1);
});

test("refuses without a signed-in user, and fetches nothing", async () => {
  for (const token of [null, "anon-key", "forged"]) {
    const r = await call("https://img.example/a.jpg", token);
    assert.equal(r.status, 401, `token ${token}`);
  }
  assert.equal(siteCalls().length, 0);
});

test("refuses private, internal and metadata addresses", async () => {
  for (const url of ["http://127.0.0.1/x.jpg", "http://10.1.2.3/x.jpg", "http://169.254.169.254/latest/meta-data", "http://localhost/x.jpg", "https://sneaky.example/x.jpg", "http://[::1]/x.jpg"]) {
    const r = await call(url);
    assert.equal(r.status, 400, url);
    assert.equal(r.data.code, "url_blocked", url);
  }
  assert.equal(siteCalls().length, 0);
});

test("checks every redirect: a public link redirecting to a private address is refused", async () => {
  const r = await call("https://img.example/to-private");
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "url_blocked");
  assert.ok(!calls.some((c) => c.url.includes("10.0.0.5")), "never requested the private address");
});

test("follows a normal redirect", async () => {
  const r = await call("https://img.example/to-cdn");
  assert.equal(r.status, 200);
  assert.equal(r.type, "image/png");
});

test("only images (no web pages, no SVG)", async () => {
  assert.equal((await call("https://img.example/page.html")).status, 415);
  assert.equal((await call("https://img.example/logo.svg")).status, 415);
});

test("stops at 10 MB, even when the site claims a small size", async () => {
  assert.equal((await call("https://big.example/huge.jpg")).status, 413);
  assert.equal((await call("https://big.example/lies.jpg")).status, 413);
});

test("retries once without Referer for hotlink-protected images", async () => {
  const r = await call("https://img.example/hotlink.jpg");
  assert.equal(r.status, 200);
  const hits = calls.filter((c) => c.url === "https://img.example/hotlink.jpg");
  assert.equal(hits.length, 2);
  assert.ok(hits[0].referer && !hits[1].referer);
});

test("hourly limit per person (3 in this test), counted even when the download fails", async () => {
  assert.equal((await call("https://img.example/page.html")).status, 415);
  assert.equal((await call("https://img.example/a.jpg")).status, 200);
  assert.equal((await call("https://img.example/a.jpg")).status, 200);
  const r = await call("https://img.example/a.jpg");
  assert.equal(r.status, 429);
  assert.equal(r.data.code, "rate_limited");
  assert.equal(siteCalls().length, 3, "the 4th wasn't fetched");
});

test("before the SQL is run, still works (limit just isn't enforced)", async () => {
  tableMissing = true;
  assert.equal((await call("https://img.example/a.jpg")).status, 200);
});

test("bad requests", async () => {
  assert.equal((await call("not a url")).status, 400);
  assert.equal((await call("ftp://img.example/a.jpg")).status, 400);
  const res = await handler(new Request("https://fn/image-proxy", { method: "GET" }));
  assert.equal(res.status, 405);
});
