import { supabase } from "../lib/supabase.js";

export interface DraftItem {
  tool: string;
  input: Record<string, unknown>;
}

export interface Draft {
  id: string;
  conversation_id: string;
  draft_data: DraftItem[];
  summary_text: string;
  status: "pending" | "confirmed" | "discarded";
}

export async function createDraft(
  conversationId: string,
  items: DraftItem[],
  summaryText: string,
): Promise<Draft> {
  // Set conv_state to awaiting_confirmation
  await supabase
    .from("conversations")
    .update({ conv_state: "awaiting_confirmation" })
    .eq("id", conversationId);

  const { data, error } = await supabase
    .from("drafts")
    .insert({
      conversation_id: conversationId,
      draft_data: items,
      summary_text: summaryText,
    })
    .select("id, conversation_id, draft_data, summary_text, status")
    .single();

  if (error) throw new Error(`Failed to create draft: ${error.message}`);
  return data as Draft;
}

export async function getPendingDraft(
  conversationId: string,
): Promise<Draft | null> {
  const { data } = await supabase
    .from("drafts")
    .select("id, conversation_id, draft_data, summary_text, status")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (data as Draft) ?? null;
}

export async function confirmDraft(
  draftId: string,
  conversationId: string,
): Promise<void> {
  await supabase
    .from("drafts")
    .update({ status: "confirmed" })
    .eq("id", draftId);

  await supabase
    .from("conversations")
    .update({ conv_state: "normal" })
    .eq("id", conversationId);
}

export async function discardDraft(
  draftId: string,
  conversationId: string,
): Promise<void> {
  await supabase
    .from("drafts")
    .update({ status: "discarded" })
    .eq("id", draftId);

  await supabase
    .from("conversations")
    .update({ conv_state: "normal" })
    .eq("id", conversationId);
}

export async function getConversationState(
  conversationId: string,
): Promise<"normal" | "awaiting_confirmation"> {
  const { data } = await supabase
    .from("conversations")
    .select("conv_state")
    .eq("id", conversationId)
    .single();

  return (data?.conv_state as "normal" | "awaiting_confirmation") ?? "normal";
}

/** Get summaries of recently confirmed/discarded drafts to prevent re-extraction */
export async function getRecentDraftSummaries(
  conversationId: string,
  limit = 2,
): Promise<string[]> {
  const { data } = await supabase
    .from("drafts")
    .select("summary_text, status")
    .eq("conversation_id", conversationId)
    .in("status", ["confirmed", "discarded"])
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(
    (d) => `[${d.status === "confirmed" ? "GUARDADO" : "DESCARTADO"}] ${d.summary_text}`,
  );
}
