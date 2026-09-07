const BUILD = "dev";
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
    url.pathname.includes("/sync")
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
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
  if (isDocumentRequest(event.request, url)) {
    event.respondWith(fetch(event.request, { cache: "reload" }));
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
