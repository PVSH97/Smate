import type { ToolContext } from "../services/db.js";
import {
  findCustomer,
  createCustomerTool,
  getCustomerCard,
  createVisit,
  createTasks,
  createSignals,
  createOpportunity,
  createClaims,
  createCustomerBrief,
  upsertSkuPackaging,
  searchMessages,
} from "../services/db.js";
import { createDraft, type DraftItem } from "../services/drafts.js";

// Called by Claude during tool-use loop
export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    // Read tools
    case "find_customer":
      return JSON.stringify(await findCustomer(ctx, input as never));
    case "get_customer_card":
      return JSON.stringify(await getCustomerCard(ctx, input as never));
    case "search_messages": {
      const query = input.query as string;
      const results = await searchMessages(ctx.conversationId, query);
      return JSON.stringify({ results, count: results.length });
    }
    // Write tool (Mode B gateway)
    case "parse_to_draft": {
      const items = input.items as DraftItem[];
      const summary = input.summary as string;
      const draft = await createDraft(ctx.conversationId, items, summary);
      return JSON.stringify({ success: true, draft_id: draft.id, summary });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// Execute a single draft item — called during confirmation flow
export async function executeDraftItem(
  item: DraftItem,
  ctx: ToolContext,
): Promise<{ success: boolean; error?: string }> {
  try {
    let result: object;
    switch (item.tool) {
      case "create_customer":
        result = await createCustomerTool(ctx, item.input as never);
        break;
      case "create_visit":
        result = await createVisit(ctx, item.input as never);
        break;
      case "create_tasks":
        result = await createTasks(ctx, item.input as never);
        break;
      case "create_signals":
        result = await createSignals(ctx, normalizeSignalsInput(item.input));
        break;
      case "create_opportunity":
        result = await createOpportunity(ctx, normalizeOpportunityInput(item.input));
        break;
      case "create_claims":
        result = await createClaims(ctx, item.input as never);
        break;
      case "create_customer_brief":
        result = await createCustomerBrief(ctx, item.input as never);
        break;
      case "upsert_sku_packaging":
        result = await upsertSkuPackaging(ctx, item.input as never);
        break;
      default:
        return { success: false, error: `Unknown tool: ${item.tool}` };
    }
    const r = result as { success?: boolean; error?: string };
    if (r.success === false) {
      console.error(`[draft] ${item.tool} failed:`, r.error);
      return { success: false, error: r.error };
    }
    return { success: true };
  } catch (err) {
    console.error(`[draft] ${item.tool} threw:`, err);
    return { success: false, error: String(err) };
  }
}

// Normalize Claude's signal input: "description" → "content"
function normalizeSignalsInput(input: Record<string, unknown>): never {
  const signals = input.signals as Array<Record<string, unknown>> | undefined;
  if (signals) {
    for (const s of signals) {
      if (!s.content && s.description) {
        s.content = s.description;
      }
    }
  }
  return input as never;
}

// Normalize Claude's opportunity input: ensure title exists
function normalizeOpportunityInput(input: Record<string, unknown>): never {
  if (!input.title) {
    input.title = (input.customer_name as string)
      ?? (input.product_name as string)
      ?? (input.description as string | undefined)?.slice(0, 60)
      ?? "Oportunidad comercial";
  }
  return input as never;
}
