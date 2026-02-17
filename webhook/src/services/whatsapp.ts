import { config } from "../config.js";

const API_VERSION = "v24.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export async function sendTextMessage(
  to: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const url = `${BASE_URL}/${config.META_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (
    data.messages &&
    Array.isArray(data.messages) &&
    data.messages.length > 0
  ) {
    const msg = data.messages[0] as { id: string };
    return { success: true, messageId: msg.id };
  }

  return { success: false, error: JSON.stringify(data) };
}
