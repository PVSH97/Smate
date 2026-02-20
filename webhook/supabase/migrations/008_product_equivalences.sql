-- 008: Product equivalence mapping (org-level competitive intelligence)

CREATE TABLE IF NOT EXISTS product_equivalences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  internal_sku  text NOT NULL,
  competitor_name text NOT NULL,
  competitor_supplier text,
  notes         text,
  confirmed_by_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, internal_sku, competitor_name)
);

CREATE INDEX idx_product_equiv_org        ON product_equivalences (org_id);
CREATE INDEX idx_product_equiv_sku        ON product_equivalences (org_id, internal_sku);
CREATE INDEX idx_product_equiv_competitor ON product_equivalences (org_id, competitor_name);

ALTER TABLE product_equivalences ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_product_equivalences_updated_at
  BEFORE UPDATE ON product_equivalences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
