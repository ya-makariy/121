import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "./config.ts";
import { db } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { mountRoutes } from "./routes/index.ts";
import { onError, onNotFound } from "./middleware/errors.ts";

// Migrations run before the server starts accepting connections.
const result = migrate(db());
if (result.applied.length > 0) {
  if (result.backup) console.log(`Pre-migration backup: ${result.backup}`);
  console.log(`Schema: ${result.from} -> ${result.to} (${result.applied.join(", ")})`);
}

const app = new Hono();
app.onError(onError);
app.notFound(onNotFound);

app.use("/app.css", serveStatic({ root: "./public" }));
app.use("/metric-chart.js", serveStatic({ root: "./public" }));
app.use("/compare-chart.js", serveStatic({ root: "./public" }));
app.use("/reorder.js", serveStatic({ root: "./public" }));
app.use("/field-form.js", serveStatic({ root: "./public" }));
app.use("/meeting-rail.js", serveStatic({ root: "./public" }));
app.use("/vendor/*", serveStatic({ root: "./public" }));

mountRoutes(app);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};

console.log(`121 listening on http://${config.host}:${config.port}`);
