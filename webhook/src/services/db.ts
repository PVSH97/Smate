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
  limit = 6,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // Fetch most recent messages (descending), then reverse to chronological
  const { data } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = ((data ?? []) as Array<{ role: "user" | "assistant"; content: string }>).reverse();

  // Merge consecutive same-role messages (Anthropic requires alternating roles)
  const merged: typeof rows = [];
  for (const row of rows) {
    const last = merged[merged.length - 1];
    if (last && last.role === row.role) {
      last.content += `\n${row.content}`;
    } else {
      merged.push({ ...row });
    }
  }

  return merged;
}

export async function searchMessages(
  conversationId: string,
  query: string,
): Promise<Array<{ role: string; content: string; created_at: string }>> {
  const tsQuery = query.split(/\s+/).join(" & ");
  const { data } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .textSearch("content_tsv", tsQuery, { config: "spanish" })
    .order("created_at", { ascending: false })
    .limit(10);

  return (data ?? []) as Array<{
    role: string;
    content: string;
    created_at: string;
  }>;
}

// ============================================================
// Tool implementations
// ============================================================

export interface ToolContext {
  customerId: string;
  conversationId: string;
  orgId: string;
}

export async function findCustomer(
  ctx: ToolContext,
  input: { query: string; phone?: string; rut?: string },
): Promise<object> {
  const { data, error } = await supabase.rpc("search_customers_fuzzy", {
    p_org_id: ctx.orgId,
    p_query: input.query,
    p_phone: input.phone ?? null,
    p_rut: input.rut ?? null,
  });

  if (error) return { results: [], error: error.message };
  return { results: data ?? [], count: (data as unknown[])?.length ?? 0 };
}

export async function createCustomerTool(
  ctx: ToolContext,
  input: {
    phone?: string;
    name: string;
    trade_name?: string;
    legal_name?: string;
    rut?: string;
    person_type?: string;
    industry?: string;
    address_commune?: string;
    address_city?: string;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      org_id: ctx.orgId,
      phone: input.phone ?? `unknown-${Date.now()}`,
      name: input.name,
      trade_name: input.trade_name,
      legal_name: input.legal_name,
      rut: input.rut,
      person_type: input.person_type,
      industry: input.industry,
      address_commune: input.address_commune,
      address_city: input.address_city,
    })
    .select("id, name, phone")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, customer: data };
}

export async function getCustomerCard(
  ctx: ToolContext,
  input: { customer_id: string },
): Promise<object> {
  const [customer, claims, signals, tasks, opportunities] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, phone, name, trade_name, legal_name, rut, industry, person_type, address_commune, address_city, created_at",
      )
      .eq("id", input.customer_id)
      .single(),
    supabase
      .from("claims")
      .select(
        "claim_type, product_name, value_normalized, value_unit, raw_value, observed_at, confidence",
      )
      .eq("customer_id", input.customer_id)
      .order("observed_at", { ascending: false })
      .limit(20),
    supabase
      .from("customer_signals")
      .select("signal_type, content, created_at")
      .eq("customer_id", input.customer_id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("tasks")
      .select("title, priority, status, due_date")
      .eq("customer_id", input.customer_id)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("opportunities")
      .select("title, status, estimated_value, confidence")
      .eq("customer_id", input.customer_id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    customer: customer.data,
    claims: claims.data ?? [],
    signals: signals.data ?? [],
    open_tasks: tasks.data ?? [],
    opportunities: opportunities.data ?? [],
  };
}

export async function createClaims(
  ctx: ToolContext,
  input: {
    claims: Array<{
      claim_type: string;
      product_name?: string;
      product_spec?: string;
      product_format?: string;
      product_origin?: string;
      product_supplier?: string;
      value_normalized?: number;
      value_unit?: string;
      raw_value: string;
      raw_unit?: string;
      conversion_factor?: number;
      observed_at?: string;
      source?: string;
      confidence?: number;
    }>;
  },
): Promise<object> {
  const rows = input.claims.map((c) => ({
    customer_id: ctx.customerId,
    org_id: ctx.orgId,
    conversation_id: ctx.conversationId,
    claim_type: c.claim_type,
    product_name: c.product_name,
    product_spec: c.product_spec,
    product_format: c.product_format,
    product_origin: c.product_origin,
    product_supplier: c.product_supplier,
    value_normalized: c.value_normalized,
    value_unit: c.value_unit,
    raw_value: c.raw_value,
    raw_unit: c.raw_unit,
    conversion_factor: c.conversion_factor ?? 1,
    observed_at: c.observed_at ?? new Date().toISOString(),
    source: c.source ?? "whatsapp",
    confidence: c.confidence,
  }));

  const { data, error } = await supabase
    .from("claims")
    .insert(rows)
    .select("id");

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    count: data?.length ?? 0,
    ids: data?.map((r) => r.id),
  };
}

