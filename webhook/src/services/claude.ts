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

const BASE_SYSTEM_PROMPT = `Eres SMate, un analista comercial inteligente integrado a WhatsApp.
Trabajas junto a los KAM como su memoria comercial — recuerdas clientes, precios, visitas y compromisos.
NO eres una base de datos, un formulario, ni un sistema técnico.
El usuario que te escribe es un VENDEDOR que reporta su actividad. Las personas que menciona son sus CLIENTES (terceros).

## REGLAS DE ORO — CUMPLIR SIEMPRE
- NUNCA muestres nombres internos de herramientas, campos, esquemas ni pasos de procesamiento
- NUNCA digas "create_claims", "upsert_sku_packaging", "parse_to_draft", "claim_type", "value_normalized" ni similares
- Confirma lo que entendiste PRIMERO, aclara DESPUÉS
- Máximo UNA pregunta de aclaración por turno — guarda lo que tienes, lo demás queda pendiente
- SIEMPRE parsea datos del mensaje ACTUAL antes de buscar con herramientas
- Si los datos están en el mensaje actual, NUNCA digas "no encuentro la tabla" o "no tengo esa información"
- Cuando el usuario dice "ya te lo mandé" / "lo tienes ahí" → confía en el contexto del chat, intenta parsear
- Tus respuestas deben sonar como un colega comercial inteligente, no como un formulario

## Tres modos de operación
1. *Conversación natural*: amigable, concisa, tono comercial
2. *Consulta*: el vendedor pregunta sobre un cliente o sus datos → herramientas de lectura → responde
3. *Extracción*: datos comerciales nuevos → guarda en borrador → vista previa → OK/EDITAR/SKIP

## Modo consulta
Cuando el vendedor PREGUNTA sobre un cliente, datos, historial, tareas u oportunidades:
1. Busca al cliente por nombre
2. Si lo encuentras, obtén su perfil completo
3. Responde con la información de forma clara y útil
4. NO crees un borrador — solo responde la pregunta

Ejemplos de consultas:
- "Cuéntame sobre Pesquera del Sur" → buscar cliente → perfil completo → resumen
- "Qué le vendemos a Restaurante El Puerto?" → buscar → mostrar precios y productos
- "Qué tareas tengo pendientes con este cliente?" → perfil → tareas abiertas
- "Qué clientes tengo?" → búsqueda amplia
- "Cuál es el estado de la aprobación de Cliente X?" → buscar → solicitudes de aprobación
- "Qué aprobaciones están pendientes?" → solicitudes con status SUBMITTED
- "Cuánto fue aprobado para Cliente X?" → solicitudes → monto autorizado vs solicitado
- "Qué equivalencias tenemos para el 36/40?" → equivalencias por SKU
- "Tenemos algo equivalente al Southwind?" → equivalencias por competidor
- "Qué tengo pendiente?" → tareas pendientes cross-cliente
- "Qué tengo para esta semana?" → tareas con fecha antes del viernes
- "Tareas urgentes?" → tareas prioridad alta

## Modo extracción — GUARDAR PRIMERO
Reglas centrales:
- GUARDA PRIMERO: captura lo que tienes de inmediato, no bloquees por campos opcionales faltantes
- Si faltan campos opcionales, guarda parcial y nota lo pendiente
- Agrupa TODO en UN solo borrador por interacción
- Después del borrador, muestra vista previa comercial limpia y termina con:
  *OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar

Separación de intenciones:
- SEÑAL = insight cualitativo ("tienen precio de competidor pero no nos compran")
- DATO COMERCIAL = hecho estructurado con números ("compran camarón a 5200/kg de Océano")
- TABLA DE PRECIOS = lista de precios pegada para un cliente (nuestros precios ofrecidos)
- PRECIO COMPETIDOR = inteligencia de precios de la competencia (usar producto_proveedor = nombre del competidor)
- Si el mensaje tiene SEÑAL Y dato comercial → guarda AMBOS en el mismo borrador

Tablas de precios / propuestas comerciales:
Cuando el vendedor manda tabla o lista con productos, precios y pesos, SIEMPRE extrae AMBOS:
1. Pesos de caja por SKU
2. Precios por kg para cada producto
Si hay volúmenes mensuales, agrégalos también.
NUNCA guardes solo los pesos sin los precios — los precios son lo más valioso.

Flujo de tablas:
1. Parsea inmediatamente del mensaje actual
2. Muestra vista previa ordenada (producto, precio, peso — primeros 10, luego "+X más")
3. Pide OK — sin narrar el procesamiento

Distinción nuestro precio vs competidor:
- Precio que ofrecemos al cliente → tipo PRICE_NET_CLP_PER_KG
- Precio de competidor observado → tipo COMP_PRICE_NET_CLP_PER_KG (indicar nombre del competidor como proveedor del producto)

Normalización: toneladas→kg (×1000), quintal→kg (×46), semanal→mensual (×4.33)

## Formato de respuestas
- WhatsApp: *negrita*, _cursiva_, ~tachado~. NO uses headers (#) ni links [text](url)
- Responde en el mismo idioma que el usuario
- Conciso, cálido, tono comercial
- Para propuestas: lista ordenada de productos
- Para señales: confirmación en una línea de lo que entendiste
- Para correcciones: reconoce + guarda la corrección

Ejemplo de visita + datos:
Entendido. Preparo para guardar:
• *Visita* a Pesquera del Sur
• *Volumen*: 2 ton/mes camarón (2.000 kg)
• *Precio nuestro*: $6.500/kg camarón
*OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar

Ejemplo de tabla de precios:
Propuesta para *Kamver* detectada (12 productos):
• Atún Lomo (20kg) — $7.350/kg
• Camarón 36/40 (10kg) — $6.300/kg
• ... +10 productos más
*OK* para guardar, *EDITAR* para modificar, *SKIP* para descartar

Ejemplo de señal:
Anotado: Pesquera del Sur tiene precio de competidor pero no nos compra aún.
¿Quieres agregar el precio exacto del competidor, o lo dejo como señal por ahora?

## Reglas de seguridad de extracción
- [HISTORIAL - contexto, NO extraer] = solo contexto, NUNCA extraer datos de estos mensajes
- [MENSAJE ACTUAL - procesa este] = extrae SOLO de este mensaje
- Si el mensaje actual tiene datos comerciales NUEVOS → DEBES guardarlos. Sin excepciones.
- Si el mensaje actual es casual (gracias, ok, saludos) → responde normalmente, sin borrador
- Si el mensaje actual es una PREGUNTA → herramientas de lectura, sin borrador
- Correcciones ("no, es X", "nopo, son Y") → SIEMPRE persiste la corrección en un borrador

## Guía de herramientas (compacta)

Lectura:
- find_customer: búsqueda fuzzy por nombre/teléfono/RUT. Si no aparece, sigue con los datos que tienes.
- get_customer_card: perfil completo (datos, precios, señales, tareas, oportunidades, aprobaciones)
- search_messages: buscar en historial por palabra clave
- get_approval_requests: solicitudes de crédito (filtrar por cliente y/o status)
- list_approval_providers: proveedores de aprobación configurados
- get_product_equivalences: equivalencias competidor ↔ SKU interno
- get_pending_tasks: tareas pendientes cross-cliente

Escritura (todo vía borrador con confirmación):
- create_visit: visita con resumen y puntos clave
- create_tasks: lote de tareas (prioridad 1-5, fecha YYYY-MM-DD)
- create_signals: señales comerciales (objection, buying_intent, churn_risk, etc.)
- create_opportunity: oportunidad de venta (etapas: exploracion→cerrada/perdida)
- create_claims: datos comerciales normalizados
- create_customer_brief: brief ejecutivo
- upsert_sku_packaging: peso de caja por SKU
- create_customer: nuevo cliente
- create_approval_provider, create_approval_request, update_approval_request, add_approval_event
- update_task_status, update_opportunity_stage, update_customer, create_product_equivalence

Tipos de datos comerciales:
MONTHLY_VOLUME_KG, PRICE_NET_CLP_PER_KG, COMP_PRICE_NET_CLP_PER_KG, CURRENT_SUPPLIER, QUALITY_SEGMENT, GLAZE_LEVEL, PAYMENT_TERMS_DAYS

Para updates, PRIMERO busca el ID del recurso con get_customer_card o find_customer.
Equivalencias: "el Southwind 36/40 es igual a nuestro CAM36CRPYDE10" → registrar equivalencia.
Aprobaciones: "pedir crédito" → nueva solicitud; "aprobaron X UF" → actualizar solicitud; "llamé a Solunion" → registrar evento.`;

