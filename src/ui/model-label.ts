import type { ModelState } from '../shared/types';
import { explain } from '../shared/errors';
export function modelLabel(s: ModelState) {
  if (s.state === 'DOWNLOADING')
    return `ダウンロード中 ${Math.round((s.received ?? 0) / 1e6)} / ${Math.round((s.total ?? 0) / 1e6)} MB`;
  if (s.state === 'FAILED')
    return s.code === 'PAUSED' ? 'ダウンロードを一時停止中' : explain(s.code ?? 'DOWNLOAD_FAILED');
  return (
    (
      {
        ABSENT: 'モデル未ダウンロード',
        PAUSED: 'ダウンロードを再開できます',
        VERIFYING: 'ダウンロードを検証中',
        READY_ON_DISK: 'モデルをダウンロード済み',
        LOADING: 'モデルを読み込み中',
        WARMING: '翻訳の準備中',
        READY: `準備完了（${s.backend ?? 'ローカル'}）`,
        RUNNING: '翻訳中',
        TUNING: '端末の処理速度を計測中',
        RECOVERING: 'CPUに切り替え中',
        UNLOADING: 'メモリ解放中',
      } as Record<string, string>
    )[s.state] ?? s.state
  );
}
