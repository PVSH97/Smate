import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { getHistory, addMessage } from "./conversation.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres SMate, un asistente de WhatsApp inteligente y amigable.

Reglas:
- Responde en el mismo idioma que el usuario (español o inglés)
- Sé conciso: las respuestas deben ser cortas y directas, ideales para WhatsApp
- Usa formato WhatsApp cuando sea útil: *negrita*, _cursiva_, ~tachado~, \`código\`
- No uses markdown de headers (#) ni links [text](url) -- WhatsApp no los renderiza
- Máximo 1-2 párrafos por respuesta, a menos que el usuario pida una explicación detallada
- Sé natural y conversacional, no robótico
- Si no sabes algo, dilo honestamente`;

export async function generateReply(
  phone: string,
  userMessage: string
): Promise<string> {
  addMessage(phone, "user", userMessage);
  const history = getHistory(phone);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const reply =
    response.content[0]?.type === "text"
      ? response.content[0].text
      : "No pude generar una respuesta.";

  addMessage(phone, "assistant", reply);
  return reply;
}
