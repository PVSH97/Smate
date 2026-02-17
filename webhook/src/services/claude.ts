import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { tools } from "../tools/definitions.js";
import { handleToolCall } from "../tools/handlers.js";
import { getConversationHistory, type ToolContext } from "./db.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `Eres SMate, un asistente de inteligencia comercial integrado a WhatsApp.

Tu rol tiene DOS partes que ejecutas SIMULTÁNEAMENTE:

1. **Conversación natural**: Responde al usuario de forma amigable, concisa y útil.
2. **Extracción silenciosa**: Mientras conversas, usa tus herramientas para capturar TODA la información comercial relevante que detectes en el mensaje.

## Reglas de conversación
- Responde en el mismo idioma que el usuario (español o inglés)
- Sé conciso: respuestas cortas y directas, ideales para WhatsApp
- Usa formato WhatsApp: *negrita*, _cursiva_, ~tachado~
- No uses markdown de headers (#) ni links [text](url)
- Máximo 1-2 párrafos, a menos que pidan detalle
- Sé natural y conversacional, no robótico

## Reglas de extracción
- SIEMPRE busca información comercial para extraer: visitas, compras, señales, tareas
- Usa las herramientas SIN pedir permiso y SIN mencionar que las estás usando
- Si el usuario menciona una visita → log_visit
- Si menciona una compra con producto/precio/cantidad → save_purchase
- Si expresa objeciones, interés, problemas → save_signal
- Si hay un pendiente o acción a seguir → create_task
- Si hay datos estructurados nuevos → save_extraction
- La respuesta al usuario NO debe mencionar que guardaste datos
- Puedes usar múltiples herramientas en una sola interacción`;

export async function generateReply(
  conversationId: string,
  userMessage: string,
  toolContext: ToolContext,
): Promise<string> {
  const history = await getConversationHistory(conversationId);

  // Build messages array — history + current message
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    // If no tool use, extract text and return
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text"
        ? textBlock.text
        : "No pude generar una respuesta.";
    }

    // Process tool calls
    if (response.stop_reason === "tool_use") {
      // Add assistant's response (with tool_use blocks) to messages
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(
            `[claude] Tool call: ${block.name}`,
            JSON.stringify(block.input),
          );
          try {
            const result = await handleToolCall(
              block.name,
              block.input as Record<string, unknown>,
              toolContext,
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          } catch (err) {
            console.error(`[claude] Tool error (${block.name}):`, err);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({ error: String(err) }),
              is_error: true,
            });
          }
        }
      }

      messages.push({ role: "user", content: toolResults });
      rounds++;
      continue;
    }

    // Unexpected stop reason — extract whatever text we have
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text"
      ? textBlock.text
      : "No pude generar una respuesta.";
  }

  // Max rounds exceeded — do a final call without tools to get a text response
  const finalResponse = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
  });

  const textBlock = finalResponse.content.find((b) => b.type === "text");
  return textBlock?.type === "text"
    ? textBlock.text
    : "No pude generar una respuesta.";
}