export async function upsertSkuPackaging(
  ctx: ToolContext,
  input: {
    sku: string;
    case_weight_kg: number;
    units_per_case?: number;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("sku_packaging")
    .upsert(
      {
        org_id: ctx.orgId,
        sku: input.sku,
        case_weight_kg: input.case_weight_kg,
        units_per_case: input.units_per_case,
      },
      { onConflict: "org_id,sku" },
    )
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

// ============================================================
// Enhanced tools (Phase 4) — batch + enriched
// ============================================================

export async function createVisit(
  ctx: ToolContext,
  input: {
    summary: string;
    key_points: string[];
    next_steps?: string[];
    objections?: string[];
    next_visit_requirements?: string[];
    visited_at?: string;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("visits")
    .insert({
      customer_id: ctx.customerId,
      org_id: ctx.orgId,
      conversation_id: ctx.conversationId,
      summary: input.summary,
      key_points: input.key_points,
      next_steps: input.next_steps ?? [],
      objections: input.objections ?? [],
      next_visit_requirements: input.next_visit_requirements ?? [],
      visited_at: input.visited_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function createTasks(
  ctx: ToolContext,
  input: {
    tasks: Array<{
      title: string;
      description?: string;
      priority?: number;
      due_date?: string;
    }>;
  },
): Promise<object> {
  const rows = input.tasks.map((t) => ({
    org_id: ctx.orgId,
    customer_id: ctx.customerId,
    conversation_id: ctx.conversationId,
    title: t.title,
    description: t.description,
    priority: t.priority ?? 3,
    due_date: t.due_date,
  }));

  const { data, error } = await supabase
    .from("tasks")
    .insert(rows)
    .select("id");

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    count: data?.length ?? 0,
    ids: data?.map((r) => r.id),
  };
}

export async function createSignals(
  ctx: ToolContext,
  input: {
    signals: Array<{
      signal_type: string;
      content: string;
    }>;
  },
): Promise<object> {
  const rows = input.signals.map((s) => ({
    customer_id: ctx.customerId,
    conversation_id: ctx.conversationId,
    signal_type: s.signal_type,
    content: s.content,
  }));

  const { data, error } = await supabase
    .from("customer_signals")
    .insert(rows)
    .select("id");

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    count: data?.length ?? 0,
    ids: data?.map((r) => r.id),
  };
}

export async function createOpportunity(
  ctx: ToolContext,
  input: {
    title: string;
    description?: string;
    stage?: string;
    estimated_value?: number;
    probability?: number;
    reason_no_progress?: string;
    next_step?: string;
    confidence?: number;
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      customer_id: ctx.customerId,
      org_id: ctx.orgId,
      title: input.title,
      description: input.description,
      stage: input.stage ?? "exploracion",
      estimated_value: input.estimated_value,
      probability: input.probability,
      reason_no_progress: input.reason_no_progress,
      next_step: input.next_step,
      confidence: input.confidence,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function createCustomerBrief(
  ctx: ToolContext,
  input: {
    brief: string;
    key_facts?: object[];
    objective?: string;
    talk_tracks?: string[];
    recommended_offer?: string;
    alternatives?: string[];
    risks?: string[];
    required_assets?: string[];
    open_questions?: string[];
    reference_ids?: string[];
  },
): Promise<object> {
  const { data, error } = await supabase
    .from("customer_briefs")
    .insert({
      customer_id: ctx.customerId,
      org_id: ctx.orgId,
      brief: input.brief,
      key_facts: input.key_facts ?? [],
      objective: input.objective,
      talk_tracks: input.talk_tracks ?? [],
      recommended_offer: input.recommended_offer,
      alternatives: input.alternatives ?? [],
      risks: input.risks ?? [],
      required_assets: input.required_assets ?? [],
      open_questions: input.open_questions ?? [],
      reference_ids: input.reference_ids ?? [],
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}
