export const messages: Record<string, string> = {
  CANCELLED: '処理を中止しました。',
  ENGINE_BUSY: '翻訳やモデルの処理が終わってから、もう一度お試しください。',
  TUNING_UNSTABLE:
    '計測結果が安定しませんでした。不要なタブやアプリを閉じて、もう一度計測してください。',
  MODEL_NOT_READY: 'モデルの準備が必要です。設定からダウンロードしてください。',
  MODEL_INTEGRITY_FAILED:
    'モデルの検証に失敗しました。設定からモデルを削除し、ダウンロードし直してください。',
  MODEL_INCOMPATIBLE:
    'モデルを読み込めませんでした。設定から診断情報を書き出して確認してください。',
  DOWNLOAD_FAILED:
    'ダウンロードできませんでした。ネットワーク接続と配信元へのアクセス許可を確認し、再開してください。',
  DOWNLOAD_NETWORK_FAILED:
    'モデル配布元に接続できません。ネットワーク接続と配信元へのアクセス許可を確認して再開してください。',
  DOWNLOAD_HOST_REJECTED:
    'モデルの転送先が許可された配布元ではありません。拡張を更新してください。',
  MEMORY_LIMIT:
    '利用できるメモリまたは保存容量が不足しています。不要なタブを閉じるか、保存容量を空けて再試行してください。',
  RESERVED_TOKEN: '原文にモデル専用の記号（<|plamo:）が含まれるため翻訳できません。',
  INPUT_LIMIT: '文章が長すぎます。分けて翻訳してください。',
  OUTPUT_LIMIT: '訳文の長さが上限に達しました。原文を分けて翻訳してください。',
  INVALID_TRANSLATION: '訳文を取得できませんでした。再試行してください。',
  INVALID_REQUEST: '翻訳依頼を受け付けられませんでした。',
  PERMISSION_REQUIRED: 'このサイトで使う許可が必要です。翻訳パネルから許可してください。',
  SOURCE_CHANGED: '原文が変更されたため、古い結果を破棄しました。',
  HOST_INTERRUPTED: '翻訳処理との接続が切れました。再試行してください。',
  QUEUE_FULL: '処理待ちが上限に達しました。少し待って再試行してください。',
  UNSUPPORTED_SURFACE:
    'このページでは翻訳できません。サイドパネルに文章を貼り付けて翻訳してください。',
};
export class AppError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function errorCode(e: unknown, fallback = 'HOST_INTERRUPTED') {
  return e instanceof AppError ? e.code : fallback;
}
export function explain(code: string) {
  const http = /^DOWNLOAD_HTTP_(\d{3})$/.exec(code);
  if (http)
    return `モデル配布元がHTTP ${http[1]}を返しました。時間をおいて再開し、続く場合は拡張を更新してください。`;
  return messages[code] ?? '処理できませんでした。再試行してください。';
}
