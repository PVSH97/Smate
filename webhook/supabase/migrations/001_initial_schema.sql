-- SMate: Initial Schema
-- 13 tables for sales intelligence platform
-- Run via Supabase Dashboard > SQL Editor

-- ============================================================
-- HELPER: updated_at trigger function
-- ============================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Organizations (multi-tenant root)
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orgs enable row level security;
create trigger orgs_updated_at before update on public.orgs
  for each row execute function public.update_updated_at();

-- User profiles (linked to Supabase auth)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  full_name text,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index idx_profiles_org on public.profiles(org_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();

-- WhatsApp identities (phone numbers linked to orgs)
create table public.wa_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  phone_number_id text not null unique,
  display_phone text,
  label text,
  created_at timestamptz not null default now()
);
alter table public.wa_identities enable row level security;
create index idx_wa_identities_phone on public.wa_identities(phone_number_id);

-- Customers (contacts from WhatsApp)
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  phone text not null,
  name text,
  business_name text,
  industry text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, phone)
);
alter table public.customers enable row level security;
create index idx_customers_org on public.customers(org_id);
create index idx_customers_phone on public.customers(org_id, phone);
create index idx_customers_name on public.customers(org_id, name);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.update_updated_at();

-- Conversations (thread per customer per WA identity)
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  wa_identity_id uuid not null references public.wa_identities(id) on delete cascade,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create index idx_conversations_customer on public.conversations(customer_id);
create index idx_conversations_wa_identity on public.conversations(wa_identity_id);
create index idx_conversations_active on public.conversations(customer_id, wa_identity_id)
  where status = 'active';
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.update_updated_at();

-- Messages (raw WhatsApp messages)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  wa_message_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index idx_messages_conversation on public.messages(conversation_id, created_at);
create index idx_messages_wa_id on public.messages(wa_message_id) where wa_message_id is not null;

-- ============================================================
-- INTELLIGENCE TABLES
-- ============================================================

-- Extractions (structured JSONB extracted from conversations)
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  extraction_type text not null,
  data jsonb not null default '{}',
  confidence real,
  created_at timestamptz not null default now()
);
alter table public.extractions enable row level security;
create index idx_extractions_customer on public.extractions(customer_id);
create index idx_extractions_type on public.extractions(extraction_type);

-- Visits (sales visit summaries)
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  visited_at timestamptz not null default now(),
  summary text,
  key_points text[] not null default '{}',
  next_steps text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.visits enable row level security;
create index idx_visits_customer on public.visits(customer_id);
create index idx_visits_date on public.visits(visited_at);

-- Tasks (actionable to-dos from conversations)
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  due_date date,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
create index idx_tasks_org on public.tasks(org_id);
create index idx_tasks_customer on public.tasks(customer_id);
create index idx_tasks_status on public.tasks(org_id, status) where status != 'done';
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.update_updated_at();

-- Customer signals (qualitative intelligence)
create table public.customer_signals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  signal_type text not null,
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.customer_signals enable row level security;
create index idx_signals_customer on public.customer_signals(customer_id);
create index idx_signals_type on public.customer_signals(signal_type);

-- Customer purchases (products, suppliers, prices)
create table public.customer_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  product text not null,
  supplier text,
  unit_price numeric,
  quantity numeric,
  unit text,
  total numeric,
  purchased_at timestamptz default now(),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.customer_purchases enable row level security;
create index idx_purchases_customer on public.customer_purchases(customer_id);
create index idx_purchases_product on public.customer_purchases(product);

-- ============================================================
-- DIFFERENTIATION TABLES
-- ============================================================

-- Customer briefs (AI-generated summaries)
create table public.customer_briefs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  brief text not null,
  key_facts jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_briefs enable row level security;
create index idx_briefs_customer on public.customer_briefs(customer_id);
create trigger briefs_updated_at before update on public.customer_briefs
  for each row execute function public.update_updated_at();

-- Opportunities (sales opportunities)
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'identified' check (status in ('identified', 'qualifying', 'proposing', 'won', 'lost')),
  estimated_value numeric,
  confidence real,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.opportunities enable row level security;
create index idx_opportunities_customer on public.opportunities(customer_id);
create index idx_opportunities_status on public.opportunities(status);
create trigger opportunities_updated_at before update on public.opportunities
  for each row execute function public.update_updated_at();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default organization
insert into public.orgs (id, name, settings) values
  ('a0000000-0000-0000-0000-000000000001', 'SMate Default', '{"timezone": "America/Santiago"}');

-- WhatsApp identities (both phone numbers from the project)
insert into public.wa_identities (org_id, phone_number_id, display_phone, label) values
  ('a0000000-0000-0000-0000-000000000001', '1017618681428720', '+56 9 XXXX XXXX', 'Primary');
