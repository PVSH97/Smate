import { supabase } from "../lib/supabase.js";

// ============================================================
// Resolution helpers (webhook flow)
// ============================================================

export async function resolveWaIdentity(
  phoneNumberId: string,
): Promise<{ id: string; orgId: string } | null> {
  const { data, error } = await supabase
    .from("wa_identities")
    .select("id, org_id")
    .eq("phone_number_id", phoneNumberId)
    .single();

  if (error) {
    console.error(`[db] resolveWaIdentity error:`, error.message, error.code);
    return null;
  }
  if (!data) return null;
  return { id: data.id, orgId: data.org_id };
}

export async function resolveCustomer(
  orgId: string,
  phone: string,
  contactName?: string,
): Promise<{ id: string; name: string | null }> {
  // Try to find existing customer
  const { data: existing } = await supabase
    .from("customers")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("phone", phone)
    .single();

  if (existing) {
    // Update name if we didn't have one
    if (!existing.name && contactName) {
      await supabase
        .from("customers")
        .update({ name: contactName })
        .eq("id", existing.id);
    }
    return { id: existing.id, name: existing.name ?? contactName ?? null };
  }

  // Create new customer
  const { data: created, error } = await supabase
    .from("customers")
    .insert({ org_id: orgId, phone, name: contactName })
    .select("id, name")
    .single();

  if (error) throw new Error(`Failed to create customer: ${error.message}`);
  return { id: created!.id, name: created!.name };
}

export async function resolveConversation(
  customerId: string,
  waIdentityId: string,
): Promise<string> {
  // Find active conversation
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("customer_id", customerId)
    .eq("wa_identity_id", waIdentityId)
    .eq("status", "active")
    .single();

  if (existing) return existing.id;

  // Create new conversation
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ customer_id: customerId, wa_identity_id: waIdentityId })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return created!.id;
}

// ============================================================
// Message persistence
// ============================================================

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  waMessageId?: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      wa_message_id: waMessageId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save message: ${error.message}`);

  // Update conversation's last_message_at
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data!.id;
}

export async function getConversationHistory(
  conversationId: string,
  limit = 20,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []) as Array<{ role: "user" | "assistant"; content: string }>;
}

// ============================================================
// Tool implementations
// ============================================================

export interface ToolContext {
  customerId: string;
  conversationId: string;
  orgId: string;
}

export async function lookupCustomer(
  ctx: ToolContext,
  input: { phone?: string; name?: string },
): Promise<object> {
  let query = supabase
    .from("customers")
    .select("id, phone, name, business_name, industry, metadata, created_at")
    .eq("org_id", ctx.orgId);

  if (input.phone) {
    query = query.eq("phone", input.phone);
  } else if (input.name) {
    query = query.or(
      `name.ilike.%${input.name}%,business_name.ilike.%${input.name}%`,
    );
  }

  const { data } = await query.limit(5);
  return { customers: data ?? [], count: data?.length ?? 0 };
}

export async function saveExtraction(
  ctx: ToolContext,
  input: { extraction_type: string; data: object; confidence?: number },
): Promise<object> {
  const { data, error } = await supabase
    .from("extractions")
    .insert({
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      extraction_type: input.extraction_type,
      data: input.data,
      confidence: input.confidence,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function logVisit(
  ctx: ToolContext,
  input: {
    summary: string;
    key_points: string[];
    next_steps?: string[];
    visited_at?: string;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("visits")
    .insert({
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      summary: input.summary,
      key_points: input.key_points,
      next_steps: input.next_steps ?? [],
      visited_at: input.visited_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function createTask(
  ctx: ToolContext,
  input: {
    title: string;
    description?: string;
    priority?: string;
    due_date?: string;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: ctx.orgId,
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? "medium",
      due_date: input.due_date,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function saveSignal(
  ctx: ToolContext,
  input: { signal_type: string; content: string },
): Promise<object> {
  const { data, error } = await supabase
    .from("customer_signals")
    .insert({
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      signal_type: input.signal_type,
      content: input.content,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function savePurchase(
  ctx: ToolContext,
  input: {
    product: string;
    supplier?: string;
    unit_price?: number;
    quantity?: number;
    unit?: string;
    total?: number;
    purchased_at?: string;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("customer_purchases")
    .insert({
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      product: input.product,
      supplier: input.supplier,
      unit_price: input.unit_price,
      quantity: input.quantity,
      unit: input.unit,
      total:
        input.total ??
        (input.unit_price && input.quantity
          ? input.unit_price * input.quantity
          : undefined),
      purchased_at: input.purchased_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}
