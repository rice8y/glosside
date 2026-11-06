import type { TranslationEvent } from '../shared/types';
import { explain } from '../shared/errors';

export function translationStatus(event: TranslationEvent): string {
  switch (event.type) {
    case 'complete':
      return '完了';
    case 'incomplete':
      return (
        '翻訳未完了：' +
        (event.reason === 'output-limit' ? explain('OUTPUT_LIMIT') : '翻訳を中止しました')
      );
    case 'error':
      return explain(event.code!);
    default:
      return '翻訳中';
  }
}
