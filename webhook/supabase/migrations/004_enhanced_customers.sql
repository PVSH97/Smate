-- SMate: Enhanced customer model with fuzzy matching
-- pg_trgm, normalized names, RUT handling, customer aliases, fuzzy search RPC

-- ============================================================
-- Enable pg_trgm extension
-- ============================================================
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ============================================================
-- CUSTOMERS: add structured fields
-- ============================================================
alter table public.customers
  add column customer_code text,
  add column customer_code_type text,
  add column rut text,
  add column rut_clean text,
  add column trade_name text,
  add column legal_name text,
  add column name_norm text,
  add column trade_name_norm text,
  add column legal_name_norm text,
  add column person_type text check (person_type in ('natural', 'juridica')),
  add column address_street text,
  add column address_number text,
  add column address_commune text,
  add column address_city text,
  add column address_geo point;

-- ============================================================
-- CUSTOMER ALIASES: alternative names for fuzzy matching
-- ============================================================
create table public.customer_aliases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  alias text not null,
  alias_norm text,
  created_at timestamptz not null default now()
);
alter table public.customer_aliases enable row level security;
create index idx_customer_aliases_customer on public.customer_aliases(customer_id);

-- ============================================================
-- SQL FUNCTIONS: normalization helpers
-- ============================================================

-- Normalize a name: lowercase, strip accents, collapse whitespace
create or replace function public.normalize_name(input text)
returns text as $$
begin
  return trim(regexp_replace(
    lower(unaccent(coalesce(input, ''))),
    '\s+', ' ', 'g'
  ));
end;
$$ language plpgsql immutable;

-- Clean a RUT: remove dots, dashes, spaces → "12345678K"
create or replace function public.clean_rut(input text)
returns text as $$
begin
  return upper(regexp_replace(coalesce(input, ''), '[.\-\s]', '', 'g'));
end;
$$ language plpgsql immutable;

-- ============================================================
-- TRIGGERS: auto-normalize on insert/update
-- ============================================================

create or replace function public.customers_normalize()
returns trigger as $$
begin
  new.name_norm := public.normalize_name(new.name);
  new.trade_name_norm := public.normalize_name(new.trade_name);
  new.legal_name_norm := public.normalize_name(new.legal_name);
  if new.rut is not null then
    new.rut_clean := public.clean_rut(new.rut);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger customers_normalize_trg
  before insert or update on public.customers
  for each row execute function public.customers_normalize();

-- Normalize aliases
create or replace function public.customer_aliases_normalize()
returns trigger as $$
begin
  new.alias_norm := public.normalize_name(new.alias);
  return new;
end;
$$ language plpgsql;

create trigger customer_aliases_normalize_trg
  before insert or update on public.customer_aliases
  for each row execute function public.customer_aliases_normalize();

-- ============================================================
-- INDEXES: trigram for fuzzy search
-- ============================================================
create index idx_customers_name_trgm on public.customers using gin (name_norm gin_trgm_ops);
create index idx_customers_trade_name_trgm on public.customers using gin (trade_name_norm gin_trgm_ops);
create index idx_customers_legal_name_trgm on public.customers using gin (legal_name_norm gin_trgm_ops);
create index idx_customers_rut_clean on public.customers(rut_clean) where rut_clean is not null;
create index idx_customer_aliases_trgm on public.customer_aliases using gin (alias_norm gin_trgm_ops);

-- ============================================================
-- RPC: fuzzy search across customers + aliases
-- Returns top 3 matches with confidence score
-- ============================================================
create or replace function public.search_customers_fuzzy(
  p_org_id uuid,
  p_query text,
  p_phone text default null,
  p_rut text default null
)
returns table(
  customer_id uuid,
  name text,
  trade_name text,
  phone text,
  rut text,
  confidence real,
  match_source text
) as $$
declare
  v_query_norm text := public.normalize_name(p_query);
  v_rut_clean text := public.clean_rut(p_rut);
begin
  -- 1. Exact phone match
  if p_phone is not null then
    return query
      select c.id, c.name, c.trade_name, c.phone, c.rut, 1.0::real, 'phone'::text
      from public.customers c
      where c.org_id = p_org_id and c.phone = p_phone
      limit 1;
    if found then return; end if;
  end if;

  -- 2. Exact RUT match
  if v_rut_clean is not null and v_rut_clean != '' then
    return query
      select c.id, c.name, c.trade_name, c.phone, c.rut, 1.0::real, 'rut'::text
      from public.customers c
      where c.org_id = p_org_id and c.rut_clean = v_rut_clean
      limit 1;
    if found then return; end if;
  end if;

  -- 3. Fuzzy search on name fields + aliases
  if v_query_norm != '' then
    return query
      select distinct on (sub.customer_id)
        sub.customer_id, sub.name, sub.trade_name, sub.phone, sub.rut, sub.confidence, sub.match_source
      from (
        -- Match on customer name fields
        select c.id as customer_id, c.name, c.trade_name, c.phone, c.rut,
          greatest(
            similarity(c.name_norm, v_query_norm),
            similarity(c.trade_name_norm, v_query_norm),
            similarity(c.legal_name_norm, v_query_norm)
          )::real as confidence,
          'name'::text as match_source
        from public.customers c
        where c.org_id = p_org_id
          and (
            c.name_norm % v_query_norm
            or c.trade_name_norm % v_query_norm
            or c.legal_name_norm % v_query_norm
          )

        union all

        -- Match on aliases
        select c.id, c.name, c.trade_name, c.phone, c.rut,
          similarity(a.alias_norm, v_query_norm)::real,
          'alias'::text
        from public.customer_aliases a
        join public.customers c on c.id = a.customer_id
        where c.org_id = p_org_id and a.alias_norm % v_query_norm
      ) sub
      order by sub.customer_id, sub.confidence desc
      limit 3;
  end if;
end;
$$ language plpgsql stable;

-- Back-fill normalized fields for existing customers
update public.customers set
  name_norm = public.normalize_name(name),
  trade_name_norm = public.normalize_name(trade_name),
  legal_name_norm = public.normalize_name(legal_name);
