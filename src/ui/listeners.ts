// Keep document/window listeners tied to the lifetime of their popup.
export class EventListeners {
  private removals: (() => void)[] = [];

  on = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options: boolean | AddEventListenerOptions = false,
  ) => {
    target.addEventListener(type, listener, options);
    this.removals.push(() => target.removeEventListener(type, listener, options));
  };

  clear() {
    for (const remove of this.removals.splice(0)) remove();
  }
}
