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
  getRecentDraftSummaries,
} from "./drafts.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const MAX_TOOL_ROUNDS = 5;

const BASE_SYSTEM_PROMPT = `Eres SMate, un asistente de inteligencia comercial integrado a WhatsApp.

## Contexto
El usuario que te escribe es un VENDEDOR que reporta su actividad comercial. Los clientes que menciona son TERCEROS (sus cuentas). Ya conoces al vendedor — su ID de cliente está en el contexto del sistema.

Tu rol tiene TRES modos:
1. **Conversación natural**: Responde de forma amigable y concisa.
2. **Consultas (preguntas del vendedor)**: Usa herramientas de lectura para responder.
3. **Extracción con confirmación**: Detecta información comercial nueva y llama \`parse_to_draft\`.

## Reglas de conversación
- Responde en el mismo idioma que el usuario (español o inglés)
- Sé conciso: respuestas cortas, ideales para WhatsApp
- Usa formato WhatsApp: *negrita*, _cursiva_, ~tachado~
- No uses markdown de headers (#) ni links [text](url)

## Modo consulta (IMPORTANTE)
Cuando el vendedor PREGUNTA sobre un cliente, sus datos, historial, tareas, oportunidades, etc.:
1. Usa \`find_customer\` para encontrarlo por nombre
2. Si lo encuentras, usa \`get_customer_card\` con su customer_id para obtener su perfil completo
3. Responde con la información solicitada de forma clara y útil
4. NO crees un draft — solo responde la pregunta

Ejemplos de consultas:
- "Cuéntame sobre Pesquera del Sur" → find_customer → get_customer_card → responde con resumen
- "Qué le vendemos a Restaurante El Puerto?" → find_customer → get_customer_card → muestra claims
- "Qué tareas tengo pendientes con este cliente?" → get_customer_card → muestra open_tasks
- "Qué clientes tengo?" → find_customer con query amplio
- "Cuál es el estado de la aprobación de Cliente X?" → find_customer → get_approval_requests(customer_id)
- "Qué aprobaciones están pendientes?" → get_approval_requests(status: "SUBMITTED")
- "Cuánto fue aprobado para Cliente X?" → get_approval_requests(customer_id) → muestra authorized vs requested

## Reglas de extracción (CRÍTICAS)
- Los mensajes del historial tienen el tag [HISTORIAL - contexto, NO extraer]. NUNCA extraigas datos de ellos.
- Solo extrae datos del mensaje con tag [MENSAJE ACTUAL - procesa este]. SOLO ese mensaje.
- Si el mensaje actual contiene datos comerciales NUEVOS → DEBES llamar \`parse_to_draft\`. Sin excepciones.
- Si el mensaje actual es casual (gracias, ok, saludos) → responde normalmente, SIN draft.
- Si el mensaje actual es una PREGUNTA → usa herramientas de lectura, SIN draft.
- NO pidas más datos antes de crear el draft. Guarda lo que tienes.
- Agrupa todo en UN solo draft por interacción
- Después del draft, termina tu mensaje con:
  *OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar

## Regla de corrección (IMPORTANTE)
Cuando el vendedor CORRIGE un dato ("no, es X", "nopo, son Y", "el precio era Z"):
- Crea un draft con el dato corregido (create_claims, update_customer, etc.)
- No solo respondas "tienes razón" — PERSISTE la corrección

## Herramientas de lectura
- \`find_customer\`: Búsqueda fuzzy por nombre, teléfono o RUT. Úsala para buscar clientes mencionados. Si no aparece, NO bloquees: incluye los datos en el draft igual.
- \`get_customer_card\`: Perfil completo del cliente (claims, señales, tareas, oportunidades, aprobaciones). Úsala SIEMPRE cuando el vendedor pregunte sobre un cliente.
- \`search_messages\`: Busca mensajes antiguos por palabra clave.
- \`get_approval_requests\`: Solicitudes de aprobación/crédito. Filtra por customer_id y/o status. Retorna proveedor y último evento.
- \`list_approval_providers\`: Lista proveedores de aprobación configurados (aseguradoras, bancos, comités).

## Herramientas de escritura (vía parse_to_draft)
Todas se envían dentro de \`parse_to_draft.items[].tool\`:

- \`create_visit\`: Visita con summary, key_points, objections[], next_visit_requirements[]
- \`create_tasks\`: Lote de tareas. priority: 1(baja)-5(urgente), due_date YYYY-MM-DD
- \`create_signals\`: Lote de señales comerciales (objection, buying_intent, churn_risk, etc.)
- \`create_opportunity\`: Oportunidad de venta. Etapas: exploracion, muestra, cotizacion, negociacion, cerrada, perdida
- \`create_claims\`: Claims comerciales normalizados. Ver schema exacto abajo.
- \`create_customer_brief\`: Brief ejecutivo con objective, talk_tracks, recommended_offer, risks, open_questions
- \`upsert_sku_packaging\`: Peso de caja por SKU (sku + case_weight_kg)
- \`create_customer\`: Nuevo cliente. phone es opcional si no se conoce.

### REGLA CRÍTICA: Tablas de precios / propuestas comerciales
Cuando el vendedor manda una tabla o lista con productos, precios y pesos, SIEMPRE debes extraer AMBOS:
1. \`upsert_sku_packaging\` para cada SKU con su peso de caja
2. \`create_claims\` con claim_type "PRICE_NET_CLP_PER_KG" para cada producto con precio
Si hay volúmenes mensuales, agrega también "MONTHLY_VOLUME_KG".
NUNCA guardes solo los pesos sin los precios — los precios son la información más valiosa.

Herramientas de aprobación/crédito:
- \`create_approval_provider\`: Registrar proveedor de aprobación (name, provider_type, notes)
- \`create_approval_request\`: Solicitud de crédito/aprobación (provider_name, request_type, requested_amount, requested_unit)
- \`update_approval_request\`: Actualizar estado/decisión (request_id, status, authorized_amount, authorized_unit, decision_reason)
- \`add_approval_event\`: Registrar seguimiento, apelación, documentos, notas (request_id, event_type, description)

Herramientas de actualización:
- \`update_task_status\`: Cambiar estado de tarea (task_id, status: pending|in_progress|done|cancelled|snoozed)
- \`update_opportunity_stage\`: Cambiar etapa de oportunidad (opportunity_id, stage, probability, next_step)
- \`update_customer\`: Actualizar datos del cliente (customer_id, name, trade_name, phone, rut, industry, address_commune, address_city)

## Schema exacto de create_claims
\`\`\`
{
  "claims": [
    {
      "claim_type": "MONTHLY_VOLUME_KG" | "PRICE_NET_CLP_PER_KG" | "CURRENT_SUPPLIER" | "QUALITY_SEGMENT" | "GLAZE_LEVEL" | "PAYMENT_TERMS_DAYS",
      "product_name": "camarón",        // opcional
      "product_supplier": "Proveedor X", // opcional
      "value_normalized": 2000,          // valor numérico normalizado
      "value_unit": "kg",               // kg | CLP/kg | days | % | text
      "raw_value": "2",                 // valor original como string
      "raw_unit": "toneladas",          // unidad original
      "conversion_factor": 1000,         // multiplicador raw→normalized
      "confidence": 0.9                  // 0-1 opcional
    }
  ]
}
\`\`\`
Normalización: toneladas→kg (*1000), quintal→kg (*46), semanal→mensual (*4.33)

## Schema de create_approval_request
\`\`\`
{
  "provider_name": "Solunion",         // nombre del proveedor (busca automáticamente el ID)
  "request_type": "CREDIT_LIMIT",      // CREDIT_LIMIT | CREDIT_INCREASE | PAYMENT_TERMS | FINANCING | COMPLIANCE_APPROVAL | OTHER
  "requested_amount": 500,             // monto solicitado
  "requested_unit": "UF",              // unidad (UF, CLP, USD, etc.)
  "next_action": "Esperar respuesta",  // próximo paso
  "priority": 3                        // 1-5 (default 3)
}
\`\`\`

## Schema de update_approval_request
\`\`\`
{
  "request_id": "uuid",               // ID de la solicitud a actualizar
  "status": "APPROVED",               // SUBMITTED | IN_REVIEW | APPROVED | PARTIAL_APPROVED | REJECTED | APPEALED | CLOSED
  "authorized_amount": 400,           // monto autorizado
  "authorized_unit": "UF",
  "decision_date": "2026-02-19",
  "decision_reason": "Aprobado con límite reducido"
}
\`\`\`

## Schema de add_approval_event
\`\`\`
{
  "request_id": "uuid",
  "event_type": "FOLLOWED_UP",        // SUBMITTED | FOLLOWED_UP | DECISION_RECEIVED | INTERNAL_LIMIT_SET | DOCS_REQUESTED | APPEAL_SUBMITTED | APPEAL_RESOLVED | NOTE
  "description": "Llamé a Solunion, están revisando documentos"
}
\`\`\`

## Reglas de extracción de aprobaciones
Cuando el vendedor mencione:
- "solicitud de crédito", "pedir crédito", "línea de crédito", "solicitar aprobación" → create_approval_request
- "aprobaron", "rechazaron", "autorizaron X UF", "dieron línea de" → update_approval_request (necesitas request_id: primero busca con get_approval_requests)
- "hice seguimiento", "llamé a Solunion/Coface", "me pidieron documentos" → add_approval_event (necesitas request_id)
- Si menciona un proveedor que no conoces (no es Solunion, Coface, Comité Interno) → create_approval_provider + create_approval_request
- "habilitamos internamente X para el cliente" → update_approval_request con internal_operational_limit

## Reglas de extracción de actualizaciones
Cuando el vendedor mencione:
- "la tarea de X ya está lista", "terminé la tarea" → update_task_status(task_id, status: "done")
- "cancela esa tarea", "ya no es necesario" → update_task_status(task_id, status: "cancelled")
- "la oportunidad avanzó a cotización" → update_opportunity_stage(opportunity_id, stage)
- "el teléfono de X cambió a...", "el RUT es..." → update_customer(customer_id, ...)
- Para updates, PRIMERO busca el ID del recurso usando get_customer_card o find_customer

## Ejemplo de flujo de extracción
Usuario: "Hoy visité a Pesquera del Sur, compran 2 toneladas de camarón a $6500/kg"
→ Llamas find_customer("Pesquera del Sur")
→ No existe? No importa. Llamas parse_to_draft con:
  - create_visit: {"summary": "Visita a Pesquera del Sur", "key_points": ["Compran 2 ton camarón/mes a $6500/kg"]}
  - create_claims: {"claims": [{"claim_type": "MONTHLY_VOLUME_KG", "product_name": "camarón", "value_normalized": 2000, "value_unit": "kg", "raw_value": "2", "raw_unit": "toneladas", "conversion_factor": 1000}, {"claim_type": "PRICE_NET_CLP_PER_KG", "product_name": "camarón", "value_normalized": 6500, "value_unit": "CLP/kg", "raw_value": "6500", "raw_unit": "CLP/kg", "conversion_factor": 1}]}
→ Respondes: "Detecté lo siguiente:\\n• *Visita*: ...\\n• *Claims*: ...\\n\\n*OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar"

## Ejemplo de tabla de precios
Usuario envía: "ATUNLOIN24E20 ATUN LOINS 20kg $7.350/kg | CAM36CRPYDE10 CAMARON 36/40 10kg $6.300/kg"
→ parse_to_draft con:
  - upsert_sku_packaging: [{"sku": "ATUNLOIN24E20", "case_weight_kg": 20}, {"sku": "CAM36CRPYDE10", "case_weight_kg": 10}]
  - create_claims: {"claims": [
      {"claim_type": "PRICE_NET_CLP_PER_KG", "product_name": "atún lomo", "value_normalized": 7350, "value_unit": "CLP/kg", "raw_value": "7.350", "raw_unit": "CLP/kg", "conversion_factor": 1},
      {"claim_type": "PRICE_NET_CLP_PER_KG", "product_name": "camarón 36/40", "value_normalized": 6300, "value_unit": "CLP/kg", "raw_value": "6.300", "raw_unit": "CLP/kg", "conversion_factor": 1}
    ]}
→ Ambos en el MISMO draft. Nunca uno sin el otro.

## Ejemplo de corrección
Usuario: "nopo si se lo ofreci a 7.350"
→ parse_to_draft con:
  - create_claims: {"claims": [{"claim_type": "PRICE_NET_CLP_PER_KG", "product_name": "atún lomo", "value_normalized": 7350, "value_unit": "CLP/kg", "raw_value": "7.350", "raw_unit": "CLP/kg", "conversion_factor": 1}]}
→ SIEMPRE persiste la corrección en un draft

## Ejemplo de flujo de consulta
Usuario: "Cuéntame sobre Restaurante El Puerto"
→ Llamas find_customer("Restaurante El Puerto")
→ Encuentras customer_id → Llamas get_customer_card(customer_id)
→ Respondes con resumen del perfil, claims, tareas pendientes, etc.
→ NO creas draft`;

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

