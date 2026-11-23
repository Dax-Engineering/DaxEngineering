import { canDo, PageHead } from '@dax/web-shell';
import { phoneOrigin } from '../../../../lib/phone';
import { requirePermission } from '../../../../lib/server';
import { getDepartments } from '../../inventory/issuing/_lib/data';
import { PhonePanel } from './phone-panel';

export default async function ScanWithPhonePage() {
  const caps = await requirePermission('inventory.item.view');
  const can = (p: string) => canDo(caps, p);
  const access = {
    receive: can('inventory.grn.check'),
    request: can('inventory.mrn.create'),
    count: can('inventory.count.create') && can('inventory.count.count'),
    labels: can('inventory.item.print_label'),
  };
  const departments = access.request ? await getDepartments() : [];
  return (
    <>
      <PageHead
        eyebrow="Inventory"
        title="Scan with External Phone"
        lede="Use a phone as a scanner for 15 minutes. Open the phone scanner on the phone, point it at the QR code here, and its scans build a list below."
      />
      <PhonePanel
        origin={phoneOrigin()}
        access={access}
        departments={departments}
      />
    </>
  );
}
