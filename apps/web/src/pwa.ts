import { isNativeApp } from "./native/platform";

const BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";
const RELOAD_KEY = "dbk-build-reload";

export function remoteBuildNeedsReload(local: string, remote?: string): boolean {
  return Boolean(remote && remote !== local);
}

export async function wipeClientCaches(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

async function publishedBuild(pageBase: string): Promise<string | undefined> {
  const response = await fetch(`${pageBase}version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return undefined;
  const remote = (await response.json()) as { build?: string };
  return typeof remote.build === "string" ? remote.build : undefined;
}

async function takePublishedBuild(pageBase: string): Promise<boolean> {
  const remote = await publishedBuild(pageBase);
  if (!remoteBuildNeedsReload(BUILD, remote) || !remote) return false;
  if (sessionStorage.getItem(RELOAD_KEY) === remote) return false;
  sessionStorage.setItem(RELOAD_KEY, remote);
  await wipeClientCaches();
  const next = new URL(window.location.href);
  next.searchParams.set("v", remote);
  window.location.replace(next.href);
  return true;
}

/** Drop the last cached Practice page and take the published build before React starts. */
export async function ensureLatestClientBuild(): Promise<void> {
  if (isNativeApp() || import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  try {
    const reloading = await takePublishedBuild(import.meta.env.BASE_URL);
    if (reloading) await new Promise<void>(() => undefined);
    const url = new URL(window.location.href);
    if (url.searchParams.has("v")) {
      url.searchParams.delete("v");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // offline: keep the last cached build
  }
}

export function registerClientWorker(): void {
  if (isNativeApp() || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
    return;
  }

  const pageBase = import.meta.env.BASE_URL;

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
    try {
      await takePublishedBuild(pageBase);
    } catch {
      // keep the last cached build
    }
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
