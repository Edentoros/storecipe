// Runs netlify/edge-functions/share-preview.ts under Node with a fake Netlify
// runtime and a fake shared-recipe function.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import fs from "node:fs";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub-key" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
let answer, calls;
globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), body: JSON.parse(init.body), apikey: new Headers(init.headers).get("apikey") });
  if (answer instanceof Error) throw answer;
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
};

const { default: handler, config } = await import(new URL("../netlify/edge-functions/share-preview.ts", import.meta.url).href);
const page = fs.readFileSync(new URL("../share.html", import.meta.url), "utf8");
const TOKEN = "c".repeat(32);
const run = async (url) => {
  const context = { next: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "content-length": String(page.length) } }) };
  const res = await handler(new Request(url), context);
  return { res, html: await res.text() };
};

beforeEach(() => {
  calls = [];
  answer = {
    status: 200,
    body: {
      recipe: { title: "Chilli con carne", description: 'Rich & smoky "proper" chilli <b>', ingredients: "500 g mince\n1 onion" },
      photoUrl: "https://proj.supabase.co/storage/v1/object/sign/recipes/u/p.jpg?token=abc",
      sharedBy: "Dima"
    }
  };
});

test("runs on the share page", () => {
  assert.ok([].concat(config.path).includes("/share.html"));
});

test("a shared recipe gets its own title, description and photo", async () => {
  const { res, html } = await run(`https://storecipe.netlify.app/share.html?token=${TOKEN}`);
  assert.equal(calls[0].body.token, TOKEN);
  assert.equal(calls[0].apikey, "pub-key");
  assert.match(html, /<title>Chilli con carne – Storecipe<\/title>/);
  assert.match(html, /<meta property="og:title" content="Chilli con carne" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\/recipes\/u\/p\.jpg\?token=abc" \/>/);
  assert.match(html, /<meta property="og:description" content="Rich &amp; smoky &quot;proper&quot; chilli &lt;b&gt;" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1, "one description");
  assert.ok(!html.includes("<!-- share-preview -->"));
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-length"), null);
});

test("without a description or photo: first ingredients and the app icon", async () => {
  answer.body = { recipe: { title: "Soup", ingredients: "1 onion\n2 carrots\n1 l stock" }, photoUrl: null };
  const { html } = await run(`https://storecipe.netlify.app/share.html?token=${TOKEN}`);
  assert.match(html, /og:description" content="1 onion, 2 carrots, 1 l stock"/);
  assert.match(html, /og:image" content="https:\/\/storecipe\.netlify\.app\/icons\/icon-512\.png"/);
});

test("links that aren't shared, bad tokens and errors leave the page as it is", async () => {
  answer = { status: 404, body: { code: "not_found" } };
  assert.equal((await run(`https://x.app/share.html?token=${TOKEN}`)).html, page);
  assert.equal((await run("https://x.app/share.html?token=<script>")).html, page);
  answer = new Error("network down");
  assert.equal((await run(`https://x.app/share.html?token=${TOKEN}`)).html, page);
});
