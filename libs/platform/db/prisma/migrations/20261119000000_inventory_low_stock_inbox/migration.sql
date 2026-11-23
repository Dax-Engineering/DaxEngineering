-- CreateTable
CREATE TABLE "core"."inbox_message" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "source_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."low_stock_alert" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMPTZ(3),

    CONSTRAINT "low_stock_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."low_stock_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "report_weekday" INTEGER NOT NULL DEFAULT 1,
    "report_time" TEXT NOT NULL DEFAULT '08:00',
    "instant_email" BOOLEAN NOT NULL DEFAULT false,
    "last_report_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "low_stock_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_message_user_id_done_at_created_at_idx" ON "core"."inbox_message"("user_id", "done_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_message_user_id_source_key_key" ON "core"."inbox_message"("user_id", "source_key");

-- CreateIndex
CREATE INDEX "low_stock_alert_item_id_idx" ON "inventory"."low_stock_alert"("item_id");

-- CreateIndex
CREATE INDEX "low_stock_alert_store_id_cleared_at_idx" ON "inventory"."low_stock_alert"("store_id", "cleared_at");

-- AddForeignKey
ALTER TABLE "inventory"."low_stock_alert" ADD CONSTRAINT "low_stock_alert_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."low_stock_alert" ADD CONSTRAINT "low_stock_alert_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "inventory"."store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Checks (hand-written)
CREATE UNIQUE INDEX "low_stock_alert_open_key" ON "inventory"."low_stock_alert"("item_id", "store_id") WHERE "cleared_at" IS NULL;
ALTER TABLE "inventory"."low_stock_settings" ADD CONSTRAINT "low_stock_settings_single_row_check" CHECK ("id" = 1);
ALTER TABLE "inventory"."low_stock_settings" ADD CONSTRAINT "low_stock_settings_weekday_check" CHECK ("report_weekday" BETWEEN 0 AND 6);
ALTER TABLE "inventory"."low_stock_settings" ADD CONSTRAINT "low_stock_settings_time_check" CHECK ("report_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

INSERT INTO "inventory"."low_stock_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
