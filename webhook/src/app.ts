import { Hono } from "hono";
import { webhook } from "./routes/webhook.js";

const app = new Hono();

app.get("/", (c) => c.text("SMate Webhook Server"));
app.route("/api/webhook", webhook);

export { app };
