// Runs supabase/functions/shared-recipe/index.ts under Node with a fake Deno
// runtime and a fake Supabase (database, storage, auth).
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";

const SUPA = "https://proj.supabase.co";
const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
let handler;
let recipes, profiles, copies, signed, calls;

globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const users = { "Bearer owner-token": "owner", "Bearer friend-token": "friend" };

// Minimal PostgREST: eq. filters, select of listed columns.
function filterRows(rows, params) {
  return rows.filter((row) => [...params].every(([key, value]) => {
    if (["select", "limit", "order"].includes(key)) return true;
    const want = value.replace(/^eq\./, "");
    return String(row[key]) === want;
  }));
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || "GET";
  const headers = new Headers(init.headers || {});
  calls.push({ path: url.pathname, method, auth: headers.get("authorization") });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (url.pathname === "/auth/v1/user") {
    const id = users[headers.get("authorization")];
    return id ? json({ id }) : json({}, 401);
  }
  // Every database and storage call must use the service key.
  assert.equal(headers.get("authorization"), "Bearer service-key", `service key for ${url.pathname}`);
  if (url.pathname === "/rest/v1/recipes" && method === "GET") return json(filterRows(recipes, url.searchParams).slice(0, 1));
  if (url.pathname === "/rest/v1/recipes" && method === "POST") {
    const row = { id: `copy-${recipes.length}`, ...JSON.parse(init.body) };
    recipes.push(row);
    return json([row], 201);
  }
  if (url.pathname === "/rest/v1/profiles") return json(filterRows(profiles, url.searchParams));
  if (url.pathname.startsWith("/storage/v1/object/sign/recipes/")) {
    signed.push(decodeURIComponent(url.pathname.slice("/storage/v1/object/sign/recipes/".length)));
    return json({ signedURL: `/object/sign/recipes/${url.pathname.split("/recipes/")[1]}?token=sig` });
  }
  if (url.pathname === "/storage/v1/object/copy") {
    copies.push(JSON.parse(init.body));
    return json({ Key: "ok" });
  }
  throw new TypeError("unexpected fetch: " + url);
};

await import(new URL("../supabase/functions/shared-recipe/index.ts", import.meta.url).href);
assert.ok(handler, "Deno.serve handler captured");

const call = async (body, token) => {
  const headers = { apikey: "anon-key", "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(new Request("https://fn/shared-recipe", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
};

beforeEach(() => {
  recipes = [
    {
      id: "r1", user_id: "owner", title: "Borscht", description: "Beetroot soup.", category: "soups",
      ingredients: "500 g beetroot\n1 onion", method: "Chop.\nSimmer.", notes: "Better the next day.",
      prep_time: "20 mins", cooking_time: "1 hour", total_time: "1 hour 20 mins", serves: 4, difficulty: 4,
      image_url: "owner/photo 1.jpg", source_url: null, is_public: true, share_token: TOKEN, is_favourite: true
    },
    { id: "r2", user_id: "owner", title: "Private stew", is_public: false, share_token: "zzzzzzzzzzzzzzzzzzzz", image_url: null }
  ];
  profiles = [{ id: "owner", email: "owner@example.com", display_name: "Dima" }];
  copies = [];
  signed = [];
  calls = [];
});

test("anyone with the link gets the recipe, the sharer's name and a photo link", async () => {
  const { status, data } = await call({ token: TOKEN });
  assert.equal(status, 200);
  assert.equal(data.recipe.title, "Borscht");
  assert.equal(data.recipe.serves, 4);
  assert.equal(data.sharedBy, "Dima");
  assert.equal(data.photoUrl, `${SUPA}/storage/v1/object/sign/recipes/owner/photo%201.jpg?token=sig`);
  assert.deepEqual(signed, ["owner/photo 1.jpg"]);
});

test("a shared recipe never reveals the owner, ids, favourites or the token", async () => {
  const { data } = await call({ token: TOKEN });
  const text = JSON.stringify(data);
  for (const secret of ["owner@example.com", "\"owner\"", "r1", TOKEN, "is_favourite", "image_url", "user_id"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
});

test("unshared recipes and made-up or malformed tokens look the same: not found", async () => {
  for (const token of ["zzzzzzzzzzzzzzzzzzzz", "b".repeat(32), "short", "a'; drop table recipes;--xxxxxxxx", ""]) {
    const { status, data } = await call({ token });
    assert.equal(status, 404, token);
    assert.equal(data.code, "not_found");
  }
});

test("saving needs a signed-in user", async () => {
  const { status, data } = await call({ action: "save", token: TOKEN });
  assert.equal(status, 401);
  assert.equal(data.code, "unauthenticated");
  assert.equal(recipes.length, 2);
});

test("saving copies the recipe and its photo into the saver's account", async () => {
  const { status, data } = await call({ action: "save", token: TOKEN }, "friend-token");
  assert.equal(status, 200);
  assert.equal(data.status, "saved");
  const copy = recipes.find((r) => r.id === data.id);
  assert.equal(copy.user_id, "friend");
  assert.equal(copy.title, "Borscht");
  assert.equal(copy.serves, 4);
  assert.equal(copy.copied_from_recipe_id, "r1");
  assert.equal(copy.is_public, undefined, "the copy isn't shared");
  assert.equal(copy.is_favourite, undefined, "the owner's favourite isn't copied");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].sourceKey, "owner/photo 1.jpg");
  assert.match(copies[0].destinationKey, /^friend\/shared-[0-9a-f-]+\.jpg$/);
  assert.equal(copy.image_url, copies[0].destinationKey);
});

test("saving the same recipe twice returns the existing copy", async () => {
  const first = await call({ action: "save", token: TOKEN }, "friend-token");
  const second = await call({ action: "save", token: TOKEN }, "friend-token");
  assert.equal(second.data.status, "already_saved");
  assert.equal(second.data.id, first.data.id);
  assert.equal(recipes.length, 3);
});

test("the owner saving their own shared recipe just gets it back", async () => {
  const { data } = await call({ action: "save", token: TOKEN }, "owner-token");
  assert.deepEqual({ ...data }, { id: "r1", status: "yours" });
  assert.equal(recipes.length, 2);
});

test("a recipe that stops being shared can't be saved", async () => {
  recipes[0].is_public = false;
  const { status } = await call({ action: "save", token: TOKEN }, "friend-token");
  assert.equal(status, 404);
});
