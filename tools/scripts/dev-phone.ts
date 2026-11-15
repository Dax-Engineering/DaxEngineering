// `pnpm dev:phone`: the normal dev servers, plus a Cloudflare quick tunnel so a
// phone can open the stores app over https (the camera only works on https).
// The tunnel address changes each run; "Scan with phone" on the PC always
// shows the current one as a QR code.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';

const WEB_PORT = 4200;
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function hasCloudflared(): boolean {
  const probe = spawnSync('cloudflared', ['--version'], {
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function startTunnel(): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://localhost:${WEB_PORT}`],
      { shell: process.platform === 'win32' },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error('The tunnel did not give an address within 60 seconds.'),
      );
    }, 60_000);
    const watch = (chunk: Buffer) => {
      const match = TUNNEL_URL.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[0] });
      }
    };
    child.stdout?.on('data', watch);
    child.stderr?.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared stopped (exit ${code ?? 'unknown'}).`));
    });
  });
}

async function main() {
  if (!hasCloudflared()) {
    console.error(
      [
        'cloudflared is not installed or not on PATH.',
        '  Install it: winget install --id Cloudflare.cloudflared',
        '  Then run pnpm dev:phone again.',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log('Starting the phone tunnel…');
  const tunnel = await startTunnel();
  console.log(
    [
      '',
      `  Phone scanner: ${tunnel.url}/p  (open it on the phone, bookmark it)`,
      '  On the PC, press "Scan with phone"; point the phone at its QR code.',
      '  The address changes each time you run pnpm dev:phone.',
      '',
    ].join('\n'),
  );

  const dev = spawn('pnpm', ['dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, WEB_PHONE_ORIGIN: tunnel.url },
  });

  const stop = () => {
    tunnel.child.kill();
    dev.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  dev.on('exit', (code) => {
    tunnel.child.kill();
    process.exit(code ?? 0);
  });
  tunnel.child.on('exit', () => {
    console.error(
      'The phone tunnel stopped. Phones lose access until you restart pnpm dev:phone.',
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
