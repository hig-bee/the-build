/* Keeps a copy of the app on the phone so it opens with no signal.
   Bump VERSION whenever the app files change. */

const VERSION = "the-build-v5";
const PAGE = "./index.html";
const ASSETS = ["./", PAGE, "./manifest.json", "./icon-180.png", "./icon-512.png"];
const NETWORK_WAIT = 2500;

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

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(respond(event.request));
});

async function respond(request) {
  const cache = await caches.open(VERSION);

  /* The app itself: try the network first, but only briefly. With signal you always
     get the current version; without it, or on a bad one, the saved copy takes over
     after a couple of seconds. Cache-first here meant updates could never land. */
  if (request.mode === "navigate") {
    const live = await raceTimeout(fetch(request), NETWORK_WAIT);
    if (live && live.status === 200) {
      cache.put(PAGE, live.clone());
      return live;
    }
    const saved = (await cache.match(request)) || (await cache.match(PAGE)) || (await cache.match("./"));
    return saved || live || Response.error();
  }

  /* Everything else is small and rarely changes: serve it instantly, refresh quietly. */
  const saved = await cache.match(request);
  if (saved) {
    refresh(cache, request);
    return saved;
  }

  const live = await fetch(request).catch(function () { return null; });
  if (live && live.status === 200 && live.type === "basic") {
    cache.put(request, live.clone());
  }
  return live || Response.error();
}

function raceTimeout(promise, ms) {
  return Promise.race([
    promise.catch(function () { return null; }),
    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); })
  ]);
}

function refresh(cache, request) {
  fetch(request).then(function (response) {
    if (response && response.status === 200 && response.type === "basic") {
      cache.put(request, response.clone());
    }
  }).catch(function () {});
}
