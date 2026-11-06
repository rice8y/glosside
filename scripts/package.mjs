import { readFile, writeFile, readdir, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zip } from './zip.mjs';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const pkg = await json('package.json');
const manifest = await json('dist/manifest.json');
const release = await json('dist/release-manifest.json');
if (pkg.version !== manifest.version || release.version !== pkg.version)
  throw Error('Package and extension versions must match');
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${pkg.version}`)
  throw Error('Release tag must match v' + pkg.version);
if (release.buildMode !== 'release') throw Error('Run npm run package to build release assets');
const hashes = await json('dist/SHA256SUMS.json');
const files = [];
async function collect(dir = '') {
  for (const entry of await readdir('dist/' + dir, { withFileTypes: true })) {
    const name = dir + entry.name;
    if (entry.isDirectory()) await collect(name + '/');
    else {
      if (!entry.isFile() || name.endsWith('.map') || name.endsWith('.gguf'))
        throw Error('Unexpected release file: ' + name);
      const data = await readFile('dist/' + name);
      if (
        name !== 'SHA256SUMS.json' &&
        createHash('sha256').update(data).digest('hex') !== hashes[name]
      )
        throw Error('Build inventory mismatch: ' + name);
      files.push({ name: 'glosside/' + name, data });
    }
  }
}
await collect();
if (files.length !== Object.keys(hashes).length + 1) throw Error('Build inventory is incomplete');
files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const archive = zip(files);
await mkdir('release', { recursive: true });
await writeFile('release/glosside-chrome.zip', archive);
await writeFile(
  'release/glosside-chrome.zip.sha256',
  createHash('sha256').update(archive).digest('hex') + '  glosside-chrome.zip\n',
);
for (const name of ['install.sh', 'install.ps1']) await cp('scripts/' + name, 'release/' + name);
console.log(
  `Packaged Glosside ${pkg.version}: ${files.length} files, ${archive.length} bytes in release/glosside-chrome.zip`,
);
