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
    switch (item.tool) {
      case "create_customer":
        await createCustomerTool(ctx, item.input as never);
        break;
      case "create_visit":
        await createVisit(ctx, item.input as never);
        break;
      case "create_tasks":
        await createTasks(ctx, item.input as never);
        break;
      case "create_signals":
        await createSignals(ctx, item.input as never);
        break;
      case "create_opportunity":
        await createOpportunity(ctx, item.input as never);
        break;
      case "create_claims":
        await createClaims(ctx, item.input as never);
        break;
      case "create_customer_brief":
        await createCustomerBrief(ctx, item.input as never);
        break;
      case "upsert_sku_packaging":
        await upsertSkuPackaging(ctx, item.input as never);
        break;
      default:
        return { success: false, error: `Unknown tool: ${item.tool}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
