import { z } from 'zod';
import { PageParams, pageOf } from '@dax/contracts';

export const INBOX_TABS = ['open', 'done'] as const;

export const InboxQuery = PageParams.extend({
  tab: z.enum(INBOX_TABS).default('open'),
});
export type InboxQuery = z.infer<typeof InboxQuery>;

export const InboxMessageDto = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  doneAt: z.string().nullable(),
});
export type InboxMessageDto = z.infer<typeof InboxMessageDto>;

export const InboxPage = pageOf(InboxMessageDto);
export type InboxPage = z.infer<typeof InboxPage>;

export const InboxCount = z.object({ unread: z.int().min(0) });
export type InboxCount = z.infer<typeof InboxCount>;
