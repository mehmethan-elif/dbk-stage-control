import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as {
  version: string;
};

const pagesBase = process.env.DBK_PAGES_BASE || "/";

function pagesFallback(): Plugin {
  return {
    name: "dbk-pages-fallback",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      const index = path.join(dist, "index.html");
      try {
        copyFileSync(index, path.join(dist, "404.html"));
        mkdirSync(path.join(dist, "client"), { recursive: true });
        copyFileSync(index, path.join(dist, "client", "index.html"));
        writeFileSync(path.join(dist, ".nojekyll"), "");
      } catch {
        // dev server has no dist yet
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), pagesFallback()],
  base: pagesBase,
  root: __dirname,
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version)
  },
  resolve: {
    alias: {
      "@dbk/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@dbk/audio": path.resolve(__dirname, "../../packages/audio/src/index.ts"),
      "@dbk/logger": path.resolve(__dirname, "../../packages/logger/src/index.ts"),
      "@dbk/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts")
    }
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"]
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/library": "http://127.0.0.1:8787",
      "/practice": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/sync": { target: "ws://127.0.0.1:8787", ws: true }
    }
  }
});
