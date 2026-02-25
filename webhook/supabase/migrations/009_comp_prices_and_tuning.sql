-- Add competitor price claim type
ALTER TABLE public.claims DROP CONSTRAINT claims_claim_type_check;
ALTER TABLE public.claims ADD CONSTRAINT claims_claim_type_check
  CHECK (claim_type IN (
    'MONTHLY_VOLUME_KG',
    'PRICE_NET_CLP_PER_KG',
    'COMP_PRICE_NET_CLP_PER_KG',
    'CURRENT_SUPPLIER',
    'QUALITY_SEGMENT',
    'GLAZE_LEVEL',
    'PAYMENT_TERMS_DAYS'
  ));
