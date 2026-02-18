-- SMate: Cleanup + Hardening
-- Drop deprecated tables, add dashboard indexes, created_by audit columns

-- ============================================================
-- DROP DEPRECATED TABLES
-- ============================================================

-- customer_purchases → replaced by claims (MONTHLY_VOLUME_KG, PRICE_NET_CLP_PER_KG)
drop table if exists public.customer_purchases;

-- extractions → replaced by claims + signals + structured tools
drop table if exists public.extractions;

-- ============================================================
-- AUDIT: created_by on key tables
-- ============================================================
alter table public.claims
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.visits
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.tasks
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.customer_signals
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.opportunities
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.customer_briefs
  add column created_by uuid references public.profiles(id) on delete set null;

alter table public.drafts
  add column created_by uuid references public.profiles(id) on delete set null;

-- ============================================================
-- DASHBOARD INDEXES
-- ============================================================

-- Claims: latest per customer+type for dashboard cards
create index idx_claims_latest on public.claims(org_id, customer_id, claim_type, observed_at desc);

-- Tasks: open tasks per org for dashboard
create index idx_tasks_open_org on public.tasks(org_id, priority desc, due_date)
  where status in ('pending', 'in_progress');

-- Opportunities: active pipeline per org
create index idx_opportunities_pipeline on public.opportunities(org_id, stage)
  where stage not in ('cerrada', 'perdida');

-- Visits: recent per org
create index idx_visits_org_recent on public.visits(org_id, visited_at desc);

-- Customer briefs: latest per customer
create index idx_briefs_latest on public.customer_briefs(customer_id, generated_at desc);

-- Conversations: active with last message for inbox view
create index idx_conversations_inbox on public.conversations(wa_identity_id, last_message_at desc)
  where status = 'active';
