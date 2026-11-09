import { MAX_MESSAGE, validateRequest, checkText } from '../shared/protocol';
import { originalPdf } from '../shared/pdf-equations';
import { AppError, errorCode } from '../shared/errors';
import { trusted, settings, host } from './runtime';

export const ports = new Map<string, chrome.runtime.Port>();
function ownerFor(port: chrome.runtime.Port, client: string) {
  const s = port.sender!;
  return `${(s.tab?.incognito ?? chrome.extension.inIncognitoContext) ? 'private' : 'normal'}:${s.tab?.id ?? 'ui'}:${s.documentId ?? s.url}:${client}`;
}
export function acceptPort(port: chrome.runtime.Port) {
  if (port.name !== 'translator-v1' || port.sender?.id !== chrome.runtime.id) {
    port.disconnect();
    return;
  }
  const s = port.sender;
  const ui = trusted(s);
  if (!ui && (!s.tab || !/^https?:/.test(s.url ?? ''))) {
    port.disconnect();
    return;
  }
  let owner = '';
  let pdfId = '';
  port.onMessage.addListener((message) => {
    void (async () => {
      if (!message || new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE)
        throw new AppError('INVALID_REQUEST');
      if (message.type === 'hello') {
        if (!/^[\w-]{1,64}$/.test(message.client) || owner) return;
        owner = ownerFor(port, message.client);
        ports.set(owner, port);
        port.postMessage({ type: 'settings', settings: await settings() });
        const lease = await host('lease', { owner });
        port.postMessage({ type: 'reconcile', ids: lease.requests ?? [] });
        await host('state', { owner });
        return;
      }
      if (!owner) throw new AppError('INVALID_REQUEST');
      if (message.type === 'pdf-prepare') {
        checkText(message.source);
        if (!/^[\w-]{1,64}$/.test(message.id) || ui || s.frameId !== 0 || !s.tab?.id)
          throw new AppError('INVALID_REQUEST');
        pdfId = message.id;
        const id = pdfId;
        // Never accept a fetch URL supplied by page content. Bind it to the
        // sender's current top-level document and discard results on navigation.
        const tab = await chrome.tabs.get(s.tab.id);
        if (pdfId !== id) return;
        const url = new URL(s.url!);
        url.hash = '';
        const current = new URL(tab.url ?? 'about:blank');
        current.hash = '';
        if (
          !/^https?:$/.test(url.protocol) ||
          url.username ||
          url.password ||
          current.href !== url.href
        )
          throw new AppError('SOURCE_CHANGED');
        let plan = originalPdf(message.source);
        try {
          plan =
            (await host('pdf-prepare', { owner, id, url: url.href, source: message.source }))
              .plan ?? plan;
        } catch {
          /* Keep the source when parsing or permission checks fail. */
        }
        if (pdfId !== id || ports.get(owner) !== port) return;
        const latest = await chrome.tabs.get(s.tab.id);
        const latestUrl = new URL(latest.url ?? 'about:blank');
        latestUrl.hash = '';
        if (latestUrl.href !== url.href) plan = originalPdf(message.source);
        port.postMessage({ type: 'pdf-plan', id, plan });
        pdfId = '';
      } else if (message.type === 'pdf-cancel') {
        if (pdfId === message.id) {
          pdfId = '';
          await host('pdf-cancel', { owner, id: message.id });
        }
      } else if (message.type === 'prepare') {
        const config = await settings();
        if (config.modelConsent && config.memoryMode !== 'economy') await host('prepare');
      } else if (message.type === 'translate') {
        const r = validateRequest(message.request);
        if (
          !ui &&
          r.surface !== 'html' &&
          !(r.surface === 'native-selection' && r.mode === 'selection')
        )
          throw new AppError('INVALID_REQUEST');
        await host('submit', { owner, request: r });
      } else if (message.type === 'cancel') await host('cancel', { owner, id: message.id });
      else if (message.type === 'pin')
        await host('pin', { owner, id: message.id, pinned: message.pinned === true });
      else if (message.type === 'lease') {
        const lease = await host('lease', { owner });
        port.postMessage({ type: 'reconcile', ids: lease.requests ?? [] });
      }
    })().catch((e) => {
      if (message?.type === 'pdf-prepare') {
        try {
          port.postMessage({
            type: 'pdf-plan',
            id: message.id,
            plan: originalPdf(typeof message.source === 'string' ? message.source : ''),
          });
        } catch {}
        return;
      }
      port.postMessage({
        type: 'event',
        event: {
          type: 'error',
          requestId: message?.request?.requestId ?? '',
          sequence: 2147483647,
          code: errorCode(e),
        },
      });
    });
  });
  port.onDisconnect.addListener(() => {
    if (pdfId) void host('pdf-cancel', { owner, id: pdfId }).catch(() => {});
    pdfId = '';
    if (ports.get(owner) === port)
      ports.delete(owner); /* lease permits SW restart / transient reconnect */
  });
}
export function deliverHostEvent(message: any) {
  if (message.owner) {
    const p = ports.get(message.owner);
    try {
      p?.postMessage(
        message.event
          ? { type: 'event', event: message.event }
          : { type: 'model', model: message.model },
      );
    } catch {}
  } else if (message.model)
    for (const p of ports.values())
      try {
        p.postMessage({ type: 'model', model: message.model });
      } catch {}
}
