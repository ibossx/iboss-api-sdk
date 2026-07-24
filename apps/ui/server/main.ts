/**
 * Production server: serves the built frontend (apps/ui/dist) and the API on
 * one port, bound to localhost only. Run `npm run build -w @iboss/ui` first.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");

const app = new Hono();
app.route("/api", createApiApp());
app.use("*", serveStatic({ root: relative(process.cwd(), distDir) }));
app.get("*", serveStatic({ path: relative(process.cwd(), resolve(distDir, "index.html")) }));

const port = Number(process.env.IBOSS_UI_PORT ?? 5173);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`iboss SDK UI listening on http://127.0.0.1:${info.port}`);
});
