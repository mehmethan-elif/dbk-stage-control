import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { registerClientWorker } from "./pwa";
import "./styles/stage.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

const pageBase = import.meta.env.BASE_URL;
const routerBase = pageBase === "/" ? undefined : pageBase.replace(/\/$/, "");

registerClientWorker();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={routerBase}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
