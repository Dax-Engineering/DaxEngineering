import { canDo, Icon, PageHead } from '@dax/web-shell';
import { requirePermission } from '../../../../lib/server';

const CHOICES = [
  {
    href: '/scan',
    title: 'Scan with Device',
    sub: "Use this device's camera, a hand-held scanner, or type the code.",
    icon: 'scan',
    needsItems: false,
  },
  {
    href: '/scan/phone',
    title: 'Scan with External Phone',
    sub: 'Pair a phone and scan with its camera. Good for a whole delivery.',
    icon: 'phone',
    needsItems: true,
  },
];

export default async function ChooseScanPage() {
  const caps = await requirePermission(
    'inventory.item.view',
    'inventory.location.view',
  );
  const canPhone = canDo(caps, 'inventory.phone_scan.use');
  return (
    <>
      <PageHead
        back={{ href: '/', label: 'Home' }}
        title="How do you want to scan?"
        lede="Your choice opens in a new tab, so this page stays here."
      />
      <div className="dax-tiles">
        {CHOICES.filter((c) => canPhone || !c.needsItems).map((c) => (
          <a
            key={c.href}
            href={c.href}
            target="_blank"
            rel="noopener"
            className="dax-tile orange"
          >
            <span className="badge">
              <Icon name={c.icon} size={20} />
            </span>
            <b>{c.title}</b>
            <span className="sub">{c.sub}</span>
          </a>
        ))}
      </div>
    </>
  );
}
