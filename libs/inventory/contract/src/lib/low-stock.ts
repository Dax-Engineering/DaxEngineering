import { z } from 'zod';

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const ReportTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a 24-hour time like 08:00');

export const LowStockSettingsInput = z.object({
  reportWeekday: z.coerce.number().int().min(0).max(6),
  reportTime: ReportTime,
  instantEmail: z.boolean(),
  version: z.int().min(1),
});
export type LowStockSettingsInput = z.infer<typeof LowStockSettingsInput>;

export const LowStockSettingsDto = z.object({
  reportWeekday: z.int().min(0).max(6),
  reportTime: z.string(),
  instantEmail: z.boolean(),
  lastReportAt: z.string().nullable(),
  version: z.int().min(1),
});
export type LowStockSettingsDto = z.infer<typeof LowStockSettingsDto>;
