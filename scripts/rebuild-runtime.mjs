// Build pinned runtimes without changing the shipped files. Promote only after validation.
// node scripts/rebuild-runtime.mjs --variant=simd|relaxed|profile|profile-gpu
import { readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const variant = process.argv.find((a) => a.startsWith('--variant='))?.split('=')[1] ?? 'simd';
if (!['simd', 'relaxed', 'profile', 'profile-gpu', 'relaxed-batch128'].includes(variant))
  throw Error('Unknown runtime variant');
const root = path.resolve('dev/artifacts/runtime-rebuild');
const source = root + '/source';
const build = root + '/build-' + variant;
const sha = '46ca246de9bb1c35269722a6240d37d9dfd79cad';
const inputs = {
  llama: 'c76f86403bca39af3bbbd21485309714d7610ece2d81324f828cc68c920a851d',
  dawn: '8dcae86c630d76b6794b271c6572becba36f4237d132bee121a56638c3d76575',
  tokenizer: '862088fb3f634b862b000288fd0d22c2b8f71a9bc3d1f3559ae5268fc4848d1d',
  relaxed: 'ae47f43b8e4161deee1d033bfb65e8a9adc55d31b80a02735d6b27c1548b1aaf',
  portable: '0c78ba0fe2ccce8ca4b79249929164d515893dcc3b78b18d2bb9ad097ba7da20',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });
await mkdir(root, { recursive: true });
if (!execFileSync('emcc', ['--version'], { encoding: 'utf8' }).includes('6.0.13'))
  throw Error('Use pinned Emscripten 6.0.13');
const pkg = JSON.parse(await readFile('node_modules/@wllama/wllama/package.json', 'utf8'));
if (pkg.version !== '3.8.1') throw Error('Use pinned wllama 3.8.1');
async function archive(name, url, expected) {
  const file = root + '/' + name;
  if (!(await exists(file))) run('curl', ['-fSL', '--retry', '2', url, '-o', file]);
  if (hash(await readFile(file)) !== expected) throw Error('Archive integrity failed: ' + name);
}
await archive(
  'llama.tar.gz',
  `https://codeload.github.com/ggml-org/llama.cpp/tar.gz/${sha}`,
  inputs.llama,
);
await archive(
  'dawn.zip',
  'https://github.com/google/dawn/releases/download/v20260317.182325/emdawnwebgpu_pkg-v20260317.182325.zip',
  inputs.dawn,
);
for (const [name, expected] of [
  ['llama-plamo3-tokenizer.patch', inputs.tokenizer],
  ['llama-wasm-relaxed-simd.patch', inputs.relaxed],
  ['llama-wasm-portable-dot.patch', inputs.portable],
]) {
  if (hash(await readFile('vendor/patches/' + name)) !== expected)
    throw Error('Patch integrity failed: ' + name);
}
// Re-extract into a dedicated generated directory: never reapply patches to a dirty tree.
await rm(source, { recursive: true, force: true });
await mkdir(source + '/llama.cpp', { recursive: true });
run('tar', ['-xzf', root + '/llama.tar.gz', '--strip-components=1', '-C', source + '/llama.cpp']);
for (const p of ['CMakeLists.txt', 'cpp'])
  await cp('node_modules/@wllama/wllama/' + p, source + '/' + p, { recursive: true });
const series = (await readFile('vendor/patches/llama-plamo3-tokenizer.patch', 'utf8'))
  .split(/(?=^From [a-f0-9]{40} Mon Sep)/m)
  .filter((s) => s.trim());
for (let i = 0; i < series.length; i++) {
  const file = root + `/tokenizer-${i}.patch`;
  await writeFile(file, series[i]);
  run('patch', ['-p1', '--batch', '--forward', '-i', file], { cwd: source + '/llama.cpp' });
}
run(
  'patch',
  [
    '-p1',
    '--batch',
    '--forward',
    '-i',
    path.resolve('vendor/patches/llama-wasm-relaxed-simd.patch'),
  ],
  { cwd: source + '/llama.cpp' },
);
if (!variant.startsWith('relaxed')) {
  run(
    'patch',
    [
      '-p1',
      '--batch',
      '--forward',
      '-i',
      path.resolve('vendor/patches/llama-wasm-portable-dot.patch'),
    ],
    { cwd: source + '/llama.cpp' },
  );
}
// git apply inside an ignored directory can silently skip paths relative to the parent repo.
if (
  !(await readFile(source + '/llama.cpp/src/llama-vocab.cpp', 'utf8')).includes(
    'tokenizer_model == "plamo3"',
  ) ||
  !(await readFile(source + '/llama.cpp/ggml/src/ggml-cpu/arch/wasm/quants.c', 'utf8')).includes(
    '__wasm_relaxed_simd__',
  )
)
  throw Error('Runtime patches were not applied');
