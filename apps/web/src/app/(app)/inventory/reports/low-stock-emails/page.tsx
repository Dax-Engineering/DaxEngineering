import { LowStockSettingsDto, WEEKDAY_LABELS } from '@dax/inventory-contract';
import { CardBody, Facts, PageHead, SectionCard } from '@dax/web-shell';
import { formatDateTime } from '../../../../../lib/format';
import { api, requirePermission } from '../../../../../lib/server';
import { BASE } from '../_lib/reports';
import { SettingsForm } from './settings-form';

export default async function LowStockEmailsPage() {
  await requirePermission('inventory.low_stock.settings');
  const settings = await api.request('/inventory/low-stock/settings', (d) =>
    LowStockSettingsDto.parse(d),
  );

  return (
    <>
      <PageHead
        title="Low-stock emails"
        back={{ href: `${BASE}/below-minimum`, label: 'Below minimum' }}
        lede="Department heads who may receive low-stock emails get a weekly list of every part below its minimum. You can also email each part the moment it drops below."
      />
      <SectionCard title="When emails go out">
        <CardBody>
          <SettingsForm settings={settings} />
        </CardBody>
      </SectionCard>
      <SectionCard title="Last weekly report">
        <CardBody>
          <Facts
            items={[
              {
                label: 'Sent',
                value: settings.lastReportAt
                  ? formatDateTime(settings.lastReportAt)
                  : 'Not yet',
              },
              {
                label: 'Goes out',
                value: `Every ${WEEKDAY_LABELS[settings.reportWeekday]} at ${settings.reportTime}`,
              },
            ]}
          />
        </CardBody>
      </SectionCard>
    </>
  );
}
