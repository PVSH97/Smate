-- SMate: Approval Workflow Module
-- 3 new tables, indexes, RLS, triggers, SLA config, seed data

-- ============================================================
-- TABLE: approval_providers
-- ============================================================

create table public.approval_providers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  provider_type text not null check (provider_type in (
    'CREDIT_INSURER', 'BANK_FINANCER', 'INTERNAL_CREDIT',
    'RISK_BUREAU', 'COMPLIANCE', 'OTHER'
  )),
  notes       text,
  created_at  timestamptz not null default now(),
  unique(org_id, name)
);

alter table public.approval_providers enable row level security;

create index idx_approval_providers_org on public.approval_providers(org_id);

-- ============================================================
-- TABLE: approval_requests
-- ============================================================

create table public.approval_requests (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs(id) on delete cascade,
  customer_id               uuid not null references public.customers(id) on delete cascade,
  provider_id               uuid references public.approval_providers(id) on delete set null,
  conversation_id           uuid references public.conversations(id) on delete set null,
  request_type              text not null check (request_type in (
    'CREDIT_LIMIT', 'CREDIT_INCREASE', 'PAYMENT_TERMS',
    'FINANCING', 'COMPLIANCE_APPROVAL', 'OTHER'
  )),
  requested_amount          numeric,
  requested_unit            text,
  submitted_at              date not null default current_date,
  status                    text not null default 'SUBMITTED' check (status in (
    'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PARTIAL_APPROVED',
    'REJECTED', 'APPEALED', 'CLOSED'
  )),
  authorized_amount         numeric,
  authorized_unit           text,
  internal_operational_limit numeric,
  internal_limit_unit       text,
  decision_date             date,
  decision_reason           text,
  next_action               text,
  priority                  integer not null default 3 check (priority between 1 and 5),
  source_message_id         uuid references public.messages(id) on delete set null,
  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.approval_requests enable row level security;

create index idx_approval_requests_customer on public.approval_requests(customer_id, status);
create index idx_approval_requests_org_status on public.approval_requests(org_id, status, submitted_at desc);
create index idx_approval_requests_provider on public.approval_requests(provider_id);

-- updated_at trigger
create trigger set_approval_requests_updated_at
  before update on public.approval_requests
  for each row execute function public.update_updated_at();

-- ============================================================
-- TABLE: approval_request_events
-- ============================================================

create table public.approval_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.approval_requests(id) on delete cascade,
  event_type  text not null check (event_type in (
    'SUBMITTED', 'FOLLOWED_UP', 'DECISION_RECEIVED',
    'INTERNAL_LIMIT_SET', 'DOCS_REQUESTED', 'APPEAL_SUBMITTED',
    'APPEAL_RESOLVED', 'NOTE'
  )),
  description text,
  metadata    jsonb default '{}',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.approval_request_events enable row level security;

create index idx_approval_events_request on public.approval_request_events(request_id, created_at desc);

-- ============================================================
-- SLA CONFIG
-- ============================================================

update public.orgs
set settings = coalesce(settings, '{}'::jsonb) || '{"approval_sla": {"followup_days": 7, "appeal_days": 3}}'::jsonb
where id = 'a0000000-0000-0000-0000-000000000001';

-- ============================================================
-- SEED DATA
-- ============================================================

insert into public.approval_providers (org_id, name, provider_type) values
  ('a0000000-0000-0000-0000-000000000001', 'Solunion', 'CREDIT_INSURER'),
  ('a0000000-0000-0000-0000-000000000001', 'Coface', 'CREDIT_INSURER'),
  ('a0000000-0000-0000-0000-000000000001', 'Comité Interno', 'INTERNAL_CREDIT');
