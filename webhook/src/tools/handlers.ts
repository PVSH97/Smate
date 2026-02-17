import type { ToolContext } from "../services/db.js";
import {
  lookupCustomer,
  saveExtraction,
  logVisit,
  createTask,
  saveSignal,
  savePurchase,
} from "../services/db.js";

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case "lookup_customer":
      return JSON.stringify(await lookupCustomer(ctx, input as never));
    case "save_extraction":
      return JSON.stringify(await saveExtraction(ctx, input as never));
    case "log_visit":
      return JSON.stringify(await logVisit(ctx, input as never));
    case "create_task":
      return JSON.stringify(await createTask(ctx, input as never));
    case "save_signal":
      return JSON.stringify(await saveSignal(ctx, input as never));
    case "save_purchase":
      return JSON.stringify(await savePurchase(ctx, input as never));
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
