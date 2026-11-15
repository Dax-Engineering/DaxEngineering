// Local file storage runs MinIO natively on this PC (not Docker).
//   up     - download minio/mc if missing, start MinIO in the background,
//            create the private bucket (pnpm files:up)
//   down   - stop it (pnpm files:down)
//   status - is it running? (pnpm files:status)
// Binaries, data and logs live outside the repo, in %LOCALAPPDATA%\dax-dev\minio.
// Credentials come from .env and are never written to disk: mc gets a
// temporary alias through the MC_HOST_<alias> environment variable.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { envValue } from './native-db';

const isWindows = process.platform === 'win32';
const exe = (name: string) => (isWindows ? `${name}.exe` : name);

const root = join(
  process.env['LOCALAPPDATA'] ?? join(homedir(), '.local', 'share'),
  'dax-dev',
  'minio',
);
const binDir = join(root, 'bin');
// DAX_MINIO_DATA_DIR (env or .env) moves the stored files, e.g. to a roomier drive.
const dataDir = envValue('DAX_MINIO_DATA_DIR') ?? join(root, 'data');
const pidFile = join(root, 'minio.pid');
const logFile = join(root, 'minio.log');
const minioExe = join(binDir, exe('minio'));
const mcExe = join(binDir, exe('mc'));

function required(key: string): string {
  const value = envValue(key);
  if (!value) throw new Error(`${key} is missing from .env`);
  return value;
}

/** S3_ENDPOINT, refusing anything that is not this PC. */
function endpoint(): URL {
  const url = new URL(required('S3_ENDPOINT'));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    console.error(
      `S3_ENDPOINT is ${url.origin}, not localhost. native-files only manages a local MinIO.`,
    );
    process.exit(1);
  }
  return url;
}

function port(url: URL): number {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

function listening(portNumber: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: portNumber });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

// The open-source MinIO project is archived and dl.min.io answers 410 Gone, so
// these are the last community builds, from MinIO's own GitHub releases (the
// same versions the old docker-compose.yml pinned). Each download is checked
// against the release's .sha256sum file.
const releases = {
  minio: { repo: 'minio/minio', tag: 'RELEASE.2025-09-07T16-13-09Z' },
  mc: { repo: 'minio/mc', tag: 'RELEASE.2025-08-13T08-35-41Z' },
} as const;

function releaseUrl(tool: keyof typeof releases): string {
  const { repo, tag } = releases[tool];
  const os = isWindows ? 'windows' : process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const file = `${tool}.${os}-${arch}.${tag}${isWindows ? '.exe' : ''}`;
  return `https://github.com/${repo}/releases/download/${tag}/${file}`;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureBinary(tool: keyof typeof releases, target: string) {
  if (existsSync(target)) return;
  mkdirSync(binDir, { recursive: true });
  const url = releaseUrl(tool);
  console.log(`Downloading ${url}\n  -> ${target}`);
  const [body, sums] = await Promise.all([
    download(url),
    download(`${url}.sha256sum`),
  ]);
  const expected = sums.toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${url}: got ${actual}`);
  }
  const partial = `${target}.download`;
  writeFileSync(partial, body, { mode: 0o755 });
  renameSync(partial, target);
}

function readPid(): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function waitForHealth(url: URL, timeoutMs = 30_000) {
  const health = new URL('/minio/health/live', url);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  rmSync(pidFile, { force: true });
  throw new Error(
    [
      `MinIO did not become healthy within 30 s. See ${logFile}`,
      ...(/forbidden by its access permissions/.test(log.slice(-2000))
        ? [
            'The port is reserved by Windows (Hyper-V/WSL). Check:',
            '  netsh interface ipv4 show excludedportrange protocol=tcp',
            'and move S3_ENDPOINT in .env to a port outside those ranges.',
          ]
        : []),
    ].join('\n'),
  );
}

/** Runs mc with a temporary `dax` alias that exists only in this env. */
export function mc(args: string[]): string {
  const url = endpoint();
  const user = encodeURIComponent(required('S3_ACCESS_KEY_ID'));
  const pass = encodeURIComponent(required('S3_SECRET_ACCESS_KEY'));
  return execFileSync(mcExe, ['--quiet', ...args], {
    env: {
      ...process.env,
      MC_HOST_dax: `${url.protocol}//${user}:${pass}@${url.host}`,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function up() {
  const url = endpoint();
  const bucket = required('S3_BUCKET');
  const apiPort = port(url);
  const consoleAddress = `127.0.0.1:${apiPort + 1}`;

  await ensureBinary('minio', minioExe);
  await ensureBinary('mc', mcExe);

  if (await listening(apiPort)) {
    console.log(`Something already listens on ${url.host}; using it as MinIO.`);
  } else {
    mkdirSync(dataDir, { recursive: true });
    const log = openSync(logFile, 'a');
    const child = spawn(
      minioExe,
      [
        'server',
        dataDir,
        '--address',
        `127.0.0.1:${apiPort}`,
        '--console-address',
        consoleAddress,
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
        env: {
          ...process.env,
          MINIO_ROOT_USER: required('S3_ACCESS_KEY_ID'),
          MINIO_ROOT_PASSWORD: required('S3_SECRET_ACCESS_KEY'),
        },
      },
    );
    if (!child.pid) throw new Error('Could not start minio');
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    console.log(
      `Started MinIO (pid ${child.pid}), data: ${dataDir}, log: ${logFile}`,
    );
  }

  await waitForHealth(url);
  mc(['mb', '--ignore-existing', `dax/${bucket}`]);
  mc(['anonymous', 'set', 'none', `dax/${bucket}`]);
  console.log(
    [
      `MinIO is up. Bucket "${bucket}" exists and is private.`,
      `  S3 endpoint: ${url.origin}`,
      `  Console:     http://${consoleAddress} (log in with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)`,
    ].join('\n'),
  );
}

function down() {
  const pid = readPid();
  if (!pid) {
    console.log('MinIO was not running (no pid file).');
    return;
  }
  try {
    if (isWindows) {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(pid);
    }
    console.log(`Stopped MinIO (pid ${pid}).`);
  } catch {
    console.log(`MinIO was not running (pid ${pid} is gone).`);
  }
  rmSync(pidFile, { force: true });
}

async function status() {
  const url = endpoint();
  const pid = readPid();
  if (await listening(port(url))) {
    console.log(
      `MinIO is running on ${url.host}${pid ? ` (pid ${pid})` : ' (not started by this script)'}.`,
    );
  } else {
    console.log(`MinIO is not running. Start it: pnpm files:up`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('native-files.ts')) {
  const command = process.argv[2];
  const run =
    command === 'up'
      ? up
      : command === 'down'
        ? down
        : command === 'status'
          ? status
          : undefined;
  if (!run) {
    console.error('usage: native-files.ts up|down|status');
    process.exit(1);
  }
  Promise.resolve(run()).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
