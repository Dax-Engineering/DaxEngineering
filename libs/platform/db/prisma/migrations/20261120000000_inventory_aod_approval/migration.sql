-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "inventory"."AodStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "inventory"."AodStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "inventory"."aod" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMPTZ(3),
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3),
ADD COLUMN     "submitted_by" UUID;


-- Hand-written: AODs issued before approvals existed count as approved, so their departments keep seeing them.
UPDATE "inventory"."aod" SET "approved_at" = COALESCE("issued_at", "created_at")
WHERE "status" IN ('ISSUED', 'SIGNED');
ALTER TABLE "inventory"."aod" ADD CONSTRAINT "aod_reject_reason_check" CHECK ("reject_reason" IS NULL OR length("reject_reason") BETWEEN 5 AND 300);
