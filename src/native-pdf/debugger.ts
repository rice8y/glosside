import { installPdfObserver } from './observer';
import type { Settings } from '../shared/types';
const VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
const BINDING = '__localTranslatePdfPosition';
type Target = chrome.debugger.DebuggerSession;
interface Frame {
  target: Target;
  parent: Target;
  frameId: string;
  role: 'viewer' | 'pdf';
  contextId?: number;
}
interface Watch {
  tabId: number;
  documentId: string;
  url: string;
  token: string;
  frames: Map<string, Frame>;
  sequence: number;
  gesture: number;
  attached: boolean;
  closed: boolean;
  lease?: ReturnType<typeof setInterval>;
  startup?: ReturnType<typeof setTimeout>;
}
const watches = new Map<number, Watch>();
const starts = new Map<number, Promise<unknown>>();
// A Chrome-side cancellation must not be undone by polling, visibility or reconnection.
const blocked = new Set<number>();
const command = <T = any>(target: Target, method: string, params = {}) =>
  chrome.debugger.sendCommand(target, method, params) as Promise<T>;
const live = (watch: Watch) => !watch.closed && watches.get(watch.tabId) === watch;
const samePdf = (left: string, right: string) => left.split('#')[0] === right.split('#')[0];
function notify(watch: Watch, kind: string, extra = {}) {
  if (!live(watch) && kind !== 'detached') return;
  void chrome.tabs
    .sendMessage(
      watch.tabId,
      {
        channel: 'native-pdf-position',
        token: watch.token,
        sequence: ++watch.sequence,
        kind,
        ...extra,
      },
      { documentId: watch.documentId },
    )
    .catch(() => {});
}
function enqueue<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const next = (starts.get(tabId) ?? Promise.resolve()).catch(() => {}).then(operation);
  starts.set(tabId, next);
  void next
    .finally(() => {
      if (starts.get(tabId) === next) starts.delete(tabId);
    })
    .catch(() => {});
  return next;
}
export function stopPdfWatch(tabId: number, documentId?: string, token?: string) {
  return enqueue(tabId, () => stop(tabId, documentId, token));
}
async function stop(tabId: number, documentId?: string, token?: string) {
  const watch = watches.get(tabId);
  if (!watch || (documentId && watch.documentId !== documentId) || (token && token !== watch.token))
    return;
  watch.closed = true;
  watches.delete(tabId);
  clearInterval(watch.lease);
  clearTimeout(watch.startup);
  await Promise.allSettled(
    [...watch.frames.values()].map(async (frame) => {
      if (frame.contextId === undefined) return;
      await command(frame.target, 'Runtime.evaluate', {
        contextId: frame.contextId,
        expression: 'globalThis.__localPdfObserver?.destroy()',
      });
      await command(frame.target, 'Runtime.removeBinding', { name: BINDING });
    }),
  );
  if (watch.attached) await chrome.debugger.detach({ tabId }).catch(() => {});
  notify(watch, 'detached');
}
export async function stopAllPdfWatches() {
  await Promise.allSettled(
    [...new Set([...watches.keys(), ...starts.keys()])].map((tabId) => stopPdfWatch(tabId)),
  );
}
export function startPdfWatch(
  sender: chrome.runtime.MessageSender,
  token: string,
  explicit = false,
) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return Promise.resolve({ ok: false });
  return enqueue(tabId, () => start(sender, token, explicit));
}
async function start(sender: chrome.runtime.MessageSender, token: string, explicit = false) {
  const { tab, documentId, frameId, url } = sender;
  if (
    sender.id !== chrome.runtime.id ||
    !tab?.id ||
    frameId !== 0 ||
    !documentId ||
    !/^https?:/.test(url ?? '') ||
    typeof token !== 'string' ||
    !/^[\w-]{1,64}$/.test(token)
  )
    return { ok: false };
  if (explicit) {
    blocked.delete(tab.id);
    await chrome.storage.session.remove('pdf-debugger-blocked-' + tab.id);
  }
  if (
    blocked.has(tab.id) ||
    (await chrome.storage.session.get('pdf-debugger-blocked-' + tab.id))[
      'pdf-debugger-blocked-' + tab.id
    ]
  )
    return { ok: false, reason: 'cancelled' };
  const previous = watches.get(tab.id);
  if (previous?.documentId === documentId && previous.token === token) return { ok: true };
  await stop(tab.id);
  // A content-script message alone is insufficient: confirm the same permitted top document.
  const checks = await chrome.scripting.executeScript({
    target: { tabId: tab.id, documentIds: [documentId] },
    func: () => ({ pdf: document.contentType === 'application/pdf', visible: !document.hidden }),
  });
  if (!checks[0]?.result?.pdf || !checks[0].result.visible) return { ok: false };
  const config = await chrome.storage.local.get<{ settings?: Partial<Settings> }>('settings');
  if (config.settings?.nativePdfPosition === false || config.settings?.panelOnly === true)
    return { ok: false };
  const watch: Watch = {
    tabId: tab.id,
    documentId,
    url: url!,
    token,
    frames: new Map(),
    sequence: 0,
    gesture: 0,
    attached: false,
    closed: false,
  };
  watches.set(tab.id, watch);
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    watch.attached = true;
    if (!live(watch)) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
      return { ok: false };
    }
    const { frameTree } = await command({ tabId: tab.id }, 'Page.getFrameTree');
    if (frameTree?.frame?.mimeType !== 'application/pdf' || !samePdf(frameTree.frame.url, url!))
      throw Error('PDF document changed');
    if (!live(watch)) return { ok: false };
    notify(watch, 'attached');
    watch.startup = setTimeout(() => {
      if (live(watch)) void stopPdfWatch(watch.tabId, watch.documentId);
    }, 5000);
    await command({ tabId: tab.id }, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: 'iframe', exclude: false }],
    });
    if (!live(watch)) return { ok: false };
    watch.lease = setInterval(() => {
      if (!live(watch)) return;
      for (const frame of watch.frames.values())
        if (frame.contextId !== undefined)
          void command(frame.target, 'Runtime.evaluate', {
            contextId: frame.contextId,
            expression: 'globalThis.__localPdfObserver?.renew()',
          }).catch(() => {});
    }, 4000);
    return { ok: true };
  } catch {
    await stop(tab.id, documentId);
    return { ok: false, reason: 'unavailable' };
  }
}
async function install(watch: Watch, frame: Frame) {
  const { executionContextId } = await command(frame.target, 'Page.createIsolatedWorld', {
    frameId: frame.frameId,
    worldName: 'local-translate-pdf-position',
  });
  frame.contextId = executionContextId;
  if (!live(watch)) return;
  await command(frame.target, 'Runtime.enable');
  await command(frame.target, 'Runtime.addBinding', { name: BINDING, executionContextId });
  for (let attempt = 0; attempt < 20 && live(watch); attempt++) {
    const result = await command(frame.target, 'Runtime.evaluate', {
      contextId: executionContextId,
      returnByValue: true,
      expression: `(${installPdfObserver.toString()})(${JSON.stringify(BINDING)},${JSON.stringify(frame.role)})`,
    });
    if (result.result?.value === true) {
      if (frame.role === 'pdf') clearTimeout(watch.startup);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function frameBox(frame: Frame) {
  const owner = await command(frame.parent, 'DOM.getFrameOwner', { frameId: frame.frameId });
  const { model } = await command(frame.parent, 'DOM.getBoxModel', {
    backendNodeId: owner.backendNodeId,
  });
  return model.content as number[];
}
export function mapPdfPoint(x: number, y: number, width: number, height: number, quad: number[]) {
  if (
    ![x, y, width, height, ...quad].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    quad.length !== 8 ||
    x < 0 ||
    y < 0 ||
    x > width ||
    y > height
  )
    return;
  // Affine mapping also handles browser scaling without assuming native toolbar/sidebar sizes.
  return {
    x: quad[0] + (x / width) * (quad[2] - quad[0]) + (y / height) * (quad[6] - quad[0]),
    y: quad[1] + (x / width) * (quad[3] - quad[1]) + (y / height) * (quad[7] - quad[1]),
  };
}
async function onEvent(source: Target, method: string, params: any) {
  const watch = source.tabId === undefined ? undefined : watches.get(source.tabId);
  if (!watch || !live(watch)) return;
  if (method === 'Target.attachedToTarget') {
    const info = params.targetInfo;
    const parent = source.sessionId ? watch.frames.get(source.sessionId) : undefined;
    const role =
      !source.sessionId && info.url?.startsWith(VIEWER)
        ? 'viewer'
        : parent?.role === 'viewer' && samePdf(info.url ?? '', watch.url)
          ? 'pdf'
          : undefined;
    if (!role) {
      await command(source, 'Target.detachFromTarget', { sessionId: params.sessionId }).catch(
        () => {},
      );
      return;
    }
    const target = { tabId: watch.tabId, sessionId: params.sessionId };
    const frame: Frame = { target, parent: source, role, frameId: info.targetId };
    watch.frames.set(params.sessionId, frame);
    if (role === 'viewer')
      await command(target, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [{ type: 'iframe', exclude: false }],
      });
    await install(watch, frame);
    return;
  }
  if (method === 'Target.detachedFromTarget') {
    watch.frames.delete(params.sessionId);
    notify(watch, 'viewport');
    return;
  }
  if (
    method !== 'Runtime.bindingCalled' ||
    params.name !== BINDING ||
    typeof params.payload !== 'string' ||
    params.payload.length > 1024
  )
    return;
  const frame = source.sessionId ? watch.frames.get(source.sessionId) : undefined;
  if (!frame || frame.contextId !== params.executionContextId) return;
  const data = JSON.parse(params.payload);
  if (!['down', 'up', 'cancel', 'viewport', 'keyboard'].includes(data.kind)) return;
  if (data.kind !== 'up') {
    if (data.kind !== 'viewport') watch.gesture++;
    notify(watch, data.kind);
    return;
  }
  if (frame.role !== 'pdf') return;
  const sequence = watch.sequence;
  const gesture = watch.gesture;
  const geometryStart = performance.now();
  let point: { x: number; y: number } | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    point = await Promise.race([
      (async () => {
        const viewer = frame.parent.sessionId
          ? watch.frames.get(frame.parent.sessionId)
          : undefined;
        if (!viewer) return;
        const [quad, viewerQuad] = await Promise.all([frameBox(frame), frameBox(viewer)]);
        if (Math.abs(viewerQuad[0]) > 1 || Math.abs(viewerQuad[1]) > 1) return;
        return mapPdfPoint(data.x, data.y, data.width, data.height, quad);
      })(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), 700);
      }),
    ]);
  } catch {
    /* Geometry unavailable: release the gesture and use the existing corner fallback. */
  } finally {
    clearTimeout(timeout);
    if (live(watch) && gesture === watch.gesture)
      notify(watch, 'up', {
        point: sequence === watch.sequence ? point : undefined,
        geometryMs: performance.now() - geometryStart,
      });
  }
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  void onEvent(source, method, params).catch(() => {});
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined) return;
  const watch = watches.get(source.tabId);
  if (!watch) return;
  watch.closed = true;
  watches.delete(source.tabId);
  clearInterval(watch.lease);
  clearTimeout(watch.startup);
  if (reason === 'canceled_by_user') {
    blocked.add(source.tabId);
    void chrome.storage.session.set({ ['pdf-debugger-blocked-' + source.tabId]: true });
  }
  notify(watch, 'detached'); // Passive observers expire themselves if cleanup cannot run after detach.
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void stopPdfWatch(tabId);
  blocked.delete(tabId);
  void chrome.storage.session.remove('pdf-debugger-blocked-' + tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void stopPdfWatch(tabId);
});
