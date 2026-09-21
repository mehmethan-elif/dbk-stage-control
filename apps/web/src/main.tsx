import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { markHomeScreenRole } from "./native/home-icon";
import { ensureLatestClientBuild, registerClientWorker } from "./pwa";
import "./styles/stage.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

// Nothing was listening for these, so an async failure on stage left no trace at all: a chart
// simply stayed blank with nothing to look at afterwards. They are logged rather than shown —
// the crash guards own what the player sees.
window.addEventListener("error", (event) => {
  console.error("Uncaught error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection", event.reason);
});

const pageBase = import.meta.env.BASE_URL;
const routerBase =
  pageBase === "/" || pageBase === "./" ? undefined : pageBase.replace(/\/$/, "");

async function boot(): Promise<void> {
  await ensureLatestClientBuild();
  markHomeScreenRole();
  registerClientWorker();

  const host = window as typeof window & { __dbkRoot?: Root };
  const app = host.__dbkRoot ?? createRoot(root);
  host.__dbkRoot = app;
  app.render(
    <StrictMode>
      <BrowserRouter basename={routerBase}>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
}

void boot();

if (import.meta.hot) {
  import.meta.hot.accept();
}
