// Rebuild the vendored inference binary. Requires Emscripten 6.0.13 and CMake.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve('dev/artifacts/runtime-rebuild');
await mkdir(root, { recursive: true });
const version = execFileSync('emcc', ['--version'], { encoding: 'utf8' });
if (!version.includes('6.0.13')) throw Error('Use pinned Emscripten 6.0.13');
const sha = '46ca246de9bb1c35269722a6240d37d9dfd79cad';
execFileSync('curl', [
  '-fsSL',
  `https://codeload.github.com/ggml-org/llama.cpp/tar.gz/${sha}`,
  '-o',
  root + '/llama.tar.gz',
]);
await mkdir(root + '/llama.cpp', { recursive: true });
execFileSync('tar', [
  '-xzf',
  root + '/llama.tar.gz',
  '--strip-components=1',
  '-C',
  root + '/llama.cpp',
]);
for (const p of ['CMakeLists.txt', 'cpp'])
  await cp('node_modules/@wllama/wllama/' + p, root + '/' + p, { recursive: true });
const series = (await readFile('vendor/patches/llama-plamo3-tokenizer.patch', 'utf8'))
  .split(/(?=^From [a-f0-9]{40} Mon Sep)/m)
  .filter((s) => s.trim());
for (let i = 0; i < series.length; i++) {
  const p = root + `/tokenizer-${i}.patch`;
  await writeFile(p, series[i]);
  execFileSync('git', ['apply', p], { cwd: root + '/llama.cpp' });
}
execFileSync('curl', [
  '-fsSL',
  'https://github.com/google/dawn/releases/download/v20260317.182325/emdawnwebgpu_pkg-v20260317.182325.zip',
  '-o',
  root + '/dawn.zip',
]);
execFileSync('python3', ['-m', 'zipfile', '-e', root + '/dawn.zip', root + '/emdawn']);
const env = { ...process.env, EM_CACHE: root + '/em-cache', CCACHE_DIR: root + '/ccache' };
execFileSync(
  'emcmake',
  [
    'cmake',
    '-S',
    root,
    '-B',
    root + '/build',
    '-DGGML_WEBGPU=ON',
    '-DGGML_WEBGPU_JSPI=ON',
    '-DEMDAWNWEBGPU_DIR=' + root + '/emdawn/emdawnwebgpu_pkg',
    '-DLLAMA_BUILD_TESTS=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_TOOLS=OFF',
    '-DLLAMA_CURL=OFF',
  ],
  { env, stdio: 'inherit' },
);
execFileSync('cmake', ['--build', root + '/build', '--target', 'wllama', '-j', '8'], {
  env,
  stdio: 'inherit',
});
console.log(
  'Runtime built in ' +
    root +
    '/build. Compare hashes, regenerate source map, and run model/tokenizer regression before promoting files into vendor/runtime.',
);
