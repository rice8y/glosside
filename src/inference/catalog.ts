import manifest from '../../vendor/model-manifest.json';
export const MODEL = { ...manifest, quantization: 'Q4_K_M', runtime: manifest.runtimeABI };
export const MODEL_ARTIFACTS = [MODEL, ...manifest.legacy];
export const MODEL_URL = `https://huggingface.co/${MODEL.repository}/resolve/${MODEL.revision}/${MODEL.filename}`;
export const MODEL_ORIGINS = ['https://huggingface.co/*', 'https://*.hf.co/*'];
export function allowedDownload(url: string) {
  const u = new URL(url);
  return (
    u.protocol === 'https:' && (u.hostname === 'huggingface.co' || u.hostname.endsWith('.hf.co'))
  );
}
