import { isNativeApp } from "./native/platform";

export function registerClientWorker(): void {
  if (isNativeApp() || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
    return;
  }

  const pageBase = import.meta.env.BASE_URL;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${pageBase}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        const askUpdate = () => {
          void registration.update();
        };
        askUpdate();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") askUpdate();
        });
        window.addEventListener("pageshow", (event) => {
          if (event.persisted) askUpdate();
        });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
          });
        });
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      });
  });
}
