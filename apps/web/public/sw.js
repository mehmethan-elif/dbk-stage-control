const CACHE = "dbk-client-shell-v2";
const SCOPE = self.registration.scope;

function scoped(path) {
  return new URL(path, SCOPE).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([scoped("./"), scoped("./client"), scoped("./index.html"), scoped("./manifest.webmanifest")])
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.includes("/library") || url.pathname.includes("/practice") || url.pathname.includes("/sync")) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(scoped("./index.html"))))
  );
});
