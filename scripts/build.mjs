import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { buildDocuments } from './documents.mjs';
const out = path.resolve('dist');
const target = 'chrome151';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const read = (p) => readFile(p, 'utf8');
const put = async (p, s) => {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, s);
};
const brandSource = await read('src/ui/brand.json');
const brand = JSON.parse(brandSource);
const brandRevision = createHash('sha256').update(brandSource).digest('hex').slice(0, 12);
const versionedIcon = (name) => `glosside-${brandRevision}-${name}`;
const wroot = path.resolve('node_modules/@wllama/wllama/src');
const worker = await read(path.join(wroot, 'worker.ts'));
const stub = worker.match(/const JSPI_STUB = `([\s\S]*?)`;/)?.[1];
if (!stub) throw Error('wllama static worker patch requires review');
const runtimeManifest = JSON.parse(await read('vendor/runtime/manifest.json'));
for (const [name, sha] of Object.entries(runtimeManifest.files)) {
  const actual = createHash('sha256')
    .update(await readFile('vendor/runtime/' + name))
    .digest('hex');
  if (actual !== sha) throw Error('Vendored runtime integrity failed: ' + name);
}
const rawEmscripten = await read('vendor/runtime/wllama.js');
if (rawEmscripten.split('var pthreadMainJs=_scriptName;').length !== 2)
  throw Error('Emscripten pthread ABI requires review');
const emscripten = rawEmscripten.replace(
  'var pthreadMainJs=_scriptName;',
  'var pthreadMainJs=Module["mainScriptUrlOrBlob"]||_scriptName;',
);
const glue = await read(path.join(wroot, 'workers-code/llama-cpp.js'));
const cpuDisable =
  'try{Object.defineProperty(WorkerNavigator.prototype,"gpu",{get:()=>({requestAdapter:async()=>null})});}catch(e){}\n';
for (const cpu of [false, true]) {
  const code = (cpu ? cpuDisable : '') + stub + emscripten;
  await put(`${out}/vendor/wllama/emscripten${cpu ? '-cpu' : ''}.js`, code);
  const options = `const params=new URL(location.href).searchParams;const RUN_OPTIONS={pathConfig:{'wllama.wasm':new URL('./wllama.wasm',location.href).href},nbThread:Number(params.get('threads')||0),compat:false};`;
  await put(
    `${out}/vendor/wllama/llama${cpu ? '-cpu' : ''}.js`,
    `${options}\nfunction wModuleInit(){${code.replace('var Module', 'var ___Module')};return Module;}\n${glue}`,
  );
}
await put(
  `${out}/vendor/wllama/opfs.js`,
  await read(path.join(wroot, 'workers-code/opfs-utils.js')),
);
await cp('vendor/runtime/wllama.wasm', `${out}/vendor/wllama/wllama.wasm`);
const staticRuntime = {
  name: 'static-wllama-workers',
  setup(b) {
    b.onResolve({ filter: /^@wllama\/wllama$/ }, () => ({ path: path.join(wroot, 'index.ts') }));
    b.onLoad({ filter: /@wllama\/wllama\/src\/wasm\/source-map\.ts$/ }, async () => ({
      contents: await read('vendor/runtime/source-map.ts'),
      loader: 'ts',
    }));
    b.onLoad({ filter: /@wllama\/wllama\/src\/worker\.ts$/ }, async () => {
      const start = worker.indexOf('    let moduleCode = JSPI_STUB');
      const end = worker.indexOf('    // allocate all files', start);
      if (start < 0 || end < 0) throw Error('wllama ABI changed');
      const replacement = `
    if(this.resources.compat)throw new Error('Unbundled runtime is forbidden');
    const base=new URL('.',this.resources.wasmPath);
    const cpu=this.resources.noWebGPU?'-cpu':'';
    this.worker=new Worker(new URL('llama'+cpu+'.js?threads='+this.nbThread,base));
    this.worker.onmessage=this.onRecvMsg.bind(this);
    this.worker.onerror=()=>this.abort('Static inference worker failed','');
    const res=await this.pushTask({verb:'module.init',args:[new URL('emscripten'+cpu+'.js',base).href,this.useAsyncFile],callbackId:this.taskId++});
`;
      return { contents: worker.slice(0, start) + replacement + worker.slice(end), loader: 'ts' };
    });
    b.onLoad({ filter: /@wllama\/wllama\/src\/storage\/opfs\.ts$/ }, async (args) => ({
      contents: (await read(args.path)).replace(
        'createWorker(OPFS_UTILS_WORKER_CODE)',
        "new Worker(new URL('../vendor/wllama/opfs.js',location.href))",
      ),
      loader: 'ts',
    }));
    b.onLoad({ filter: /@wllama\/wllama\/src\/wasm-from-cdn\.ts$/ }, () => ({
      contents: "export const WasmCompatFromCDN={worker:'',wasm:''};export default {default:''};",
      loader: 'ts',
    }));
  },
};
const entries = Object.fromEntries(
  [
    'background/service-worker',
    'offscreen/host',
    'workers/inference',
    'sidepanel/index',
    'options/index',
    'popup/index',
    'glossary/index',
  ].map((p) => [p, 'src/' + p + '.ts']),
);
await build({
  entryPoints: entries,
  outbase: 'src',
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target,
  sourcemap: true,
  plugins: [staticRuntime],
  logLevel: 'warning',
});
await build({
  entryPoints: ['src/content/index.ts'],
  outfile: out + '/content/index.js',
  bundle: true,
  format: 'iife',
  target,
  sourcemap: true,
});
async function copyStatic(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) await copyStatic(name);
    else if (/\.(html|css)$/.test(name)) {
      const dest = path.join(out, path.relative('src', name));
      await mkdir(path.dirname(dest), { recursive: true });
      if (name.endsWith('.html'))
        await put(
          dest,
          (await read(name)).replace(
            /\.\.\/icons\/([\w.-]+)/g,
            (_, icon) => `../icons/${versionedIcon(icon)}`,
          ),
        );
      else await cp(name, dest);
    }
  }
}
await copyStatic('src');
const manifest = JSON.parse(await read('src/manifest.json'));
for (const [size, icon] of Object.entries(manifest.icons))
  manifest.icons[size] = `icons/${versionedIcon(path.basename(icon))}`;
