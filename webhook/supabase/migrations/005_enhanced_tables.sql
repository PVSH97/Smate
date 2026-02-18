-- SMate: Enhanced tables for full 12-tool set
-- Visits: objections, next_visit_requirements, org_id
-- Opportunities: Spanish stages, probability, next_step
-- Customer briefs: full enhanced fields
-- Tasks: integer priority, snoozed status

-- ============================================================
-- VISITS: add objections, requirements, org_id
-- ============================================================
alter table public.visits
  add column objections text[] not null default '{}',
  add column next_visit_requirements text[] not null default '{}',
  add column org_id uuid references public.orgs(id) on delete cascade;

-- Backfill org_id from customer
update public.visits v
  set org_id = c.org_id
  from public.customers c
  where v.customer_id = c.id and v.org_id is null;

-- ============================================================
-- OPPORTUNITIES: Spanish stages, enhanced fields
-- ============================================================

-- Drop old check constraint and add new columns
alter table public.opportunities
  drop constraint if exists opportunities_status_check;

alter table public.opportunities
  rename column status to stage;

alter table public.opportunities
  add constraint opportunities_stage_check
    check (stage in ('exploracion', 'muestra', 'cotizacion', 'negociacion', 'cerrada', 'perdida'));

-- Migrate old English values to Spanish
update public.opportunities set stage = case
  when stage = 'identified' then 'exploracion'
  when stage = 'qualifying' then 'muestra'
  when stage = 'proposing' then 'cotizacion'
  when stage = 'won' then 'cerrada'
  when stage = 'lost' then 'perdida'
  else 'exploracion'
end;

alter table public.opportunities
  add column probability real,
  add column reason_no_progress text,
  add column next_step text,
  add column org_id uuid references public.orgs(id) on delete cascade;

-- Backfill org_id
update public.opportunities o
  set org_id = c.org_id
  from public.customers c
  where o.customer_id = c.id and o.org_id is null;

-- ============================================================
-- CUSTOMER BRIEFS: enhanced fields
-- ============================================================
alter table public.customer_briefs
  add column objective text,
  add column talk_tracks text[] not null default '{}',
  add column recommended_offer text,
  add column alternatives text[] not null default '{}',
  add column risks text[] not null default '{}',
  add column required_assets text[] not null default '{}',
  add column open_questions text[] not null default '{}',
  add column reference_ids uuid[] not null default '{}',
  add column org_id uuid references public.orgs(id) on delete cascade;

-- Backfill org_id
update public.customer_briefs b
  set org_id = c.org_id
  from public.customers c
  where b.customer_id = c.id and b.org_id is null;

-- ============================================================
-- TASKS: integer priority (1-5), snoozed status
-- ============================================================

-- Drop old check + default, change priority to integer
alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks alter column priority drop default;

-- Convert text priorities to integers
alter table public.tasks alter column priority type integer using (case
  when priority = 'low' then 1
  when priority = 'medium' then 3
  when priority = 'high' then 4
  when priority = 'urgent' then 5
  else 3
end);

alter table public.tasks alter column priority set default 3;

alter table public.tasks
  add constraint tasks_priority_check check (priority between 1 and 5);

-- Add snoozed status
alter table public.tasks
  drop constraint if exists tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check
    check (status in ('pending', 'in_progress', 'done', 'cancelled', 'snoozed'));

alter table public.tasks
  add column snoozed_until timestamptz;
