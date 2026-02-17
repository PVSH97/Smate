import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { app } from "./app.js";

console.log(`[smate] Starting webhook server on port ${config.PORT}`);
serve({ fetch: app.fetch, port: config.PORT });
console.log(`[smate] Server running at http://localhost:${config.PORT}`);
