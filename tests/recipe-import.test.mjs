// Runs supabase/functions/recipe-import/index.ts under Node with a fake Deno
// runtime, fake Supabase and a fake OpenAI, for the text and photo imports.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";

const SUPA = "https://proj.supabase.co";
const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon-key", OPENAI_API_KEY: "sk-test", FREE_IMPORT_LIMIT: "5" };
class NotFound extends Error {}
let handler;
let imports, aiAnswer, aiRequests, aiError, blog;

globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (h) => { handler = h; },
  errors: { NotFound },
  // The test blog has a public address; everything else isn't found.
  resolveDns: async (host, type) => {
    if (host === "blog.example.com") return type === "A" ? ["93.184.216.34"] : [];
    throw new NotFound("no dns in tests");
  }
};

const users = { "Bearer user-token": "user-1" };
const recipeAnswer = (overrides = {}) => ({
  is_recipe: true,
  rejection_reason: "",
  title: "Жареная картошка",
  description: "Картошка с луком.",
  category: "dinner",
  ingredients: ["1 кг картофеля", "2 крупные луковицы", "2 стебля петрушки"],
  method: ["Отварите картофель в подсоленной воде.", "Обжарьте с луком.", "Подавайте с петрушкой."],
  notes: ["Отлично к ужину."],
  prep_hours: null, prep_minutes: 10, cook_hours: null, cook_minutes: 30,
  serves: 2, difficulty: 3,
  image_url: "https://made-up.example/photo.jpg",
  ...overrides
});

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  const headers = new Headers(init.headers || {});
  if (url === `${SUPA}/auth/v1/user`) {
    const id = users[headers.get("authorization")];
    return id ? Response.json({ id }) : new Response("{}", { status: 401 });
  }
  if (url.startsWith(`${SUPA}/rest/v1/recipe_imports`)) {
    if (method === "HEAD") {
      // Like PostgREST: only rows matching created_at=gte.<time> count.
      const since = new URL(url).searchParams.get("created_at")?.replace(/^gte\./, "");
      const counted = imports.filter((row) => !since || new Date(row.created_at ?? Date.now()) >= new Date(since));
      return new Response(null, { status: 200, headers: { "content-range": `*/${counted.length}` } });
    }
    if (method === "POST") { imports.push(...JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  }
  if (url === `${SUPA}/rest/v1/rpc/recipe_imports_last_24h`) return Response.json(0);
  if (url === "https://api.openai.com/v1/chat/completions") {
    aiRequests.push(JSON.parse(init.body));
    if (aiError) return Response.json({ error: aiError.error }, { status: aiError.status });
    return Response.json({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] });
  }
  if (url.startsWith("https://blog.example.com/")) {
    blog.requests.push(url);
    const answer = blog.pages[url];
    if (answer) return new Response(answer.body, { status: answer.status ?? 200, headers: answer.headers });
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  }
  throw new TypeError("unexpected fetch: " + url);
};

// A WordPress blog behind Cloudflare's bot check: the page answers with the
// check, the post's own feed carries the post with its recipe card.
const POST = "https://blog.example.com/feta-tomato-pasta-with-salmon/";
const BOT_CHECK = { status: 403, body: "<html>Just a moment...</html>", headers: { "content-type": "text/html", "cf-mitigated": "challenge" } };
const rss = (items) => ({
  headers: { "content-type": "application/rss+xml; charset=UTF-8" },
  body: `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Blog</title>${items}</channel></rss>`
});
const item = (link, title, html) =>
  `<item><title>${title}</title><link>${link}</link><content:encoded><![CDATA[${html}]]></content:encoded></item>`;
const CARD = `<p>Weeknight pasta.</p><img src="https://blog.example.com/wp-content/plugins/wprm/stars-5.svg" width="80"><img width="1200" src="https://blog.example.com/uploads/feta-pasta.jpg">
  <div class="wprm-recipe"><h3>Ingredients</h3><ul><li>2 lbs salmon filets</li><li>8 ounce feta block</li></ul>
  <h3>Instructions</h3><ul><li>Bake the salmon and feta for 25 minutes.</li><li>Toss with the pasta.</li></ul></div>`;

await import(new URL("../supabase/functions/recipe-import/index.ts", import.meta.url).href);
assert.ok(handler, "Deno.serve handler captured");

