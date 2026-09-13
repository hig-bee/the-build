/* Keeps a copy of the app on the phone so it opens with no signal.
   Bump VERSION whenever the app files change. */

const VERSION = "the-build-v26";
const PAGE = "./index.html";

/* The page boots without rooms.js, but with no rooms table there is no Home, no
   Notes and no triage — half the app. A saved copy missing it would still call
   itself a complete offline copy, and the phone would only find out in a
   driveway with no signal, so these two stand or fall together. */
const CRITICAL = [PAGE, "./rooms.js"];

/* The icons, the manifest and the directory alias are decoration: without any of
   them the tracker still opens and still logs. Each is saved on its own and its
   failure swallowed, so one bad upload does not throw away the whole copy the
   way cache.addAll would. */
const OPTIONAL = ["./", "./manifest.json", "./icon-180.png", "./icon-512.png"];

const NETWORK_WAIT = 2500;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return Promise.all(CRITICAL.map(function (url) {
        return cache.add(url);
      })).then(function () {
        return Promise.all(OPTIONAL.map(function (url) {
          return cache.add(url).catch(function () { return null; });
        }));
      });
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
