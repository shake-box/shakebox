/* Shakebox service worker — cache-first, versioned. Bump CACHE on any release. */
var CACHE = "shakebox-v4";

var ASSETS = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "seed-toys.js",
  "manifest.json",
  "fonts/unbounded.woff2",
  "fonts/schibsted-grotesk.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-192-maskable.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k); // drop old caches
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Runtime-cache same-origin GETs so the app stays whole offline.
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // Offline and not cached: fall back to the app shell for navigations.
        if (req.mode === "navigate") return caches.match("index.html");
      });
    })
  );
});
