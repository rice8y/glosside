export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
export function button(label: string, action: () => void, attrs: Record<string, string> = {}) {
  const b = el('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', action);
  return b;
}
export function isExtensionNode(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  if (element?.closest('[data-local-translator]')) return true;
  const root = node?.getRootNode();
  return root instanceof ShadowRoot && isExtensionNode(root.host);
}
export async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function status(text: string) {
  const node = document.querySelector<HTMLElement>('#status');
  if (node) node.textContent = text;
}
