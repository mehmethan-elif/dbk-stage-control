import { isNativeApp } from "./native/platform";

const BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";
const RELOAD_TARGET_KEY = "dbk-build-reload-target";
const RELOAD_ATTEMPTS_KEY = "dbk-build-reload-attempts";
const RELOADING_KEY = "dbk-build-reloading";
const MAX_RELOADS = 3;

export type PublishedVersion = {
  build?: string;
  shell?: string[];
};

export function remoteBuildNeedsReload(local: string, remote?: string): boolean {
  return Boolean(remote && remote !== local);
}

/** Wait if the stamp moved but the hashed files are not on the CDN yet. */
export function publishedBuildAction(
  local: string,
  remote?: PublishedVersion,
  shellOk = true
): "current" | "wait" | "take" {
  if (!remote?.build || remote.build === local) return "current";
  if ((remote.shell?.length ?? 0) > 0 && !shellOk) return "wait";
  return "take";
}

export function nextBuildReloadAttempt(
  remote: string,
  previousTarget: string | null,
  previousAttempts: number,
  maxAttempts = MAX_RELOADS
): number | null {
  const attempts = previousTarget === remote ? previousAttempts : 0;
  if (attempts >= maxAttempts) return null;
  return attempts + 1;
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

function readAttempts(): { target: string | null; attempts: number } {
  try {
    return {
      target: sessionStorage.getItem(RELOAD_TARGET_KEY),
      attempts: Number(sessionStorage.getItem(RELOAD_ATTEMPTS_KEY) || 0)
    };
  } catch {
    return { target: null, attempts: 0 };
  }
}

function writeAttempts(target: string | null, attempts: number): void {
  try {
    if (!target) {
      sessionStorage.removeItem(RELOAD_TARGET_KEY);
      sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
      sessionStorage.removeItem(RELOADING_KEY);
      return;
    }
    sessionStorage.setItem(RELOAD_TARGET_KEY, target);
    sessionStorage.setItem(RELOAD_ATTEMPTS_KEY, String(attempts));
  } catch {
    // private mode
  }
}

async function fetchNoCache(url: string): Promise<Response> {
  return fetch(url, { cache: "reload" });
}

async function publishedVersion(pageBase: string): Promise<PublishedVersion | undefined> {
  const response = await fetchNoCache(`${pageBase}version.json?t=${Date.now()}`);
  if (!response.ok) return undefined;
  const remote = (await response.json()) as PublishedVersion;
  if (typeof remote.build !== "string" || !remote.build) return undefined;
  return remote;
}

async function publishedShellReady(pageBase: string, shell?: string[]): Promise<boolean> {
  const probes = (shell ?? []).filter((file) => file.includes("assets/")).slice(0, 4);
  if (probes.length === 0) return true;
  const results = await Promise.all(
    probes.map((file) => {
      const href = new URL(file.replace(/^\.\//, ""), pageBase).href;
      return fetchNoCache(`${href}${href.includes("?") ? "&" : "?"}t=${Date.now()}`)
        .then((response) => response.ok)
        .catch(() => false);
    })
  );
  return results.every(Boolean);
}

async function takePublishedBuild(pageBase: string): Promise<boolean> {
  const remote = await publishedVersion(pageBase);
  const shellOk = await publishedShellReady(pageBase, remote?.shell);
  const action = publishedBuildAction(BUILD, remote, shellOk);
  if (action === "current") {
    writeAttempts(null, 0);
    return false;
  }
  if (action === "wait" || !remote?.build) return false;

  const stored = readAttempts();
  const attempt = nextBuildReloadAttempt(remote.build, stored.target, stored.attempts);
  if (attempt == null) return false;

  writeAttempts(remote.build, attempt);
  try {
    sessionStorage.setItem(RELOADING_KEY, "1");
  } catch {
    // private mode
  }
  await wipeClientCaches();
  const next = new URL(window.location.href);
  next.searchParams.set("v", remote.build);
  next.searchParams.set("r", String(attempt));
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
    if (url.searchParams.has("v") || url.searchParams.has("r")) {
      url.searchParams.delete("v");
      url.searchParams.delete("r");
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

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      try {
        if (sessionStorage.getItem(RELOADING_KEY) === "1") return;
        sessionStorage.setItem(RELOADING_KEY, "1");
      } catch {
        // private mode
      }
      window.location.reload();
    });
  }

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
    if (document.visibilityState !== "visible") return;
    writeAttempts(null, 0);
    void askUpdate();
  });
  window.addEventListener("pageshow", () => {
    void askUpdate();
  });
  window.setInterval(() => {
    void askUpdate();
  }, 10_000);
}
