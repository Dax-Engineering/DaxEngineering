-- CreateEnum
CREATE TYPE "inventory"."SerialSource" AS ENUM ('GRN', 'EXISTING');

-- CreateEnum
CREATE TYPE "inventory"."SerialCondition" AS ENUM ('GOOD', 'DAMAGED');

-- CreateEnum
CREATE TYPE "inventory"."SerialStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateTable
CREATE TABLE "inventory"."item_serial" (
    "id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "source" "inventory"."SerialSource" NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_line_id" UUID,
    "doc_number" TEXT,
    "bin_id" UUID,
    "line_no" INTEGER,
    "unit_no" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "condition" "inventory"."SerialCondition" NOT NULL,
    "status" "inventory"."SerialStatus" NOT NULL DEFAULT 'ACTIVE',
    "voided_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "supplier_name" TEXT,
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "last_printed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_serial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."item_serial_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "existing_done_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_serial_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_serial_serial_key" ON "inventory"."item_serial"("serial");

-- CreateIndex
CREATE INDEX "item_serial_item_id_received_at_idx" ON "inventory"."item_serial"("item_id", "received_at");

-- CreateIndex
CREATE INDEX "item_serial_doc_id_idx" ON "inventory"."item_serial"("doc_id");

-- CreateIndex
CREATE INDEX "item_serial_doc_line_id_idx" ON "inventory"."item_serial"("doc_line_id");

-- CreateIndex
CREATE INDEX "item_serial_bin_id_idx" ON "inventory"."item_serial"("bin_id");

-- AddForeignKey
ALTER TABLE "inventory"."item_serial" ADD CONSTRAINT "item_serial_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."item_serial" ADD CONSTRAINT "item_serial_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "inventory"."bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Checks (hand-written)
ALTER TABLE "inventory"."item_serial" ADD CONSTRAINT "item_serial_format_check" CHECK ("serial" ~ '^[0-9A-HJKMNP-TV-Z]{16}$');
ALTER TABLE "inventory"."item_serial" ADD CONSTRAINT "item_serial_qty_check" CHECK ("qty" > 0 AND "unit_no" > 0 AND "print_count" >= 0);
ALTER TABLE "inventory"."item_serial" ADD CONSTRAINT "item_serial_void_check" CHECK (("status" = 'VOID') = ("voided_at" IS NOT NULL));
ALTER TABLE "inventory"."item_serial_settings" ADD CONSTRAINT "item_serial_settings_single_row_check" CHECK ("id" = 1);

-- existing_done_at stays null, so the worker makes serials for the stock already in the store once.
INSERT INTO "inventory"."item_serial_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
