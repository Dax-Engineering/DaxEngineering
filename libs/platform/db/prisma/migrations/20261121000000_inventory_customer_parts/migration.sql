-- AlterTable
ALTER TABLE "inventory"."aod_line" ADD COLUMN     "customer_part_no" TEXT;

-- CreateTable
CREATE TABLE "inventory"."customer_part" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "part_no" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "customer_part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."customer_part_counter" (
    "customer_id" UUID NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_part_counter_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_part_part_no_key" ON "inventory"."customer_part"("part_no");

-- CreateIndex
CREATE INDEX "customer_part_item_id_idx" ON "inventory"."customer_part"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_part_customer_id_item_id_key" ON "inventory"."customer_part"("customer_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_part_customer_id_seq_key" ON "inventory"."customer_part"("customer_id", "seq");

-- CreateIndex
CREATE INDEX "aod_line_customer_part_no_idx" ON "inventory"."aod_line"("customer_part_no");

-- AddForeignKey
ALTER TABLE "inventory"."customer_part" ADD CONSTRAINT "customer_part_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written checks
ALTER TABLE "inventory"."customer_part" ADD CONSTRAINT "customer_part_seq_check" CHECK ("seq" > 0);
ALTER TABLE "inventory"."customer_part_counter" ADD CONSTRAINT "customer_part_counter_last_check" CHECK ("last" >= 0);

-- Backfill: number every part already on a customer's AOD, per customer in order of first use.
WITH pairs AS (
  SELECT m.customer_id, l.item_id, MIN(a.created_at) AS first_at
  FROM "inventory"."aod_line" l
  JOIN "inventory"."aod" a ON a.id = l.aod_id
  JOIN "inventory"."mrn" m ON m.id = a.mrn_id
  WHERE m.customer_id IS NOT NULL AND a.status <> 'CANCELLED'
  GROUP BY m.customer_id, l.item_id
), numbered AS (
  SELECT p.customer_id, p.item_id,
    row_number() OVER (PARTITION BY p.customer_id ORDER BY p.first_at, p.item_id) AS seq
  FROM pairs p
)
INSERT INTO "inventory"."customer_part"
  ("id", "customer_id", "customer_code", "customer_name", "item_id", "seq", "part_no", "created_by")
SELECT gen_random_uuid(), n.customer_id, c.code, c.name, n.item_id, n.seq,
  c.code || '-' || lpad(n.seq::text, 5, '0'), '00000000-0000-0000-0000-000000000000'
FROM numbered n
JOIN "parties"."customer" c ON c.id = n.customer_id;

INSERT INTO "inventory"."customer_part_counter" ("customer_id", "last")
SELECT "customer_id", MAX("seq") FROM "inventory"."customer_part" GROUP BY "customer_id";

UPDATE "inventory"."aod_line" l SET "customer_part_no" = cp.part_no
FROM "inventory"."aod" a, "inventory"."mrn" m, "inventory"."customer_part" cp
WHERE a.id = l.aod_id AND m.id = a.mrn_id
  AND cp.customer_id = m.customer_id AND cp.item_id = l.item_id;
