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

  const rows = (
    (data ?? []) as Array<{ role: "user" | "assistant"; content: string }>
  ).reverse();

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
  const [customer, claims, signals, tasks, opportunities, approvalRequests] =
    await Promise.all([
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
      supabase
        .from("approval_requests")
        .select(
          "id, status, request_type, requested_amount, requested_unit, authorized_amount, authorized_unit, submitted_at, provider_id",
        )
        .eq("customer_id", input.customer_id)
        .order("submitted_at", { ascending: false })
        .limit(5),
    ]);

  return {
    customer: customer.data,
    claims: claims.data ?? [],
    signals: signals.data ?? [],
    open_tasks: tasks.data ?? [],
    opportunities: opportunities.data ?? [],
    approval_requests: approvalRequests.data ?? [],
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

// ============================================================
// Approval workflow
// ============================================================

export async function getApprovalRequests(
  ctx: ToolContext,
  input: { customer_id?: string; status?: string; limit?: number },
): Promise<object> {
  let query = supabase
    .from("approval_requests")
    .select(
      "id, customer_id, provider_id, request_type, requested_amount, requested_unit, submitted_at, status, authorized_amount, authorized_unit, internal_operational_limit, internal_limit_unit, decision_date, decision_reason, next_action, priority",
    )
    .eq("org_id", ctx.orgId)
    .order("submitted_at", { ascending: false })
    .limit(input.limit ?? 20);

  if (input.customer_id) query = query.eq("customer_id", input.customer_id);
  if (input.status) query = query.eq("status", input.status);

  const { data: requests, error } = await query;
  if (error) return { requests: [], error: error.message };

  const requestIds = (requests ?? []).map((r) => r.id);
  const providerIds = [
    ...new Set((requests ?? []).map((r) => r.provider_id).filter(Boolean)),
  ];

  const [providers, events] = await Promise.all([
    providerIds.length > 0
      ? supabase
          .from("approval_providers")
          .select("id, name")
          .in("id", providerIds)
      : Promise.resolve({ data: [] }),
    requestIds.length > 0
      ? supabase
          .from("approval_request_events")
          .select("request_id, event_type, description, created_at")
          .in("request_id", requestIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const providerMap = new Map(
    (providers.data ?? []).map((p) => [p.id, p.name]),
  );
  const latestEventMap = new Map<string, object>();
  for (const e of events.data ?? []) {
    if (!latestEventMap.has(e.request_id)) latestEventMap.set(e.request_id, e);
  }

  const enriched = (requests ?? []).map((r) => ({
    ...r,
    provider_name: providerMap.get(r.provider_id) ?? null,
    latest_event: latestEventMap.get(r.id) ?? null,
  }));

  return { requests: enriched, count: enriched.length };
}

export async function listApprovalProviders(ctx: ToolContext): Promise<object> {
  const { data, error } = await supabase
    .from("approval_providers")
    .select("id, name, provider_type, notes")
    .eq("org_id", ctx.orgId)
    .order("name");

  if (error) return { providers: [], error: error.message };
  return { providers: data ?? [] };
}

export async function createApprovalProvider(
  ctx: ToolContext,
  input: { name: string; provider_type: string; notes?: string },
): Promise<object> {
  const { data, error } = await supabase
    .from("approval_providers")
    .insert({
      org_id: ctx.orgId,
      name: input.name,
      provider_type: input.provider_type,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data!.id };
}

export async function createApprovalRequest(
  ctx: ToolContext,
  input: {
    provider_id?: string;
    provider_name?: string;
    request_type: string;
    requested_amount?: number;
    requested_unit?: string;
    submitted_at?: string;
    next_action?: string;
    priority?: number;
  },
): Promise<object> {
  let providerId = input.provider_id;
  if (!providerId && input.provider_name) {
    const { data: provider } = await supabase
      .from("approval_providers")
      .select("id")
      .eq("org_id", ctx.orgId)
      .ilike("name", input.provider_name)
      .limit(1)
      .single();
    providerId = provider?.id ?? undefined;
  }

  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      org_id: ctx.orgId,
      customer_id: ctx.customerId,
      provider_id: providerId,
      conversation_id: ctx.conversationId,
      request_type: input.request_type,
      requested_amount: input.requested_amount,
      requested_unit: input.requested_unit,
      submitted_at: input.submitted_at ?? new Date().toISOString().slice(0, 10),
      next_action: input.next_action,
      priority: input.priority ?? 3,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };

  await supabase.from("approval_request_events").insert({
    request_id: data!.id,
    event_type: "SUBMITTED",
    description: `Solicitud ${input.request_type} creada${input.requested_amount ? ` por ${input.requested_amount} ${input.requested_unit ?? ""}` : ""}`,
  });

  return { success: true, id: data!.id };
}

export async function updateApprovalRequest(
  ctx: ToolContext,
  input: {
    request_id: string;
    status?: string;
    authorized_amount?: number;
    authorized_unit?: string;
    internal_operational_limit?: number;
    internal_limit_unit?: string;
    decision_date?: string;
    decision_reason?: string;
    next_action?: string;
  },
): Promise<object> {
  const updates: Record<string, unknown> = {};
  if (input.status) updates.status = input.status;
  if (input.authorized_amount !== undefined)
    updates.authorized_amount = input.authorized_amount;
  if (input.authorized_unit) updates.authorized_unit = input.authorized_unit;
  if (input.internal_operational_limit !== undefined)
    updates.internal_operational_limit = input.internal_operational_limit;
  if (input.internal_limit_unit)
    updates.internal_limit_unit = input.internal_limit_unit;
  if (input.decision_date) updates.decision_date = input.decision_date;
  if (input.decision_reason) updates.decision_reason = input.decision_reason;
  if (input.next_action !== undefined) updates.next_action = input.next_action;

  const { error } = await supabase
    .from("approval_requests")
    .update(updates)
    .eq("id", input.request_id)
    .eq("org_id", ctx.orgId);

  if (error) return { success: false, error: error.message };

  if (input.status) {
    const eventTypeMap: Record<string, string> = {
      APPROVED: "DECISION_RECEIVED",
      PARTIAL_APPROVED: "DECISION_RECEIVED",
      REJECTED: "DECISION_RECEIVED",
      APPEALED: "APPEAL_SUBMITTED",
      IN_REVIEW: "NOTE",
      CLOSED: "NOTE",
    };
    const eventType = eventTypeMap[input.status] ?? "NOTE";
    await supabase.from("approval_request_events").insert({
      request_id: input.request_id,
      event_type: eventType,
      description: `Estado cambiado a ${input.status}${input.decision_reason ? `: ${input.decision_reason}` : ""}`,
    });
  }

  return { success: true, id: input.request_id };
}

export async function addApprovalEvent(
  ctx: ToolContext,
  input: { request_id: string; event_type: string; description: string },
): Promise<object> {
  const { data, error } = await supabase
    .from("approval_request_events")
    .insert({
      request_id: input.request_id,
      event_type: input.event_type,
      description: input.description,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };

  const statusMap: Record<string, string> = {
    APPEAL_SUBMITTED: "APPEALED",
    APPEAL_RESOLVED: "CLOSED",
  };
  const newStatus = statusMap[input.event_type];
  if (newStatus) {
    await supabase
      .from("approval_requests")
      .update({ status: newStatus })
      .eq("id", input.request_id)
      .eq("org_id", ctx.orgId);
  }

  return { success: true, id: data!.id };
}

// ============================================================
// Generic update tools
// ============================================================

export async function updateTaskStatus(
  ctx: ToolContext,
  input: { task_id: string; status: string; snoozed_until?: string },
): Promise<object> {
  const updates: Record<string, unknown> = { status: input.status };
  if (input.snoozed_until) updates.snoozed_until = input.snoozed_until;

  const { error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", input.task_id)
    .eq("org_id", ctx.orgId);

  if (error) return { success: false, error: error.message };
  return { success: true, id: input.task_id };
}

export async function updateOpportunityStage(
  ctx: ToolContext,
  input: {
    opportunity_id: string;
    stage: string;
    probability?: number;
    reason_no_progress?: string;
    next_step?: string;
  },
): Promise<object> {
  const updates: Record<string, unknown> = { stage: input.stage };
  if (input.probability !== undefined) updates.probability = input.probability;
  if (input.reason_no_progress)
    updates.reason_no_progress = input.reason_no_progress;
  if (input.next_step) updates.next_step = input.next_step;

  const { error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", input.opportunity_id)
    .eq("org_id", ctx.orgId);

  if (error) return { success: false, error: error.message };
  return { success: true, id: input.opportunity_id };
}

export async function updateCustomer(
  ctx: ToolContext,
  input: {
    customer_id: string;
    name?: string;
    trade_name?: string;
    phone?: string;
    rut?: string;
    industry?: string;
    address_commune?: string;
    address_city?: string;
  },
): Promise<object> {
  const updates: Record<string, unknown> = {};
  if (input.name) updates.name = input.name;
  if (input.trade_name) updates.trade_name = input.trade_name;
  if (input.phone) updates.phone = input.phone;
  if (input.rut) updates.rut = input.rut;
  if (input.industry) updates.industry = input.industry;
  if (input.address_commune) updates.address_commune = input.address_commune;
  if (input.address_city) updates.address_city = input.address_city;

  const { error } = await supabase
    .from("customers")
    .update(updates)
    .eq("id", input.customer_id)
    .eq("org_id", ctx.orgId);

  if (error) return { success: false, error: error.message };
  return { success: true, id: input.customer_id };
}
