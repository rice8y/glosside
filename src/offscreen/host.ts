import { createInferenceHost } from '../inference/host';
import { EquationJobs } from '../native-pdf/equation-renderer';
const equations = new EquationJobs();
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
  if (message.action === 'pdf-prepare') {
    void equations
      .prepare(message.owner, message.id, message.url, message.source)
      .then((plan) => reply({ ok: true, plan }));
  } else if (message.action === 'pdf-cancel') {
    equations.cancel(message.owner, message.id);
    reply({ ok: true });
  } else {
    if (message.action === 'disconnect') equations.cancel(message.owner);
    void host.command(message).then(reply);
  }
  return true;
});
