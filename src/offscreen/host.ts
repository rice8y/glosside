import { createInferenceHost } from '../inference/host';
const host = createInferenceHost((message) => {
  void chrome.runtime.sendMessage({ channel: 'host-event', ...message }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('background/service-worker.js') ||
    message?.channel !== 'host-command'
  )
    return;
  void host.command(message).then(reply);
  return true;
});
