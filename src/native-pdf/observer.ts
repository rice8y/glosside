// Serialized into a dedicated CDP isolated world. No captured imports or page globals.
// Passive observation only: never cancel, synthesize, capture or redirect input.
export function installPdfObserver(binding: string, role: 'viewer' | 'pdf') {
  const scope = globalThis as typeof globalThis & {
    __localPdfObserver?: { renew(): void; destroy(): void };
    [key: string]: any;
  };
  if (role === 'pdf' && !document.querySelector('embed[type="application/x-google-chrome-pdf"]'))
    return false;
  if (role === 'viewer' && !document.querySelector('pdf-viewer')) return false;
  scope.__localPdfObserver?.destroy();
  let expires = Date.now() + 12000;
  let viewportTimer: ReturnType<typeof setTimeout> | undefined;
  const removals: (() => void)[] = [];
  const send = (kind: string, event?: PointerEvent) => {
    if (Date.now() > expires) {
      destroy();
      return;
    }
    try {
      scope[binding](
        JSON.stringify({
          kind,
          x: event?.clientX,
          y: event?.clientY,
          width: innerWidth,
          height: innerHeight,
        }),
      );
    } catch {
      destroy();
    }
  };
  const on = (target: EventTarget, type: string, callback: EventListener) => {
    target.addEventListener(type, callback, { capture: true, passive: true });
    removals.push(() => target.removeEventListener(type, callback, true));
  };
  const viewport = () => {
    if (viewportTimer !== undefined) return;
    send('viewport');
    viewportTimer = setTimeout(() => {
      viewportTimer = undefined;
    }, 50);
  };
  if (role === 'pdf') {
    on(document, 'pointerdown', (event) => {
      const e = event as PointerEvent;
      if (e.isTrusted && e.button === 0) send('down', e);
    });
    on(document, 'pointerup', (event) => {
      const e = event as PointerEvent;
      if (e.isTrusted && e.button === 0) send('up', e);
    });
    on(document, 'pointercancel', () => send('cancel'));
  } else {
    on(document, 'pointerdown', viewport); // Native toolbar/sidebar interaction.
  }
  on(document, 'keydown', (event) => {
    if ((event as KeyboardEvent).isTrusted) send('keyboard');
  });
  on(document, 'scroll', viewport);
  on(document, 'wheel', viewport);
  on(window, 'resize', viewport);
  const observer = new ResizeObserver(viewport);
  observer.observe(document.documentElement);
  const lease = setInterval(() => {
    if (Date.now() > expires) destroy();
  }, 2000);
  function destroy() {
    removals.forEach((remove) => remove());
    observer.disconnect();
    clearInterval(lease);
    clearTimeout(viewportTimer);
    delete scope.__localPdfObserver;
  }
  scope.__localPdfObserver = {
    renew: () => {
      expires = Date.now() + 12000;
    },
    destroy,
  };
  return true;
}
