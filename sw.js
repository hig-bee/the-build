/* Keeps a copy of the app on the phone so it opens with no signal.
   Bump VERSION whenever the app files change. */

const VERSION = "the-build-v2";
const PAGE = "./index.html";
const ASSETS = ["./", PAGE, "./manifest.json", "./icon-180.png", "./icon-512.png"];

/* Each file is saved on its own. One missing file (a bad upload, say) must not
   throw away the whole offline copy the way cache.addAll would. */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === VERSION ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Serve from the saved copy immediately, then refresh it quietly in the background.
   The app opens instantly at 5:15 AM; any update lands on the next open. */
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(respond(event.request));
});

async function respond(request) {
  const cache = await caches.open(VERSION);

  const fresh = fetch(request).then(function (response) {
    if (response && response.status === 200 && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(function () { return null; });

  const cached = await cache.match(request);
  if (cached) return cached;

  const network = await fresh;
  if (network) return network;

  /* Offline, and this exact address was never saved: any page request still
     gets the app rather than an error screen. */
  if (request.mode === "navigate") {
    const fallback = (await cache.match(PAGE)) || (await cache.match("./"));
    if (fallback) return fallback;
  }

  return Response.error();
}
