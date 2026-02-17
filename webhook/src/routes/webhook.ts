import { Hono } from "hono";
import { config } from "../config.js";
import { verifySignature } from "../lib/signature.js";
import { webhookBodySchema } from "../lib/types.js";
import { generateReply } from "../services/claude.js";
import { sendTextMessage } from "../services/whatsapp.js";

const webhook = new Hono();

// Rate limiting: track last reply time per phone
const lastReplyTime = new Map<string, number>();
const MIN_INTERVAL_MS = 3000;

// GET /webhook - Meta verification handshake
webhook.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === config.WEBHOOK_VERIFY_TOKEN) {
    console.log("[webhook] Verification successful");
    return c.text(challenge ?? "", 200);
  }

  console.log("[webhook] Verification failed");
  return c.text("Forbidden", 403);
});

// POST /webhook - Receive messages
webhook.post("/", async (c) => {
  const rawBody = await c.req.text();

  // Verify HMAC signature
  const signature = c.req.header("x-hub-signature-256");
  if (!verifySignature(rawBody, signature)) {
    console.log("[webhook] Invalid signature");
    return c.text("Invalid signature", 401);
  }

  // Return 200 immediately (Meta requires fast response)
  const parsed = webhookBodySchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    console.log("[webhook] Invalid payload:", parsed.error.message);
    return c.text("OK", 200);
  }

  // Process async (don't block the response)
  processWebhook(parsed.data).catch((err) =>
    console.error("[webhook] Processing error:", err)
  );

  return c.text("OK", 200);
});

async function processWebhook(
  body: ReturnType<typeof webhookBodySchema.parse>
): Promise<void> {
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages;
      if (!messages) continue;

      for (const msg of messages) {
        // Only handle text messages for now
        if (msg.type !== "text" || !msg.text) continue;

        const phone = msg.from;
        const text = msg.text.body;
        const contactName =
          change.value.contacts?.[0]?.profile.name ?? "Unknown";

        console.log(`[webhook] Message from ${contactName} (${phone}): ${text}`);

        // Simple rate limiting
        const lastTime = lastReplyTime.get(phone) ?? 0;
        if (Date.now() - lastTime < MIN_INTERVAL_MS) {
          console.log(`[webhook] Rate limited: ${phone}`);
          continue;
        }
        lastReplyTime.set(phone, Date.now());

        try {
          const reply = await generateReply(phone, text);
          console.log(`[webhook] Reply to ${phone}: ${reply}`);

          const result = await sendTextMessage(phone, reply);
          if (!result.success) {
            console.error(`[webhook] Failed to send: ${result.error}`);
          }
        } catch (err) {
          console.error(`[webhook] Error processing message from ${phone}:`, err);
        }
      }
    }
  }
}

export { webhook };
