// A top-level extension options page can have sender.tab, just like a website.
// Authorize our packaged UI by its browser-provided URL, never a message field.
const AtlasTrust = (() => {
  function isUI(sender) {
    if (!sender || (sender.id && sender.id !== chrome.runtime.id) || (sender.frameId && sender.frameId !== 0)) return false;
    if (sender.url) {
      if (typeof chrome.runtime.getURL !== 'function') return false;
      try {
        const url = new URL(sender.url); url.search = ''; url.hash = '';
        return ['panel.html', 'settings.html'].some(page => url.href === chrome.runtime.getURL(page));
      } catch { return false; }
    }
    // Retain internal calls without a document. Website content scripts have a
    // tab and/or document origin and cannot use this branch.
    return !sender.tab && !sender.origin;
  }
  return { isUI };
})();
