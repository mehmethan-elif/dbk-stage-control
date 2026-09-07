import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";

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
      const library = path.resolve(__dirname, "../../client-library");
      try {
        copyFileSync(index, path.join(dist, "404.html"));
        mkdirSync(path.join(dist, "client"), { recursive: true });
        copyFileSync(index, path.join(dist, "client", "index.html"));
        writeFileSync(path.join(dist, ".nojekyll"), "");
        if (existsSync(library)) {
          cpSync(library, path.join(dist, "client-library"), { recursive: true });
        }
        stampBuiltServiceWorker(dist);
      } catch {
        // dev server has no dist yet
      }
    }
  };
}

function stampBuiltServiceWorker(dist: string): void {
  const sw = path.join(dist, "sw.js");
  if (!existsSync(sw)) return;
  const stamp = process.env.GITHUB_SHA?.slice(0, 7) || String(Date.now());
  const text = readFileSync(sw, "utf8").replace(/const BUILD = ["'][^"']*["'];/, `const BUILD = ${JSON.stringify(stamp)};`);
  writeFileSync(sw, text);
}

function clientLibraryDev(): Plugin {
  const library = path.resolve(__dirname, "../../client-library");
  return {
    name: "dbk-client-library-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (req.method !== "GET" || !url.startsWith("/client-library/")) {
          next();
          return;
        }
        const rel = decodeURIComponent(url.slice("/client-library/".length));
        if (!rel || rel.includes("..")) {
          next();
          return;
        }
        const full = path.resolve(library, rel);
        if (!full.startsWith(library) || !existsSync(full) || statSync(full).isDirectory()) {
          next();
          return;
        }
        res.setHeader("cache-control", "no-store");
        createReadStream(full).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), pagesFallback(), clientLibraryDev()],
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
      "/client-library/publish": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/sync": { target: "ws://127.0.0.1:8787", ws: true }
    }
  }
});
