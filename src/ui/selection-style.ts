// Kept inside the shadow root so a host page cannot accidentally restyle the controls.
export const selectionStyle = `
:host {
  all: initial;
  --brand: #5a2bdb;
  position: fixed;
  z-index: 2147483647;
  display: block;
  color-scheme: dark;
  font: 14px/1.42 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
  color: #f4f6fa;
  text-align: left;
}
:host([hidden]), [hidden] { display: none !important; }
* { box-sizing: border-box; }
button, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .4; }
button:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline: 2px solid #c0a9ff;
  outline-offset: 2px;
}
button:active:not(:disabled) { transform: scale(.97); }
.trigger {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--brand);
  box-shadow: 0 2px 8px #18264120;
}
.trigger svg { width: 30px; height: 30px; }
.trigger.busy::after {
  content: "";
  position: absolute;
  inset: -4px;
  border: 2px solid #a98be64d;
  border-top-color: var(--brand);
  border-right-color: var(--brand);
  border-radius: 50%;
  animation: translation-spin .85s linear infinite;
}
@keyframes translation-spin { to { transform: rotate(360deg); } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .trigger.busy::after { animation: none; border-style: dashed; }
}
section {
  position: relative;
  width: min(532px, calc(100vw - 24px));
  border-radius: 8px;
  background: #2b3545;
  color: #f4f6fa;
  box-shadow: 0 5px 16px #14223724, 0 1px 3px #14223714;
}
section::before {
  content: "";
  position: absolute;
  top: -5px;
  left: var(--arrow-x, 20px);
  width: 10px;
  height: 10px;
  background: #2b3545;
  transform: rotate(45deg);
}
:host([data-placement="above"]) section::before { top: auto; bottom: -5px; }
:host([data-placement="native"]) section::before { display: none; }
.heading { display: flex; align-items: center; gap: 8px; min-height: 50px; padding: 5px 8px 5px 16px; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b8c4d5; font-size: 12px; font-weight: 400; }
.controls { display: flex; align-items: center; gap: 3px; }
.icon-button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 11px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #b8c4d5;
}
.icon-button svg { width: 18px; height: 18px; pointer-events: none; }
.body {
  padding: 0 16px 13px;
  max-height: max(40px, calc(var(--popover-max-height, 60vh) - 50px));
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #68788e transparent;
}
.output { margin: 0; font-size: 14px; font-weight: 400; -webkit-font-smoothing: antialiased; line-height: 1.42; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.output:empty { display: none; }
.output-prose { white-space: pre-wrap; }
.output-prose + .output-prose { margin-top: 10px; }
.equation {
  margin: 10px 0;
  padding: 4px 0 7px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: #68788e transparent;
  white-space: normal;
  font-size: 16px;
}
.equation-image {
  display: block;
  max-width: none;
  height: auto;
  margin-inline: auto;
  filter: invert(1) brightness(.96);
}
.output-inline { white-space: normal; }
.inline-original { white-space: pre-wrap; }
.inline-equation { display: inline-block; max-width: 100%; margin: 0 .06em; object-fit: contain; }
.equation-picture { display: contents; }
.colored-equation { filter: none; }
.equation:focus-visible { outline: 1px solid #c0a9ff; outline-offset: 2px; border-radius: 2px; }
@media (forced-colors: active) {
  .equation, .inline-equation { background: white; forced-color-adjust: none; }
  .equation-image { filter: none; }
}
.state { white-space: pre-line; margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: #c0ccdc; overflow-wrap: anywhere; }
.state.quiet { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tools { margin: 4px 0 12px; padding: 0 0 12px; border-bottom: 1px solid #ffffff20; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.actions button, .notice button {
  padding: 5px 9px;
  color: #edf2fa;
  background: #ffffff0a;
  border: 1px solid #ffffff30;
  border-radius: 5px;
  font-size: 12px;
}
summary { cursor: pointer; color: #c0ccdc; font-size: 12px; }
textarea { width: 100%; min-height: 90px; margin-top: 8px; padding: 8px; resize: vertical; border: 1px solid #718097; border-radius: 5px; background: #202a39; color: #f4f6fa; }
.notice { padding: 16px; }
.notice p { margin: 0 0 10px; }
@media (hover: hover) {
  .trigger:hover { filter: brightness(1.12); }
  .icon-button:hover, .actions button:hover { background: #ffffff14; color: #fff; }
}
@media (forced-colors: active) {
  section, .trigger { border: 1px solid CanvasText; }
  section::before { display: none; }
  .trigger.busy::after { border-color: GrayText; border-top-color: Highlight; }
}
`;
