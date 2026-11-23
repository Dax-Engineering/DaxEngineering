-- AlterTable
ALTER TABLE "inventory"."mrn_line" ADD COLUMN     "mrn_bundle_id" UUID,
ADD COLUMN     "qty_per_set" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "inventory"."bundle" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."bundle_line" (
    "id" UUID NOT NULL,
    "bundle_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "bundle_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."mrn_bundle" (
    "id" UUID NOT NULL,
    "mrn_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bundle_id" UUID,
    "name" TEXT NOT NULL,
    "qty_sets" INTEGER NOT NULL,
    "customer_part_no" TEXT,

    CONSTRAINT "mrn_bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."customer_bundle_part" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "bundle_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "part_no" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "customer_bundle_part_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bundle_name_key" ON "inventory"."bundle"("name");

-- CreateIndex
CREATE INDEX "bundle_line_item_id_idx" ON "inventory"."bundle_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_line_bundle_id_line_no_key" ON "inventory"."bundle_line"("bundle_id", "line_no");

-- CreateIndex
CREATE INDEX "mrn_bundle_bundle_id_idx" ON "inventory"."mrn_bundle"("bundle_id");

-- CreateIndex
CREATE INDEX "mrn_bundle_customer_part_no_idx" ON "inventory"."mrn_bundle"("customer_part_no");

-- CreateIndex
CREATE UNIQUE INDEX "mrn_bundle_mrn_id_line_no_key" ON "inventory"."mrn_bundle"("mrn_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "customer_bundle_part_part_no_key" ON "inventory"."customer_bundle_part"("part_no");

-- CreateIndex
CREATE INDEX "customer_bundle_part_bundle_id_idx" ON "inventory"."customer_bundle_part"("bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_bundle_part_customer_id_bundle_id_key" ON "inventory"."customer_bundle_part"("customer_id", "bundle_id");

-- CreateIndex
CREATE INDEX "mrn_line_mrn_bundle_id_idx" ON "inventory"."mrn_line"("mrn_bundle_id");

-- AddForeignKey
ALTER TABLE "inventory"."mrn_line" ADD CONSTRAINT "mrn_line_mrn_bundle_id_fkey" FOREIGN KEY ("mrn_bundle_id") REFERENCES "inventory"."mrn_bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."bundle_line" ADD CONSTRAINT "bundle_line_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "inventory"."bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."bundle_line" ADD CONSTRAINT "bundle_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."mrn_bundle" ADD CONSTRAINT "mrn_bundle_mrn_id_fkey" FOREIGN KEY ("mrn_id") REFERENCES "inventory"."mrn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."mrn_bundle" ADD CONSTRAINT "mrn_bundle_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "inventory"."bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."customer_bundle_part" ADD CONSTRAINT "customer_bundle_part_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "inventory"."bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written checks
ALTER TABLE "inventory"."bundle_line" ADD CONSTRAINT "bundle_line_qty_check" CHECK ("qty" > 0);
ALTER TABLE "inventory"."mrn_bundle" ADD CONSTRAINT "mrn_bundle_sets_check" CHECK ("qty_sets" > 0);
ALTER TABLE "inventory"."mrn_line" ADD CONSTRAINT "mrn_line_bundle_check" CHECK (("mrn_bundle_id" IS NULL) = ("qty_per_set" IS NULL) AND ("qty_per_set" IS NULL OR "qty_per_set" > 0));
ALTER TABLE "inventory"."customer_bundle_part" ADD CONSTRAINT "customer_bundle_part_seq_check" CHECK ("seq" > 0);
