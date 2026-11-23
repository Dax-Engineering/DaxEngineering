'use client';

import { Menu } from '@mantine/core';
import { Icon } from '@dax/web-shell';

/** One Scan button: pick this device or a phone, then it opens in a new tab. */
export function ScanMenu({ here, phone }: { here: boolean; phone: boolean }) {
  return (
    <Menu position="bottom-end" width={260} shadow="md" withinPortal>
      <Menu.Target>
        <button type="button" className="dax-cta">
          <Icon name="scan" size={20} />
          Scan
          <Icon name="chevron" size={16} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>How do you want to scan?</Menu.Label>
        {here ? (
          <Menu.Item
            component="a"
            href="/scan"
            target="_blank"
            rel="noopener"
            leftSection={<Icon name="scan" size={18} />}
          >
            Scan with Device
            <div className="dax-sub">
              This computer's camera, a hand-held scanner or a typed code
            </div>
          </Menu.Item>
        ) : null}
        {phone ? (
          <Menu.Item
            component="a"
            href="/scan/phone"
            target="_blank"
            rel="noopener"
            leftSection={<Icon name="phone" size={18} />}
          >
            Scan with External Phone
            <div className="dax-sub">Pair a phone and scan with its camera</div>
          </Menu.Item>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}
