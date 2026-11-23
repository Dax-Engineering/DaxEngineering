import { StockAgeSettingsDto } from '@dax/inventory-contract';
import { CardBody, PageHead, SectionCard } from '@dax/web-shell';
import { api, requirePermission } from '../../../../../../lib/server';
import { BASE } from '../../_lib/reports';
import { BandsForm } from './bands-form';

export default async function StockAgeSettingsPage() {
  await requirePermission('inventory.stock_age.settings');
  const settings = await api.request(
    '/inventory/reports/stock-age/settings',
    (d) => StockAgeSettingsDto.parse(d),
  );
  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Stock age bands"
        back={{ href: `${BASE}/stock-age`, label: 'Stock age' }}
        lede="Set where each age band ends, in days. Anything older than the last limit goes in the oldest band, which the Stock age tile on Home counts."
      />
      <SectionCard title="Bands">
        <CardBody>
          <BandsForm settings={settings} />
        </CardBody>
      </SectionCard>
    </>
  );
}
