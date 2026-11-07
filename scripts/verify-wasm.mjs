import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
// Optimized binaries strip target_features. Inspect decoded instructions without
// buffering the full (large) text representation or matching arbitrary data bytes.
export async function hasRelaxedDot(file) {
  const binaryen = execFileSync('em-config', ['BINARYEN_ROOT'], { encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(binaryen, 'bin/wasm-dis'), [file], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let found = false,
      tail = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const text = tail + chunk;
      found ||= /\(i(?:16|32)x[48]\.relaxed_dot_/.test(text);
      tail = text.slice(-80);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(found) : reject(Error('WASM disassembly failed')),
    );
  });
}
