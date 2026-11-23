-- Hand-written: the new AOD statuses can only be used once the previous migration has committed them.
ALTER TABLE "inventory"."aod" DROP CONSTRAINT "aod_number_when_issued";
ALTER TABLE "inventory"."aod" ADD CONSTRAINT "aod_number_when_issued"
  CHECK ("status" IN ('PICKING', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED') OR "number" IS NOT NULL);
ALTER TABLE "inventory"."aod" ADD CONSTRAINT "aod_pending_needs_submitter"
  CHECK ("status" <> 'PENDING_APPROVAL' OR ("submitted_by" IS NOT NULL AND "submitted_at" IS NOT NULL));
ALTER TABLE "inventory"."aod" ADD CONSTRAINT "aod_approved_needs_approver"
  CHECK ("status" <> 'APPROVED' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));
