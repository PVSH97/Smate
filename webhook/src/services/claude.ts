import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { tools } from "../tools/definitions.js";
import { handleToolCall, executeDraftItem } from "../tools/handlers.js";
import { getConversationHistory, type ToolContext } from "./db.js";
import {
  getConversationState,
  getPendingDraft,
  confirmDraft,
  discardDraft,
} from "./drafts.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `Eres SMate, un asistente de inteligencia comercial integrado a WhatsApp.

Tu rol tiene DOS partes:

1. **Conversación natural**: Responde al usuario de forma amigable, concisa y útil.
2. **Extracción con confirmación**: Detecta información comercial y usa \`parse_to_draft\` para proponer guardarla. NUNCA persistas datos directamente.

## Reglas de conversación
- Responde en el mismo idioma que el usuario (español o inglés)
- Sé conciso: respuestas cortas y directas, ideales para WhatsApp
- Usa formato WhatsApp: *negrita*, _cursiva_, ~tachado~
- No uses markdown de headers (#) ni links [text](url)
- Máximo 1-2 párrafos, a menos que pidan detalle

## Reglas de extracción (Mode B)
- Usa \`parse_to_draft\` para TODA la información comercial
- Agrupa todo en UN solo draft por interacción
- El summary debe ser claro y en español, listando cada dato
- Después del draft, termina tu mensaje con:
  *OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar
- Si NO hay datos comerciales en el mensaje, responde normalmente sin draft

## Herramientas de lectura
- \`find_customer\`: Búsqueda fuzzy por nombre, teléfono o RUT. Usa SIEMPRE antes de crear un cliente nuevo.
- \`get_customer_card\`: Perfil completo del cliente (claims, señales, tareas, oportunidades). Usa para preparar una conversación o generar brief.
- \`search_messages\`: Busca mensajes antiguos por palabra clave. Usa cuando el usuario referencia temas no visibles.

## Herramientas de escritura (vía parse_to_draft)
Todas se envían dentro de \`parse_to_draft.items[].tool\`:

- \`create_customer\`: Nuevo cliente (phone, name obligatorios). Verificar con find_customer primero.
- \`create_visit\`: Visita con summary, key_points, objections[], next_visit_requirements[]
- \`create_tasks\`: Lote de tareas. priority: 1(baja)-5(urgente), due_date YYYY-MM-DD
- \`create_signals\`: Lote de señales comerciales (objection, buying_intent, churn_risk, etc.)
- \`create_opportunity\`: Oportunidad de venta. Etapas: exploracion, muestra, cotizacion, negociacion, cerrada, perdida
- \`create_claims\`: Claims comerciales normalizados (volumen, precio, proveedor, calidad, glaseo, plazo pago)
- \`create_customer_brief\`: Brief ejecutivo con objective, talk_tracks, recommended_offer, risks, open_questions
- \`upsert_sku_packaging\`: Peso de caja por SKU (sku + case_weight_kg)

## Normalización de claims
- Toneladas→kg (*1000), quintal→kg (*46), semanal→mensual (*4.33)
- SIEMPRE guarda raw_value + raw_unit + conversion_factor para auditoría
- value_unit normalizado: "kg" para volumen, "CLP/kg" para precio, "days" para plazos
- Si mencionan cajas, consulta sku_packaging para convertir a kg, o pregunta al usuario

## Formato del summary en parse_to_draft
Ejemplo:
"Detecté lo siguiente:\\n• *Visita*: Reunión con bodega, interés en salmón\\n• *Señal*: Precio competitivo vs proveedor actual\\n• *Tarea*: Enviar cotización lunes\\n• *Claim*: Volumen mensual 2000kg de camarón"`;

// Regex patterns for confirmation responses
const OK_PATTERN = /^(ok|si|sí|dale|confirmar?|listo|va|bueno|perfecto)\b/i;
const SKIP_PATTERN = /^(skip|no|cancelar?|descartar?|nada|olvida|dejalo)\b/i;

export async function generateReply(
  conversationId: string,
  userMessage: string,
  toolContext: ToolContext,
): Promise<string> {
  const convState = await getConversationState(conversationId);

  // Mode B: handle pending draft confirmation
  if (convState === "awaiting_confirmation") {
    return handleConfirmation(conversationId, userMessage, toolContext);
  }

  // Normal flow: tool-use loop
  return runToolLoop(conversationId, userMessage, toolContext);
}

async function handleConfirmation(
  conversationId: string,
  userMessage: string,
  toolContext: ToolContext,
): Promise<string> {
  const draft = await getPendingDraft(conversationId);
  if (!draft) {
    // No pending draft found — reset state and proceed normally
    const { supabase } = await import("../lib/supabase.js");
    await supabase
      .from("conversations")
      .update({ conv_state: "normal" })
      .eq("id", conversationId);
    return runToolLoop(conversationId, userMessage, toolContext);
  }

  const trimmed = userMessage.trim();

  // Regex-first: OK → execute all items
  if (OK_PATTERN.test(trimmed)) {
    const errors: string[] = [];
    for (const item of draft.draft_data) {
      const result = await executeDraftItem(item, toolContext);
      if (!result.success) errors.push(result.error ?? item.tool);
    }
    await confirmDraft(draft.id, conversationId);

    if (errors.length > 0) {
      return `Guardado con algunos errores: ${errors.join(", ")}. Los demás datos se guardaron correctamente.`;
    }
    return "Listo, todo guardado.";
  }

  // Regex-first: SKIP → discard
  if (SKIP_PATTERN.test(trimmed)) {
    await discardDraft(draft.id, conversationId);
    return "Descartado, no se guardó nada.";
  }

  // Ambiguous or EDIT — let Claude interpret
  return handleAmbiguousConfirmation(
    conversationId,
    userMessage,
    draft.summary_text,
    toolContext,
  );
}

async function handleAmbiguousConfirmation(
  conversationId: string,
  userMessage: string,
  draftSummary: string,
  toolContext: ToolContext,
): Promise<string> {
  const history = await getConversationHistory(conversationId);
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: `El usuario tiene un draft pendiente con este resumen:\n"${draftSummary}"\n\nInterpreta su respuesta. Si quiere confirmar, responde EXACTAMENTE "CONFIRM". Si quiere descartar, responde EXACTAMENTE "DISCARD". Si quiere editar o no es claro, explica las opciones disponibles: *OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar.`,
    messages,
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";

  if (text.trim() === "CONFIRM") {
    // Re-run OK path
    return handleConfirmation(conversationId, "ok", toolContext);
  }
  if (text.trim() === "DISCARD") {
    return handleConfirmation(conversationId, "skip", toolContext);
  }

  // Claude generated an explanation — return it
  return text;
}

async function runToolLoop(
  conversationId: string,
  userMessage: string,
  toolContext: ToolContext,
): Promise<string> {
  const history = await getConversationHistory(conversationId);

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

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text"
        ? textBlock.text
        : "No pude generar una respuesta.";
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

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

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text"
      ? textBlock.text
      : "No pude generar una respuesta.";
  }

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