const call = async (body) => {
  const res = await handler(new Request("https://fn/recipe-import", {
    method: "POST",
    headers: { apikey: "anon-key", Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
  return { status: res.status, data: await res.json() };
};

const TYPED = "Почисти картошку и свари. 1kg of potatoes, 2 big onions, 2 стручка петрушки. Пожарь с луком.";
const PHOTO = "data:image/jpeg;base64," + "A".repeat(400);

beforeEach(() => {
  imports = [];
  aiRequests = [];
  aiAnswer = recipeAnswer();
  aiError = null;
  blog = { pages: {}, requests: [] };
});

test("uses a current OpenAI model, without the temperature gpt-5 models refuse", async () => {
  await call({ text: TYPED, language: "en" });
  assert.equal(aiRequests[0].model, "gpt-5.4-nano");
  assert.equal("temperature" in aiRequests[0], false);
  assert.equal(aiRequests[0].response_format.type, "json_schema");
});

test("a retired model or no OpenAI credit says AI isn't available, and costs no import", async () => {
  for (const err of [
    { status: 404, error: { message: "The model `x` has been deprecated", code: "model_not_found" } },
    { status: 429, error: { message: "You exceeded your current quota", code: "insufficient_quota" } }
  ]) {
    aiError = err;
    const { status, data } = await call({ text: TYPED, language: "en" });
    assert.equal(status, 503);
    assert.equal(data.code, "ai_unavailable");
  }
  assert.equal(imports.length, 0);
});

test("other OpenAI errors are worth retrying", async () => {
  aiError = { status: 500, error: { message: "server error" } };
  const { data } = await call({ text: TYPED, language: "en" });
  assert.equal(data.code, "ai_failed");
});

test("typed text is tidied by the AI and counted as an import", async () => {
  const { status, data } = await call({ text: TYPED, language: "ru" });
  assert.equal(status, 200);
  assert.deepEqual(data.recipe.ingredients, ["1 кг картофеля", "2 крупные луковицы", "2 стебля петрушки"]);
  assert.equal(data.recipe.serves, 2);
  assert.equal(data.remaining, 4);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].source_url, "text");
  assert.equal(imports[0].status, "ok");

  const request = aiRequests[0];
  assert.match(request.messages[0].content, /typed or pasted/);
  assert.match(request.messages[0].content, /in Russian/);
  assert.match(request.messages[1].content, /<recipe_text>\n.*1kg of potatoes/s);
});

test("a typed or photo recipe never gets a link or an AI-invented photo", async () => {
  const { data } = await call({ text: TYPED, language: "en" });
  assert.equal(data.recipe.image_url, null);
  assert.equal(data.recipe.source_url, "");
});

test("a photo is sent to the AI as an image", async () => {
  const { status, data } = await call({ image: PHOTO, language: "en" });
  assert.equal(status, 200);
  assert.equal(data.recipe.title, "Жареная картошка");
  assert.equal(imports[0].source_url, "photo");

  const request = aiRequests[0];
  assert.match(request.messages[0].content, /photos,\s+screenshots or PDF pages/);
  const image = request.messages[1].content.find((part) => part.type === "image_url");
  assert.equal(image.image_url.url, PHOTO);
});

const PDF = "data:application/pdf;base64," + "JVBERi0x".repeat(50);

test("several screenshots and a PDF go to the AI together, as one import", async () => {
  const second = "data:image/png;base64," + "B".repeat(400);
  const { status } = await call({ images: [PHOTO, second, PDF], language: "en" });
  assert.equal(status, 200);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].source_url, "photo");
  const parts = aiRequests[0].messages[1].content;
  assert.match(parts[0].text, /3 parts, in order/);
  assert.deepEqual(parts.slice(1).map((part) => part.type), ["image_url", "image_url", "file"]);
  assert.equal(parts[2].image_url.url, second);
  assert.equal(parts[3].file.file_data, PDF);
  assert.match(parts[3].file.filename, /\.pdf$/);
  assert.match(aiRequests[0].messages[0].content, /combine them into one recipe/);
});

test("a PDF on its own works too", async () => {
  const { status } = await call({ images: [PDF], language: "en" });
  assert.equal(status, 200);
  assert.equal(aiRequests[0].messages[1].content[1].type, "file");
});

test("more than 5 files, or files that are too big, are refused before the AI", async () => {
  let res = await call({ images: Array(6).fill(PHOTO), language: "en" });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, "too_many_files");
  res = await call({ images: ["data:application/pdf;base64," + "A".repeat(5_700_000)], language: "en" });
  assert.equal(res.data.code, "file_too_big");
  res = await call({ images: [PHOTO, "data:application/zip;base64,UEsDBA=="], language: "en" });
  assert.equal(res.data.code, "invalid_image");
  res = await call({ images: [], language: "en" });
  assert.equal(res.data.code, "invalid_image");
  assert.equal(aiRequests.length, 0);
  assert.equal(imports.length, 0);
});

