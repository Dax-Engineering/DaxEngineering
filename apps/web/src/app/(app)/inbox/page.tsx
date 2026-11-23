import { InboxPage, InboxQuery } from '@dax/platform-contract';
import {
  CardBody,
  Chips,
  Empty,
  PageHead,
  Pager,
  SectionCard,
} from '@dax/web-shell';
import { formatCount, formatDateTime } from '../../../lib/format';
import {
  flatten,
  readQuery,
  type SearchParams,
  toQuery,
} from '../../../lib/query';
import { api, requireCapabilities } from '../../../lib/server';
import { MessageRow } from './message-row';

export default async function InboxListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireCapabilities();
  const raw = flatten(await searchParams);
  const query = readQuery(InboxQuery, raw);
  const page = await api.request(`/me/inbox${toQuery(query)}`, (d) =>
    InboxPage.parse(d),
  );
  const open = query.tab === 'open';

  return (
    <>
      <PageHead
        eyebrow="Inbox"
        title="Inbox"
        lede="Messages for you, such as parts that dropped below their minimum. Mark a message done once it is dealt with."
      />
      <SectionCard
        flush
        title={open ? 'Open' : 'Done'}
        note={`${formatCount(page.total)} total`}
        toolbar={
          <Chips
            items={[
              { href: '/inbox', label: 'Open', active: open },
              { href: '/inbox?tab=done', label: 'Done', active: !open },
            ]}
          />
        }
      >
        <CardBody>
          {page.items.length === 0 ? (
            <Empty title={open ? 'Nothing waiting' : 'Nothing done yet'}>
              {open
                ? 'New messages appear here.'
                : 'Messages you mark done move here.'}
            </Empty>
          ) : (
            <ul className="dax-list">
              {page.items.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  when={formatDateTime(m.doneAt ?? m.createdAt)}
                />
              ))}
            </ul>
          )}
        </CardBody>
        <Pager
          path="/inbox"
          query={raw}
          total={page.total}
          page={page.page}
          limit={page.limit}
        />
      </SectionCard>
    </>
  );
}
