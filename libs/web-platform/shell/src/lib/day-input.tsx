'use client';

import { DateInput, type DateInputProps } from '@mantine/dates';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const TYPED = ['D/M/YYYY', 'DD/MM/YYYY', 'D-M-YYYY', 'D.M.YYYY', 'YYYY-MM-DD'];

function parseDay(text: string): string | null {
  const d = dayjs(text.trim(), TYPED, true);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

/**
 * A date field shown and typed as DD/MM/YYYY. Values in and out (and the
 * hidden form field when `name` is set) stay YYYY-MM-DD, like a native date input.
 */
export function DayInput({
  value,
  defaultValue,
  onChange,
  min,
  max,
  ...rest
}: Omit<
  DateInputProps,
  'value' | 'defaultValue' | 'onChange' | 'minDate' | 'maxDate'
> & {
  value?: string;
  defaultValue?: string;
  onChange?: (day: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <DateInput
      valueFormat="DD/MM/YYYY"
      placeholder="DD/MM/YYYY"
      dateParser={parseDay}
      clearable
      firstDayOfWeek={1}
      {...(value !== undefined ? { value: value || null } : {})}
      defaultValue={defaultValue || undefined}
      onChange={(v) => onChange?.(v ?? '')}
      minDate={min || undefined}
      maxDate={max || undefined}
      {...rest}
    />
  );
}
