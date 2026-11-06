import { Client } from '../shared/client';
import { SelectionUI } from '../ui/selection';
import { FullPage } from './full-page';
import { NativePdfSelection } from '../native-pdf/selection';
import { extensionContextAlive } from '../shared/runtime-context';
// ISOLATED-world guard; the host page cannot replace this property.
const scope = globalThis as typeof globalThis & { __localTranslator?: boolean };
if (!scope.__localTranslator && extensionContextAlive()) {
  scope.__localTranslator = true;
  const client = new Client();
  let epoch = crypto.randomUUID();
  const isNativePdf = document.contentType === 'application/pdf';
  const selection = new SelectionUI(client, {
    surface: isNativePdf ? 'native-selection' : 'html',
    epoch: () => epoch,
  });
  const native = isNativePdf
    ? new NativePdfSelection((text, settled, explicit, point) =>
        selection.captureNative(text, settled, explicit, point),
      )
    : undefined;
  const page = isNativePdf ? undefined : new FullPage(client);
  const capture = (explicit: boolean) =>
    native ? native.refresh(explicit) : selection.capture(explicit);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    native?.destroy();
    selection.destroy();
    page?.restore();
    client.close();
    scope.__localTranslator = false;
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {}
  };
  client.onRevoked = stop;
  client.onSettings = () => {
    selection.close();
    page?.restore();
    native?.configurePosition(client.settings.nativePdfPosition && !client.settings.panelOnly);
    if (native && !document.hidden) client.prepare();
    capture(false);
  };
  const listener = (message: any, sender: chrome.runtime.MessageSender) => {
    if (stopped) return;
    if (!extensionContextAlive()) {
      stop();
      return;
    }
    if (sender.id !== chrome.runtime.id || message?.channel !== 'page-command') return;
    if (message.action === 'activate-tab') {
      native?.configurePosition(
        client.settings.nativePdfPosition && !client.settings.panelOnly,
        true,
      );
      capture(false);
    } else if (message.action === 'selection') capture(true);
    else if (message.action === 'page') page?.start();
    else if (message.action === 'restore') page?.restore();
  };
  // The runtime can disappear between injection, port setup and registration.
  try {
    if (extensionContextAlive()) chrome.runtime.onMessage.addListener(listener);
    else stop();
  } catch {
    stop();
  }
  if (!stopped)
    addEventListener(
      'pagehide',
      () => {
        epoch = crypto.randomUUID();
        stop();
      },
      { once: true },
    );
}
