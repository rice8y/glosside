// An old isolated world can outlive an extension reload. Its API calls may throw
// synchronously, even when the normal API returns a Promise.
export function extensionContextAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
