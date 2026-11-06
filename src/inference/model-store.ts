import { createSHA256 } from 'hash-wasm';
import { MODEL, MODEL_ARTIFACTS, MODEL_URL, allowedDownload } from './catalog';
import { AppError } from '../shared/errors';
import type { ModelState } from '../shared/types';
const partial = MODEL.sha256 + '.partial',
  ready = MODEL.sha256 + '.gguf';
async function root() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle('models', { create: true });
}
async function remove(name: string) {
  await (await root()).removeEntry(name).catch(() => {});
}
export async function modelFile(verify = true): Promise<File> {
  const dir = await root();
  let corrupt = false;
  for (const artifact of MODEL_ARTIFACTS) {
    let file: File;
    const name = artifact.sha256 + '.gguf';
    try {
      file = await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') continue;
      throw error;
    }
    if (file.size !== artifact.bytes || (verify && !(await verifyFile(file, artifact)))) {
      await remove(name);
      corrupt = true;
      continue;
    }
    return file;
  }
  throw new AppError(corrupt ? 'MODEL_INTEGRITY_FAILED' : 'MODEL_NOT_READY');
}
export async function verifyFile(file: Blob, artifact: { bytes: number; sha256: string } = MODEL) {
  if (file.size !== artifact.bytes) return false;
  const hash = await createSHA256();
  hash.init();
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return hash.digest('hex') === artifact.sha256;
}
export async function diskState(): Promise<ModelState> {
  try {
    await modelFile(false);
    return { state: 'READY_ON_DISK' };
  } catch {}
  try {
    const f = await (await (await root()).getFileHandle(partial)).getFile();
    return { state: 'PAUSED', received: f.size, total: MODEL.bytes };
  } catch {
    return { state: 'ABSENT' };
  }
}
export async function downloadModel(signal: AbortSignal, progress: (state: ModelState) => void) {
  const dir = await root();
  const file = await dir.getFileHandle(partial, { create: true });
  let offset = (await file.getFile()).size;
  const estimate = await navigator.storage.estimate();
  if (
    estimate.quota &&
    estimate.usage &&
    estimate.quota - estimate.usage < MODEL.bytes - offset + MODEL.bytes
  )
    throw new AppError('MEMORY_LIMIT');
  if (offset > MODEL.bytes) {
    await remove(partial);
    throw new AppError('MODEL_INTEGRITY_FAILED');
  }
  if (offset < MODEL.bytes) {
    let response: Response;
    try {
      response = await fetch(MODEL_URL, {
        headers: offset ? { Range: `bytes=${offset}-` } : {},
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AppError('DOWNLOAD_NETWORK_FAILED');
    }
    if (!allowedDownload(response.url)) {
      await response.body?.cancel();
      throw new AppError('DOWNLOAD_HOST_REJECTED');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`DOWNLOAD_HTTP_${response.status}`);
    }
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      if (!match || Number(match[1]) !== offset || Number(match[3]) !== MODEL.bytes)
        throw new AppError('DOWNLOAD_FAILED');
    } else if (response.status === 200) offset = 0;
    else throw new AppError('DOWNLOAD_FAILED');
    const writer = await file.createWritable({ keepExistingData: offset > 0 });
    await writer.seek(offset);
    const reader = response.body?.getReader();
    if (!reader) {
      await writer.close();
      throw new AppError('DOWNLOAD_FAILED');
    }
    let last = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        offset += value.byteLength;
        if (offset > MODEL.bytes) throw new AppError('MODEL_INTEGRITY_FAILED');
        await writer.write(value);
        if (performance.now() - last > 150) {
          progress({ state: 'DOWNLOADING', received: offset, total: MODEL.bytes });
          last = performance.now();
        }
      }
    } finally {
      await writer.close();
      await reader.cancel().catch(() => {});
    }
  }
  signal.throwIfAborted();
  progress({ state: 'VERIFYING', received: offset, total: MODEL.bytes });
  const downloaded = await file.getFile();
  if (!(await verifyFile(downloaded))) {
    await remove(partial);
    throw new AppError('MODEL_INTEGRITY_FAILED');
  }
  // A separate committed file means an interrupted copy is never mistaken for a verified download.
  const target = await dir.getFileHandle(ready, { create: true });
  const writer = await target.createWritable();
  try {
    await downloaded.stream().pipeTo(writer);
  } catch (e) {
    await remove(ready);
    throw e;
  }
  await remove(partial);
  progress({ state: 'READY_ON_DISK' });
}
export async function deleteModel() {
  for (const artifact of MODEL_ARTIFACTS) {
    await remove(artifact.sha256 + '.gguf');
    await remove(artifact.sha256 + '.partial');
  }
}