if (variant.startsWith('profile')) {
  const { instrumentWebGPU } = await import('./profile-webgpu.mjs');
  await instrumentWebGPU(source + '/llama.cpp/ggml/src/ggml-webgpu/ggml-webgpu.cpp');
}
if (variant === 'relaxed-batch128') {
  const file = source + '/llama.cpp/ggml/src/ggml-webgpu/ggml-webgpu.cpp';
  const cpp = await readFile(file, 'utf8');
  const from = '#define WEBGPU_DEFAULT_COMMAND_SUBMIT_BATCH_SIZE 64u';
  if (!cpp.includes(from)) throw Error('Submit batch experiment requires review');
  await writeFile(file, cpp.replace(from, '#define WEBGPU_DEFAULT_COMMAND_SUBMIT_BATCH_SIZE 128u'));
}
// Restrict relaxed instructions to the explicitly audited integer-dot kernels.
await writeFile(
  source + '/CMakeLists.txt',
  (await readFile(source + '/CMakeLists.txt', 'utf8')) +
    `
if(GLOSSIDE_RELAXED_SIMD)
  set_property(SOURCE "\${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/src/ggml-cpu/arch/wasm/quants.c"
    DIRECTORY "\${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/src"
    APPEND PROPERTY COMPILE_OPTIONS -mrelaxed-simd)
  target_link_options(wllama PRIVATE -mrelaxed-simd)
endif()
`,
);
run('python3', ['-m', 'zipfile', '-e', root + '/dawn.zip', root + '/emdawn']);
const env = { ...process.env, EM_CACHE: root + '/em-cache', CCACHE_DIR: root + '/ccache' };
if (!(await exists(env.EM_CACHE)) && (await exists('dev/artifacts/em-cache')))
  await cp('dev/artifacts/em-cache', env.EM_CACHE, { recursive: true });
run(
  'emcmake',
  [
    'cmake',
    '-S',
    source,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    // Emscripten otherwise advertises x86, which selects GGML_CPU_GENERIC.
    '-DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm',
    '-DGLOSSIDE_RELAXED_SIMD=' + (variant.startsWith('relaxed') ? 'ON' : 'OFF'),
    '-DGGML_WEBGPU=ON',
    '-DGGML_WEBGPU_JSPI=ON',
    '-DGGML_OPENMP=OFF',
    '-DGGML_WEBGPU_CPU_PROFILE=' + (variant.startsWith('profile') ? 'ON' : 'OFF'),
    '-DGGML_WEBGPU_GPU_PROFILE=' + (variant === 'profile-gpu' ? 'ON' : 'OFF'),
    '-DEMDAWNWEBGPU_DIR=' + root + '/emdawn/emdawnwebgpu_pkg',
    '-DLLAMA_BUILD_TESTS=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_TOOLS=OFF',
    '-DLLAMA_CURL=OFF',
  ],
  { env, cwd: root },
);
const cpuBuild = build + '/llama.cpp/ggml/src/CMakeFiles/ggml-cpu.dir/';
if (
  !(await readFile(cpuBuild + 'build.make', 'utf8')).includes('arch/wasm/quants.c.o') ||
  (await readFile(cpuBuild + 'flags.make', 'utf8')).includes('GGML_CPU_GENERIC')
)
  throw Error('WASM SIMD kernel selection failed');
run('cmake', ['--build', build, '--target', 'wllama', '-j', '6'], { env, cwd: root });
const { hasRelaxedDot } = await import('./verify-wasm.mjs');
if ((await hasRelaxedDot(build + '/wllama.wasm')) !== variant.startsWith('relaxed'))
  throw Error('Compiled WASM target features do not match the requested variant');
run('node', [
  'node_modules/@wllama/wllama/scripts/build_source_map.js',
  '--input',
  'default:' + build,
  '--output',
  build + '/source-map.ts',
]);
const files = {};
for (const name of ['wllama.js', 'wllama.wasm', 'source-map.ts'])
  files[name] = hash(await readFile(build + '/' + name));
await writeFile(
  build + '/build-manifest.json',
  JSON.stringify(
    {
      variant,
      llamaCpp: sha,
      emscripten: '6.0.13',
      wllama: pkg.version,
      inputs,
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log('Runtime built and SIMD selection verified: ' + build);
