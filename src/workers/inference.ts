import { ModelRuntime } from '../inference/runtime';
import { translate } from '../inference/translate';
import { tune } from '../inference/tuning';
import { AppError, errorCode } from '../shared/errors';

const runtime = new ModelRuntime((value) => postMessage({ type: 'model', value }));
const snapshot = (text: string) => postMessage({ type: 'snapshot', text });
let controller: AbortController | undefined;

self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (data.type === 'unload') {
    await runtime.unload();
    return;
  }
  if (data.type === 'prepare') {
    try {
      runtime.profile = data.profile;
      await runtime.prepare(data.cpu === true);
      postMessage({ type: 'prepared' });
    } catch (e) {
      postMessage({ type: 'error', code: errorCode(e, 'MODEL_INCOMPATIBLE') });
    }
    return;
  }
  if (data.type === 'tune') {
    controller = new AbortController();
    try {
      postMessage({
        type: 'tuned',
        profile: await tune(runtime, data.cpu === true, controller.signal),
      });
    } catch (e) {
      postMessage({
        type: 'error',
        code: controller.signal.aborted ? 'CANCELLED' : errorCode(e, 'MODEL_INCOMPATIBLE'),
      });
    } finally {
      controller = undefined;
    }
    return;
  }
  if (data.type !== 'run') return;
  runtime.profile = data.profile;
  controller = new AbortController();
  try {
    let result;
    try {
      result = await translate(
        runtime,
        data.request,
        controller.signal,
        data.cpu === true,
        snapshot,
      );
    } catch (e) {
      if (controller.signal.aborted || e instanceof AppError || runtime.backend !== 'GPU') throw e;
      await runtime.unload();
      runtime.state('RECOVERING');
      snapshot('');
      result = await translate(runtime, data.request, controller.signal, true, snapshot);
      runtime.retainFallbackPreference(data.cpu === true); // Keep the fallback for this preference until unload.
    }
    postMessage({ type: 'result', result });
  } catch (e) {
    if (controller.signal.aborted) {
      if (runtime.loaded) runtime.state('READY');
      postMessage({ type: 'error', code: 'CANCELLED' });
    } else {
      await runtime.unload();
      postMessage({ type: 'error', code: errorCode(e, 'MODEL_INCOMPATIBLE') });
    }
  } finally {
    controller = undefined;
  }
};
