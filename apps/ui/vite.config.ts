import { getRequestListener } from "@hono/node-server";
import react from "@vitejs/plugin-react";
import { register } from "tsx/esm/api";
import { defineConfig, type Plugin } from "vite";

// Let the dev-server process import the SDK's TypeScript sources (and
// dynamically import workflows/*.ts) without a build step.
register();

/**
 * Mounts the SDK's API server inside Vite's dev server so `npm run dev` is a
 * single process. The same Hono app is served by server/main.ts in prod.
 */
function apiPlugin(): Plugin {
  return {
    name: "iboss-api",
    async configureServer(server) {
      // Computed specifier so esbuild's config bundling can't hoist this
      // import ahead of the tsx register() call above.
      const appModule = new URL("./server/app.ts", import.meta.url).href;
      const { createApiApp } = (await import(appModule)) as typeof import("./server/app.js");
      const listener = getRequestListener(createApiApp().fetch);
      server.middlewares.use("/api", (req, res) => {
        void listener(req, res);
      });
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), apiPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
