import { z } from 'zod';
import { defineEvent } from '@dax/platform-core';

export const lowStockAlertEmail = defineEvent(
  'inventory.low_stock_alert_email.v1',
  z.object({ userId: z.uuid(), alertIds: z.array(z.uuid()).min(1) }),
);

export const lowStockReportEmail = defineEvent(
  'inventory.low_stock_report_email.v1',
  z.object({ userId: z.uuid() }),
);