test("text that isn't a recipe is rejected and still uses an import", async () => {
  aiAnswer = recipeAnswer({ is_recipe: false, rejection_reason: "shopping list", ingredients: [], method: [] });
  const { status, data } = await call({ text: "Buy milk, eggs and bread on the way home tonight", language: "en" });
  assert.equal(status, 422);
  assert.equal(data.code, "not_recipe");
  assert.equal(imports[0].status, "rejected");
});

test("too little text is refused before the AI is asked", async () => {
  const { status, data } = await call({ text: "eggs", language: "en" });
  assert.equal(status, 400);
  assert.equal(data.code, "invalid_text");
  assert.equal(aiRequests.length, 0);
  assert.equal(imports.length, 0);
});

test("anything but a JPEG, PNG or WebP data URL is refused", async () => {
  for (const image of ["https://example.com/a.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,<script>"]) {
    const { status, data } = await call({ image, language: "en" });
    assert.equal(status, 400, image);
    assert.equal(data.code, "invalid_image");
  }
  assert.equal(aiRequests.length, 0);
});

test("the free limit is per 24 hours: older imports don't count", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  imports = Array.from({ length: 5 }, () => ({ user_id: "user-1", created_at: twoDaysAgo }));
  const { status, data } = await call({ text: TYPED, language: "en" });
  assert.equal(status, 200);
  assert.equal(data.remaining, 4);
});

test("text and photo imports respect the free limit", async () => {
  imports = Array.from({ length: 5 }, () => ({ user_id: "user-1", created_at: new Date().toISOString() }));
  const { status, data } = await call({ text: TYPED, language: "en" });
  assert.equal(status, 402);
  assert.equal(data.code, "quota_exceeded");
  assert.equal(aiRequests.length, 0);
});

test("a page behind a bot check is imported from the site's WordPress feed", async () => {
  blog.pages[POST] = BOT_CHECK;
  blog.pages[`${POST}feed/?withoutcomments=1`] = rss(item(POST, "Feta Tomato Pasta with Salmon", CARD));
  const { status, data } = await call({ url: POST, language: "en" });
  assert.equal(status, 200);
  assert.equal(data.source, "ai");
  assert.equal(imports.length, 1);
  assert.equal(imports[0].source_url, POST);
  const message = aiRequests[0].messages[1].content;
  assert.match(message, /Feta Tomato Pasta with Salmon/);
  assert.match(message, /2 lbs salmon filets/);
  assert.match(message, /Bake the salmon and feta for 25 minutes/);
  // The post's photo, not the star-rating icon.
  assert.match(message, /uploads\/feta-pasta\.jpg/);
  assert.doesNotMatch(message, /stars-5\.svg/);
});

test("when the post's own feed doesn't have it, the search feed is tried", async () => {
  blog.pages[POST] = BOT_CHECK;
  blog.pages["https://blog.example.com/feed/?s=feta+tomato+pasta+with+salmon"] = rss(
    item("https://blog.example.com/other-pasta/", "Other pasta", "<p>Not this one</p>") +
      item(POST, "Feta Tomato Pasta with Salmon", CARD)
  );
  const { status } = await call({ url: POST, language: "en" });
  assert.equal(status, 200);
  assert.match(aiRequests[0].messages[1].content, /8 ounce feta block/);
  assert.doesNotMatch(aiRequests[0].messages[1].content, /Not this one/);
});

test("a blocked page with no usable feed still says the site blocks imports, and costs nothing", async () => {
  blog.pages[POST] = BOT_CHECK;
  blog.pages["https://blog.example.com/feed/?s=feta+tomato+pasta+with+salmon"] = rss(
    item("https://blog.example.com/other-pasta/", "Other pasta", "<p>Not this one</p>")
  );
  const { status, data } = await call({ url: POST, language: "en" });
  assert.equal(status, 502);
  assert.equal(data.code, "fetch_failed");
  assert.match(data.error, /blocks automatic imports/);
  assert.equal(aiRequests.length, 0);
  assert.equal(imports.length, 0);
});

test("a page that simply isn't there doesn't go looking in feeds", async () => {
  const { data } = await call({ url: POST, language: "en" });
  assert.match(data.error, /status 404/);
  assert.deepEqual(blog.requests, [POST]);
});
