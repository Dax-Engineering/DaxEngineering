-- CreateTable
CREATE TABLE "inventory"."machine_type" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "machine_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_type_name_key" ON "inventory"."machine_type"("name");

-- AlterTable
ALTER TABLE "inventory"."machine_model" ADD COLUMN "machine_type_id" UUID;

-- AddForeignKey
ALTER TABLE "inventory"."machine_model" ADD CONSTRAINT "machine_model_machine_type_id_fkey" FOREIGN KEY ("machine_type_id") REFERENCES "inventory"."machine_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "inventory"."item" ADD COLUMN "supplier_id" UUID,
ADD COLUMN "supplier_name" TEXT,
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "pre_cost_price" DECIMAL(14,2),
ADD COLUMN "selling_price" DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "item_supplier_id_idx" ON "inventory"."item"("supplier_id");
CREATE INDEX "item_tags_idx" ON "inventory"."item" USING GIN ("tags");

-- Prices are never negative; tags are short and lower-case
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_pre_cost_price_check" CHECK ("pre_cost_price" IS NULL OR "pre_cost_price" >= 0);
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_selling_price_check" CHECK ("selling_price" IS NULL OR "selling_price" >= 0);
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_supplier_name_check" CHECK (("supplier_id" IS NULL) = ("supplier_name" IS NULL));