manifest.action.default_icon = manifest.icons;
await put(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
await buildDocuments(out, versionedIcon('48.png'));
// Simple geometric icon generated deterministically; no external artwork or font dependency.
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    length = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, sum]);
}
// SVG, runtime selection buttons and PNGs all use the same vector geometry.
await put(
  `${out}/icons/glosside.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Glosside</title><circle cx="50" cy="50" r="${brand.radius * 100}" fill="rgb(${brand.background.join(',')})"/>${brand.glyphs.map((glyph) => `<polygon points="${glyph.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}" fill="rgb(${glyph.color.join(',')})"/>`).join('')}</svg>`,
);
await cp(`${out}/icons/glosside.svg`, `${out}/icons/${versionedIcon('glosside.svg')}`);
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  // Supersampling keeps the transparent circle smooth at toolbar/favicon sizes.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      let covered = 0;
      const rgb = [0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const u = (x + (sx + 0.5) / 4) / size,
            v = (y + (sy + 0.5) / 4) / size;
          if (Math.hypot(u - 0.5, v - 0.5) > brand.radius) continue;
          covered++;
          let color = brand.background;
          for (const glyph of brand.glyphs)
            if (insidePolygon(u, v, glyph.points)) color = glyph.color;
          for (let c = 0; c < 3; c++) rgb[c] += color[c];
        }
      raw.set(
        [
          ...rgb.map((c) => (covered ? Math.round(c / covered) : 0)),
          Math.round((255 * covered) / 16),
        ],
        i,
      );
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await put(
    `${out}/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  await cp(`${out}/icons/${size}.png`, `${out}/icons/${versionedIcon(`${size}.png`)}`);
}
const pkg = JSON.parse(await read('package.json'));
await put(
  `${out}/release-manifest.json`,
  JSON.stringify(
    {
      version: pkg.version,
      browser: 'chrome',
      dependencies: pkg.dependencies,
      runtime: runtimeManifest,
      runtimePatch: runtimeManifest.abi,
      model: JSON.parse(await read('vendor/model-manifest.json')),
      releaseApproved: false,
    },
    null,
    2,
  ),
);
const hashes = {};
async function inventory(dir) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await inventory(p);
    else
      hashes[path.relative(out, p)] = createHash('sha256')
        .update(await readFile(p))
        .digest('hex');
  }
}
await inventory(out);
await put(`${out}/SHA256SUMS.json`, JSON.stringify(hashes, null, 2));
console.log(`Built unpacked extension: ${out} (${Object.keys(hashes).length} files).`);
