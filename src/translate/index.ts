import { localizePage } from '../ui/locale';
import { mountTextTranslator, popupDraftKey } from './controller';

localizePage();
mountTextTranslator(
  document,
  new URLSearchParams(location.search).get('from') === 'popup'
    ? { read: popupDraftKey() }
    : undefined,
);
