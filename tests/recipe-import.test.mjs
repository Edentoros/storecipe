// Runs supabase/functions/recipe-import/index.ts under Node with a fake Deno
// runtime, fake Supabase and a fake OpenAI, for the text and photo imports.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";

const SUPA = "https://proj.supabase.co";
const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon-key", OPENAI_API_KEY: "sk-test", FREE_IMPORT_LIMIT: "5" };
class NotFound extends Error {}
let handler;
let imports, aiAnswer, aiRequests;

globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (h) => { handler = h; },
  errors: { NotFound },
  resolveDns: async () => { throw new NotFound("no dns in tests"); }
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
    return Response.json({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] });
  }
  throw new TypeError("unexpected fetch: " + url);
};

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
  assert.match(request.messages[0].content, /photo or screenshot/);
  const image = request.messages[1].content.find((part) => part.type === "image_url");
  assert.equal(image.image_url.url, PHOTO);
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
