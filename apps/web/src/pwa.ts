import { isNativeApp } from "./native/platform";

const BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";

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
  const reload = () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    reload();
  });

  const registered = navigator.serviceWorker.register(`${pageBase}sw.js`, { updateViaCache: "none" });

  const takeWaiting = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  };

  const askUpdate = async () => {
    const registration = await registered.catch(() => undefined);
    if (registration) {
      await registration.update().catch(() => undefined);
      takeWaiting(registration);
    }
    await reloadIfRemoteBuildChanged(pageBase);
  };

  void registered.then((registration) => {
    takeWaiting(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
      });
    });
  });

  void askUpdate();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void askUpdate();
  });
  window.addEventListener("pageshow", () => {
    void askUpdate();
  });
}

async function reloadIfRemoteBuildChanged(pageBase: string): Promise<void> {
  try {
    const response = await fetch(`${pageBase}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const remote = (await response.json()) as { build?: string };
    if (!remote.build || remote.build === BUILD) return;
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update().catch(() => undefined);
    if (registration?.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
  } catch {
    // keep the last cached build until the next open
  }
}
