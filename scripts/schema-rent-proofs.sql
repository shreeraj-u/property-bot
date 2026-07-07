-- Rent payment proof submissions
-- Run in Supabase SQL editor. Create storage bucket separately (see bottom).

CREATE TABLE IF NOT EXISTS rent_payment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rent_payment_id UUID NOT NULL REFERENCES rent_payments(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  payment_month TEXT NOT NULL,
  proof_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,
  twilio_media_sid TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_payment_submissions_one_pending
  ON rent_payment_submissions (rent_payment_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_rent_payment_submissions_status
  ON rent_payment_submissions (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_rent_payment_submissions_tenant
  ON rent_payment_submissions (tenant_id, submitted_at DESC);

ALTER TABLE rent_payments
  ADD COLUMN IF NOT EXISTS proof_submission_id UUID
  REFERENCES rent_payment_submissions(id) ON DELETE SET NULL;

-- Storage buckets (Supabase Dashboard > Storage > New bucket):
--   1. rent-payment-proofs  (private, no public access)
--   2. lease-agreements     (private, if not already created)
--
-- Path conventions:
--   rent-payment-proofs: {tenant_id}/{YYYY-MM}/{submission_id}.{ext}
--   lease-agreements:    {unit_number}/{lease_id}.pdf
--
-- Access via signed URLs only (service role in bot). No RLS policies needed for service role.
