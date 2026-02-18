-- SMate: Claims system + SKU packaging
-- Normalized commercial claims (volume, price, supplier, etc.) + case-weight lookups

-- ============================================================
-- CLAIMS: append-only commercial intelligence
-- ============================================================
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  claim_type text not null check (claim_type in (
    'MONTHLY_VOLUME_KG',
    'PRICE_NET_CLP_PER_KG',
    'CURRENT_SUPPLIER',
    'QUALITY_SEGMENT',
    'GLAZE_LEVEL',
    'PAYMENT_TERMS_DAYS'
  )),
  -- Product context
  product_name text,
  product_spec text,
  product_format text,
  product_origin text,
  product_supplier text,
  -- Normalized value
  value_normalized numeric,
  value_unit text,
  -- Raw value for audit trail
  raw_value text not null,
  raw_unit text,
  conversion_factor numeric default 1,
  -- Metadata
  observed_at timestamptz not null default now(),
  source text not null default 'whatsapp',
  confidence real,
  created_at timestamptz not null default now()
);
alter table public.claims enable row level security;
create index idx_claims_customer on public.claims(customer_id);
create index idx_claims_org on public.claims(org_id);
create index idx_claims_type on public.claims(claim_type);
create index idx_claims_product on public.claims(product_name) where product_name is not null;
create index idx_claims_observed on public.claims(customer_id, claim_type, observed_at desc);

-- ============================================================
-- SKU PACKAGING: case weight lookups
-- ============================================================
create table public.sku_packaging (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  sku text not null,
  case_weight_kg numeric not null,
  units_per_case integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, sku)
);
alter table public.sku_packaging enable row level security;
create index idx_sku_packaging_org on public.sku_packaging(org_id);
create trigger sku_packaging_updated_at before update on public.sku_packaging
  for each row execute function public.update_updated_at();
