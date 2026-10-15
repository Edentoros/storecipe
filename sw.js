// Storecipe service worker: lets the app open without a connection.
//
// - Pages, scripts, styles and fonts: network first, so you always get the
//   latest version when online; the last copy is used only when offline.
// - Recipe photos: kept once seen. Each upload has its own never-changing name,
//   so a kept copy is never out of date. Cleared on sign-out by the page.
// - Everything else (sign-in, the recipe database, the import service) goes
//   straight to the network and is never stored here.
const SHELL_CACHE = "storecipe-shell-v1";
const PHOTO_CACHE = "storecipe-photos-v1";
const MAX_PHOTOS = 200;
const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add("./"))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, PHOTO_CACHE];
      for (const key of await caches.keys()) {
        if (key.startsWith("storecipe-") && !keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

function isShellUrl(href) {
  let url;
  try {
    url = new URL(href, self.location.href);
  } catch (_error) {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname);
}

// The page sends the files it loaded before this worker took over, so the app
// works offline from the very first visit.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "cache-urls" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(SHELL_CACHE).then((cache) =>
        Promise.all(
          data.urls.filter(isShellUrl).map((url) => {
            // cache.add() refuses the opaque responses other sites' scripts and
            // styles come back as, so fetch and store them directly.
            // All of these hosts allow CORS, and a CORS copy can answer both
            // CORS requests (fonts, the integrity-checked library) and plain ones.
            return fetch(new Request(url, { mode: "cors" }))
              .then((response) => (response.ok || response.type === "opaque" ? cache.put(url, response) : null))
              .catch(() => {});
          })
        )
      )
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.includes("/storage/v1/object/")) {
    event.respondWith(photoFromCacheFirst(request, url));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, pageKey(url)));
    return;
  }
  if (isShellUrl(request.url)) {
    event.respondWith(networkFirst(request, request));
  }
});

// Pages are stored without their query (?recipe=…), so any recipe link opens
// the app offline.
function pageKey(url) {
  return url.origin + url.pathname;
}

async function networkFirst(request, key) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      cache.put(key, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(key)) || (request.mode === "navigate" ? await cache.match("./") : null);
    if (cached) return cached;
    throw error;
  }
}

async function photoFromCacheFirst(request, url) {
  // Signed photo links carry a changing token; the photo itself is the path.
  const key = url.origin + url.pathname;
  const cache = await caches.open(PHOTO_CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone()).catch(() => {});
    trimPhotos(cache);
  }
  return response;
}

async function trimPhotos(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PHOTOS; i++) await cache.delete(keys[i]);
}
