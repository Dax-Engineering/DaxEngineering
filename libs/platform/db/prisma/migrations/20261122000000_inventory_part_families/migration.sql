-- Supersession families: each item knows its family's current item and how far back it sits.
ALTER TABLE "inventory"."item" ADD COLUMN "family_id" UUID;
ALTER TABLE "inventory"."item" ADD COLUMN "family_depth" INTEGER NOT NULL DEFAULT 0;

WITH RECURSIVE chain AS (
  SELECT id AS item_id, id AS at, superseded_by_id AS next, 0 AS depth
  FROM "inventory"."item"
  UNION ALL
  SELECT c.item_id, i.id, i.superseded_by_id, c.depth + 1
  FROM chain c JOIN "inventory"."item" i ON i.id = c.next
  WHERE c.depth < 100
), ends AS (
  SELECT DISTINCT ON (item_id) item_id, at AS root, depth
  FROM chain
  WHERE next IS NULL
  ORDER BY item_id, depth DESC
)
UPDATE "inventory"."item" i SET family_id = e.root, family_depth = e.depth
FROM ends e WHERE e.item_id = i.id;
UPDATE "inventory"."item" SET family_id = id WHERE family_id IS NULL;

ALTER TABLE "inventory"."item" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "item_family_id_idx" ON "inventory"."item"("family_id");
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_family_depth_check" CHECK ("family_depth" >= 0);
ALTER TABLE "inventory"."item" ADD CONSTRAINT "item_family_root_check" CHECK ("family_depth" > 0 OR "family_id" = "id");

-- A new item starts its own family.
CREATE FUNCTION "inventory"."item_default_family"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.family_id IS NULL THEN
    NEW.family_id := NEW.id;
    NEW.family_depth := 0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "item_default_family" BEFORE INSERT ON "inventory"."item"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."item_default_family"();

-- A line may hold reservations on several numbers of one family.
DROP INDEX "inventory"."reservation_source_source_line_id_key";
CREATE UNIQUE INDEX "reservation_source_source_line_id_item_id_key" ON "inventory"."reservation"("source", "source_line_id", "item_id");
CREATE INDEX "reservation_source_source_line_id_idx" ON "inventory"."reservation"("source", "source_line_id");
