-- Barcode symbology read by the phone camera (ean_13, code_128, qr_code...)
ALTER TABLE "inventory"."phone_scan_line" ADD COLUMN "format" TEXT;
ALTER TABLE "inventory"."phone_scan_line" ADD CONSTRAINT "phone_scan_line_format_check" CHECK ("format" IS NULL OR "format" ~ '^[a-z0-9_]{2,24}$');
