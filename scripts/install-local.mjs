import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const options = parseArgs({
  options: { dir: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
}).values;

if (options.help) {
  console.log('Usage: npm run install:local -- [--dir path]');
  process.exit(0);
}

const root = resolve(import.meta.dirname, '..');
const assetsDir = resolve(root, 'release');
const installDir = options.dir ? resolve(options.dir) : resolve(assetsDir, 'local-extension');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'powershell.exe' : 'sh',
  windows
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        resolve(root, 'scripts/install.ps1'),
        '-AssetsDir',
        assetsDir,
        '-Version',
        `v${version}`,
        '-InstallDir',
        installDir,
      ]
    : [
        resolve(root, 'scripts/install.sh'),
        '--assets-dir',
        assetsDir,
        '--version',
        `v${version}`,
        '--dir',
        installDir,
      ],
  { stdio: 'inherit' },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
