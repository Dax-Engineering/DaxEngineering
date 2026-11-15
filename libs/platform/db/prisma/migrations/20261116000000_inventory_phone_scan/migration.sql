-- CreateEnum
CREATE TYPE "inventory"."PhoneScanStatus" AS ENUM ('WAITING', 'PAIRED', 'ENDED', 'LOCKED');

-- CreateTable
CREATE TABLE "inventory"."phone_scan_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "inventory"."PhoneScanStatus" NOT NULL DEFAULT 'WAITING',
    "link_token_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "phone_token_hash" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paired_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "last_scan_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_scan_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."phone_scan_line" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "item_id" UUID,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_scan_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_scan_session_link_token_hash_key" ON "inventory"."phone_scan_session"("link_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "phone_scan_session_phone_token_hash_key" ON "inventory"."phone_scan_session"("phone_token_hash");

-- CreateIndex
CREATE INDEX "phone_scan_session_user_id_status_idx" ON "inventory"."phone_scan_session"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "phone_scan_line_session_id_key_key" ON "inventory"."phone_scan_line"("session_id", "key");

-- AddForeignKey
ALTER TABLE "inventory"."phone_scan_line" ADD CONSTRAINT "phone_scan_line_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory"."phone_scan_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."phone_scan_line" ADD CONSTRAINT "phone_scan_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checks (hand-written)
ALTER TABLE "inventory"."phone_scan_line" ADD CONSTRAINT "phone_scan_line_qty_check" CHECK ("qty" > 0);
ALTER TABLE "inventory"."phone_scan_line" ADD CONSTRAINT "phone_scan_line_matches_check" CHECK ("matches" >= 0);
ALTER TABLE "inventory"."phone_scan_session" ADD CONSTRAINT "phone_scan_session_attempts_check" CHECK ("failed_attempts" >= 0);
ALTER TABLE "inventory"."phone_scan_session" ADD CONSTRAINT "phone_scan_session_paired_check" CHECK ("status" <> 'PAIRED' OR ("phone_token_hash" IS NOT NULL AND "paired_at" IS NOT NULL));
