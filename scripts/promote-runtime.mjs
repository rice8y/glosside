// Promote only candidates that have passed the real-model and kernel validation.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'dev/artifacts/runtime-rebuild';
const manifests = {};
for (const variant of ['simd', 'relaxed']) {
  const base = `${root}/build-${variant}`;
  const m = JSON.parse(await readFile(`${base}/build-manifest.json`, 'utf8'));
  if (m.variant !== variant) throw Error('Wrong variant');
  if (
    m.llamaCpp !== '46ca246de9bb1c35269722a6240d37d9dfd79cad' ||
    m.wllama !== '3.8.1' ||
    m.emscripten !== '6.0.13'
  )
    throw Error('Runtime version mismatch');
  for (const [file, sha] of Object.entries(m.files)) {
    if (
      createHash('sha256')
        .update(await readFile(`${base}/${file}`))
        .digest('hex') !== sha
    )
      throw Error('Integrity ' + file);
  }
  const wasm = await readFile(`${base}/wllama.wasm`);
  const { hasRelaxedDot } = await import('./verify-wasm.mjs');
  if ((await hasRelaxedDot(base + '/wllama.wasm')) !== (variant === 'relaxed'))
    throw Error('Target features');
  if (wasm.includes(Buffer.from('GLOSSIDE_PROFILE'))) throw Error('Profile binary forbidden');
  manifests[variant] = m;
}
for (const key of ['llama', 'dawn', 'tokenizer', 'relaxed'])
  if (manifests.simd.inputs[key] !== manifests.relaxed.inputs[key])
    throw Error('Build inputs differ');
const portableSha = createHash('sha256')
  .update(await readFile('vendor/patches/llama-wasm-portable-dot.patch'))
  .digest('hex');
if (manifests.simd.inputs.portable !== portableSha) throw Error('Portable dot patch missing');
for (const file of ['wllama.js', 'source-map.ts'])
  if (manifests.simd.files[file] !== manifests.relaxed.files[file])
    throw Error('Shared worker ABI or symbol map mismatch');
for (const file of ['wllama.js', 'wllama.wasm', 'source-map.ts'])
  await copyFile(`${root}/build-simd/${file}`, `vendor/runtime/${file}`);
await copyFile(`${root}/build-relaxed/wllama.wasm`, 'vendor/runtime/wllama-relaxed.wasm');
const m = JSON.parse(await readFile('vendor/runtime/manifest.json', 'utf8'));
m.abi = 'wllama-3.8.1-plamo3-simd-v3';
m.files = {
  ...manifests.simd.files,
  'wllama-relaxed.wasm': manifests.relaxed.files['wllama.wasm'],
};
m.optimizations = {
  systemProcessor: 'wasm',
  standardSIMD: true,
  relaxedSIMD: 'feature-detected integer-dot kernels',
  relaxedPatchSha256: manifests.relaxed.inputs.relaxed,
  portableDotPatchSha256: portableSha,
  relaxedPatchSource: 'https://github.com/ggml-org/llama.cpp/pull/19590#issuecomment-6536684785',
  archives: { llama: manifests.simd.inputs.llama, dawn: manifests.simd.inputs.dawn },
};
await writeFile('vendor/runtime/manifest.json', JSON.stringify(m, null, 2) + '\n');
const model = JSON.parse(await readFile('vendor/model-manifest.json', 'utf8'));
model.runtimeABI = m.abi;
await writeFile('vendor/model-manifest.json', JSON.stringify(model, null, 2) + '\n');
console.log('Promoted standard/relaxed candidates with matching static worker ABI.');
