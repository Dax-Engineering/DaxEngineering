-- CreateEnum
CREATE TYPE "inventory"."StockLayerSource" AS ENUM ('GRN', 'OPENING', 'RETURN', 'COUNT', 'OTHER');

-- CreateTable
CREATE TABLE "inventory"."stock_layer" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "aged_from" TIMESTAMPTZ(3) NOT NULL,
    "at_least" BOOLEAN NOT NULL DEFAULT false,
    "source" "inventory"."StockLayerSource" NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_line_id" UUID,
    "doc_number" TEXT,
    "qty_in" DECIMAL(14,3) NOT NULL,
    "qty_left" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_layer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_layer_use" (
    "id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "movement" "inventory"."MovementType" NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_line_id" UUID,
    "doc_number" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "returned_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ(3) NOT NULL,
    "days_in_store" INTEGER NOT NULL,

    CONSTRAINT "stock_layer_use_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_age_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bands" INTEGER[] DEFAULT ARRAY[30, 90, 180, 365]::INTEGER[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "rebuilt_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "stock_age_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_layer_store_id_item_id_aged_from_idx" ON "inventory"."stock_layer"("store_id", "item_id", "aged_from");

-- CreateIndex
CREATE INDEX "stock_layer_doc_id_idx" ON "inventory"."stock_layer"("doc_id");

-- CreateIndex
CREATE INDEX "stock_layer_use_item_id_used_at_idx" ON "inventory"."stock_layer_use"("item_id", "used_at");

-- CreateIndex
CREATE INDEX "stock_layer_use_doc_line_id_idx" ON "inventory"."stock_layer_use"("doc_line_id");

-- AddForeignKey
ALTER TABLE "inventory"."stock_layer" ADD CONSTRAINT "stock_layer_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_layer_use" ADD CONSTRAINT "stock_layer_use_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "inventory"."stock_layer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checks (hand-written)
ALTER TABLE "inventory"."stock_layer" ADD CONSTRAINT "stock_layer_qty_check" CHECK ("qty_in" > 0 AND "qty_left" >= 0 AND "qty_left" <= "qty_in");
ALTER TABLE "inventory"."stock_layer_use" ADD CONSTRAINT "stock_layer_use_qty_check" CHECK ("qty" > 0 AND "returned_qty" >= 0 AND "returned_qty" <= "qty" AND "days_in_store" >= 0);
CREATE INDEX "stock_layer_open_idx" ON "inventory"."stock_layer"("store_id", "item_id", "aged_from") WHERE "qty_left" > 0;
ALTER TABLE "inventory"."stock_age_settings" ADD CONSTRAINT "stock_age_settings_single_row_check" CHECK ("id" = 1);
ALTER TABLE "inventory"."stock_age_settings" ADD CONSTRAINT "stock_age_settings_bands_check" CHECK (cardinality("bands") BETWEEN 2 AND 6);

-- rebuilt_at stays null, so the worker builds the layers from the stock ledger once.
INSERT INTO "inventory"."stock_age_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
