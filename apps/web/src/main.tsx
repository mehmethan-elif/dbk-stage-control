import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { registerClientWorker } from "./pwa";
import "./styles/stage.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

const pageBase = import.meta.env.BASE_URL;
const routerBase =
  pageBase === "/" || pageBase === "./" ? undefined : pageBase.replace(/\/$/, "");

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

if (import.meta.hot) {
  import.meta.hot.accept();
}
