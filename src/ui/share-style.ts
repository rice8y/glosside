export const shareStyle = `
.share-tools { margin-top: 12px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent); font-size: 12px; line-height: 1.6; }
.share-tools summary { cursor: pointer; font-size: 12px; color: inherit; }
.share-tools p { margin: 10px 0; max-width: 80em; overflow-wrap: anywhere; }
.share-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.share-actions button { font: inherit; padding: 6px 10px; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 6px; cursor: pointer; }
.share-actions button:disabled { opacity: .5; cursor: default; }
.share-actions button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.share-actions a { color: inherit; text-underline-offset: 3px; }
.share-tools :is(summary, button, a):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.share-preview pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; border-radius: 6px; background: color-mix(in srgb, currentColor 5%, transparent); margin: 10px 0; }
.share-feedback:empty { display: none; }
`;