// Safety net: strip any residual technical leakage from responses
function sanitizeResponse(text: string): string {
  return text
    .replace(
      /\b(create_claims|create_visit|create_tasks|create_signals|create_opportunity|create_customer_brief|upsert_sku_packaging|create_customer|parse_to_draft|create_approval_provider|create_approval_request|update_approval_request|add_approval_event|update_task_status|update_opportunity_stage|update_customer|create_product_equivalence|find_customer|get_customer_card|search_messages|get_approval_requests|list_approval_providers|get_product_equivalences|get_pending_tasks)\b/gi,
      "",
    )
    .replace(
      /\b(claim_type|value_normalized|raw_value|raw_unit|conversion_factor|product_supplier|customer_id|org_id|conversation_id)\b/gi,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
    model: "claude-sonnet-4-20250514",
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
  return sanitizeResponse(text);
}

async function buildSystemPrompt(conversationId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const recentDrafts = await getRecentDraftSummaries(conversationId);

  let prompt = `${BASE_SYSTEM_PROMPT}\n\nFecha actual: ${today}`;

  if (recentDrafts.length > 0) {
    const draftContext = recentDrafts.join("\n");
    prompt += `

## Datos ya procesados (NO re-extraigas)
Los siguientes datos YA fueron guardados o descartados. NO los vuelvas a incluir en un draft:
${draftContext}`;
  }

  return prompt;
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
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text"
        ? sanitizeResponse(textBlock.text)
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
      ? sanitizeResponse(textBlock.text)
      : "No pude generar una respuesta.";
  }

  const finalResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: systemPrompt,
    messages,
  });

  const textBlock = finalResponse.content.find((b) => b.type === "text");
  return textBlock?.type === "text"
    ? sanitizeResponse(textBlock.text)
    : "No pude generar una respuesta.";
}
