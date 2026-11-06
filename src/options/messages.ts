import type { ModelState } from '../shared/types';
import { locale } from '../ui/locale';
import { explain } from '../shared/errors';
import { modelLabel } from '../ui/model-label';
const errors: Record<string, string> = {
  MODEL_NOT_READY: 'Download the translation model first.',
  MODEL_INTEGRITY_FAILED: 'Model verification failed. Delete the model and download it again.',
  MODEL_INCOMPATIBLE:
    'The model could not be loaded in this environment. Export diagnostics for details.',
  DOWNLOAD_FAILED:
    'Download failed. Check your connection and download permissions, then try again.',
  DOWNLOAD_NETWORK_FAILED:
    'Could not connect to the model server. Check your connection and download permissions, then resume.',
  DOWNLOAD_HOST_REJECTED:
    'The model redirected to an unapproved host. Update the extension before retrying.',
  MEMORY_LIMIT: 'Not enough memory or storage is available. Free up space and try again.',
  RESERVED_TOKEN: 'The source contains a reserved model token and cannot be translated.',
  INPUT_LIMIT: 'The input is too long. Translate a smaller selection.',
  OUTPUT_LIMIT: 'The translation reached its output limit and is incomplete.',
  INVALID_REQUEST: 'This action could not be completed. Check your settings and try again.',
  PERMISSION_REQUIRED: 'Permission is required. Allow access from the extension panel.',
  SOURCE_CHANGED: 'The source changed. The previous result was discarded.',
  HOST_INTERRUPTED: 'The translation engine disconnected. Please try again.',
  QUEUE_FULL: 'The queue is full. Wait for a translation to finish and try again.',
  UNSUPPORTED_SURFACE: 'This feature is not available on the current page or browser.',
  CANCELLED: 'Cancelled.',
  ENGINE_BUSY: 'Wait for the current translation or model operation to finish, then try again.',
  TUNING_UNSTABLE:
    'Measurements varied too much. Existing processing settings were kept. Try again when the device is idle.',
};
export function explainSettingsError(code: string) {
  if (locale === 'ja') return explain(code);
  const http = /^DOWNLOAD_HTTP_(\d{3})$/.exec(code);
  if (http)
    return `The model server returned HTTP ${http[1]}. Resume later, or update the extension if this persists.`;
  return errors[code] ?? 'The action failed. Please try again.';
}
export function settingsModelLabel(s: ModelState) {
  if (s.state === 'READY') return '';
  if (locale === 'ja') return modelLabel(s);
  if (s.state === 'DOWNLOADING')
    return `Downloading: ${Math.round((s.received ?? 0) / 1e6)} / ${Math.round((s.total ?? 0) / 1e6)} MB`;
  if (s.state === 'FAILED')
    return s.code === 'PAUSED'
      ? 'Download paused'
      : explainSettingsError(s.code ?? 'DOWNLOAD_FAILED');
  return (
    (
      {
        ABSENT: 'Not downloaded',
        PAUSED: 'Download paused',
        VERIFYING: 'Verifying model…',
        READY_ON_DISK: 'Downloaded',
        LOADING: 'Loading model…',
        WARMING: 'Preparing model…',
        RUNNING: 'Translating…',
        TUNING: 'Measuring device performance…',
        RECOVERING: 'Recovering on CPU…',
        UNLOADING: 'Releasing memory…',
      } as Record<string, string>
    )[s.state] ?? 'Checking model…'
  );
}
