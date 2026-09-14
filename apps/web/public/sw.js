const BUILD = "dev";
const SHELL = [];
const CACHE = `dbk-client-shell-${BUILD}`;
const SCOPE = self.registration.scope;

function scoped(path) {
  return new URL(path, SCOPE).href;
}

function isDocumentRequest(request, url) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  const path = url.pathname;
  return path.endsWith(".html") || path.endsWith("/client") || path.endsWith("/client/");
}

function isLivePath(url) {
  return (
    url.pathname.includes("/library") ||
    url.pathname.includes("/practice") ||
    url.pathname.includes("/client-library") ||
    url.pathname.includes("/version.json") ||
    url.pathname.includes("/sync")
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Take the page and everything it needs to start, so this opens somewhere with no signal the
  // first time rather than only after two visits. One at a time and forgiving of failures: a
  // single file that will not come down should not leave the cache with nothing in it.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        ["./index.html", ...SHELL].map((file) =>
          cache.add(new Request(scoped(file), { cache: "reload" })).catch(() => undefined)
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin || isLivePath(url)) return;
  // The page is still taken from the network every time, so a new build lands the moment it is
  // published. What is new is that the copy is kept: without it the app had nothing to open when
  // the network was gone, which is every venue with no signal. Held under the one name because
  // every route is served the same shell, and because a navigation cannot be a cache key.
  if (isDocumentRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(scoped("./index.html"), copy));
          }
          return response;
        })
        .catch(() => caches.match(scoped("./index.html")).then((cached) => cached || Response.error()))
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(scoped("./index.html"))))
  );
});
