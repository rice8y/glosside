export const progressStyle = `
:host {
  all: initial;
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483646;
  max-width: calc(100vw - 40px);
  color-scheme: light dark;
  font: 12px/1.5 system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  --surface: #fff;
  --ink: #303038;
  --muted: #74747e;
  --line: #e8e8ec;
  --hover: #f4f4f6;
  --accent: #7045e8;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
section {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 12px;
  min-height: 42px;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 2px 6px #00000006, 0 8px 24px #0000000d;
  overflow: hidden;
}
svg { width: 20px; height: 20px; flex: none; }
.status { min-width: 0; }
.label { font-weight: 500; font-variant-numeric: tabular-nums; }
.detail { white-space: pre-line; color: var(--muted); font-size: 11px; }
button {
  flex: none;
  margin-left: 2px;
  padding: 5px 8px;
  min-height: 28px;
  font: inherit;
  font-size: 11px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-left: 1px solid var(--line);
  border-radius: 0 6px 6px 0;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
button:active { background: var(--hover); transform: scale(.97); }
@media (hover: hover) and (pointer: fine) {
  button:hover { background: var(--hover); color: var(--ink); }
}
progress { position: absolute; bottom: 0; left: 0; width: 100%; height: 2px; border: 0; appearance: none; }
progress::-webkit-progress-bar { background: var(--line); }
progress::-webkit-progress-value { background: var(--accent); }
@media (prefers-color-scheme: dark) {
  :host { --surface: #252529; --ink: #ededf0; --muted: #aaaab4; --line: #3b3b42; --hover: #333339; --accent: #b299f5; }
  section { box-shadow: 0 2px 6px #00000014, 0 8px 24px #00000026; }
}
@media (forced-colors: active) {
  section { background: Canvas; color: CanvasText; border-color: ButtonText; }
  button { color: ButtonText; border-color: ButtonText; }
  .detail { white-space: pre-line; color: CanvasText; }
}
`;