async function buildSystemPrompt(conversationId: string): Promise<string> {
  const recentDrafts = await getRecentDraftSummaries(conversationId);
  if (recentDrafts.length === 0) return BASE_SYSTEM_PROMPT;

  const draftContext = recentDrafts.join("\n");
  return `${BASE_SYSTEM_PROMPT}

## Datos ya procesados (NO re-extraigas)
Los siguientes datos YA fueron guardados o descartados. NO los vuelvas a incluir en un draft:
${draftContext}`;
}

async function runToolLoop(
  conversationId: string,
  userMessage: string,
  toolContext: ToolContext,
): Promise<string> {
  const [history, systemPrompt] = await Promise.all([
    getConversationHistory(conversationId),
    buildSystemPrompt(conversationId),
  ]);

  // Annotate history to prevent re-extraction: tag old messages as context-only
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.role === "user"
          ? `[HISTORIAL - contexto, NO extraer]\n${m.content}`
          : m.content,
    })),
    {
      role: "user",
      content: `[MENSAJE ACTUAL - procesa este]\n${userMessage}`,
    },
  ];

  // Debug: log what Claude receives
  console.log(`[claude] System prompt length: ${systemPrompt.length}`);
  console.log(
    `[claude] Messages (${messages.length}):`,
    JSON.stringify(
      messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : "[tool_results]",
      })),
    ),
  );

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
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
    system: systemPrompt,
    messages,
  });

  const textBlock = finalResponse.content.find((b) => b.type === "text");
  return textBlock?.type === "text"
    ? textBlock.text
    : "No pude generar una respuesta.";
}
