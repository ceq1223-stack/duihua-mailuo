(() => {
  if (globalThis.__atlasAutomatic) return;
  globalThis.__atlasAutomatic = true;
  let enabled = true, runningKey = null, seenKey = null, timer, busy = null, lastAt = 0, last = null, error = null, locating = 0, blockedKey = null;
  const info = () => Atlas.conversation(location.href);
  const report = result => {
    if (result?.error) chrome.runtime.sendMessage({ type: 'capture-error', key: info()?.key, error: result.error }).catch(() => {});
  };
  function schedule(delay = 1000) { clearTimeout(timer); if (enabled && runningKey && !locating) timer = setTimeout(() => capture().then(report), delay); }
  async function performCapture() {
    const current = info();
    if (!enabled || !runningKey || current?.key !== runningKey || locating || document.hidden) return { skipped: true };
    const wait = 15000 - (Date.now() - lastAt);
    if (wait > 0 && last) { schedule(wait + 50); return last; }
    lastAt = Date.now();
    try {
      let result;
      if (current.platform === 'ChatGPT') result = await chrome.runtime.sendMessage({ type: 'read-structured' });
      else {
        const messages = Atlas.extract(document, current.platform).map(({ _node, ...m }) => m);
        if (!messages.length) throw new Error('尚未识别到 Gemini 消息；本版优先支持 Edge＋ChatGPT。');
        result = await chrome.runtime.sendMessage({ type: 'capture', conversation: current, title: document.title, messages });
        if (!result?.error) result = { count: messages.length };
      }
      if (!result || result.error) throw new Error(result?.error || '读取未响应。');
      if (current.key !== info()?.key) return { skipped: true };
      last = result; error = null; return result;
    } catch (failure) {
      if (!enabled) return { skipped: true };
      error = String(failure.message || '自动读取失败。').replace(/https?:\/\/\S+/g, '[网页地址]');
      blockedKey = current.key; runningKey = null; clearTimeout(timer);
      return { error };
    }
  }
  function capture() {
    if (busy) return busy;
    busy = performCapture().finally(() => { busy = null; if (runningKey && !last && !blockedKey) schedule(500); }); return busy;
  }
  function follow() {
    const current = info(), key = current?.key || null;
    if (key !== seenKey) { seenKey = key; runningKey = null; blockedKey = null; lastAt = 0; last = null; error = null; clearTimeout(timer); }
    if (document.hidden) { runningKey = null; clearTimeout(timer); return; }
    if (!enabled || !key || blockedKey === key) { runningKey = null; return; }
    if (runningKey !== key) { runningKey = key; schedule(500); }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'auto-setting') {
      enabled = message.enabled !== false; blockedKey = null;
      if (!enabled) { runningKey = null; clearTimeout(timer); } else follow();
      reply({ ok: true });
    }
    if (message.type === 'status') reply({ conversation: info(), running: Boolean(runningKey), source: last?.source, lastError: error, automatic: enabled });
    if (message.type === 'diagnose') reply({ version: chrome.runtime.getManifest().version, mode: info()?.platform === 'ChatGPT' ? 'structured-api-auto' : 'dom-auto', automatic: enabled, lastError: error, source: last?.source || null, lastLocation: AtlasLocator.diagnostics(), ...Atlas.diagnose(document, info()?.platform) });
    if (message.type === 'start') { blockedKey = null; lastAt = 0; last = null; follow(); capture().then(reply); return true; }
    if (message.type === 'stop') { runningKey = null; blockedKey = info()?.key; clearTimeout(timer); reply({ ok: true }); }
    if (message.type === 'locate') {
      if (message.key !== info()?.key) { reply({ error: '请先在原网页打开这条记录对应的对话。' }); return; }
      locating++; clearTimeout(timer);
      AtlasLocator.locate(document, message, { ...message.context, platform: info()?.platform }).then(reply, e => reply({ error: e.message })).finally(() => { locating--; if (!locating) schedule(2000); });
      return true;
    }
  });
  const observer = new MutationObserver(() => { if (runningKey && !locating) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  chrome.runtime.sendMessage({ type: 'get-auto-settings' }).then(stored => { enabled = stored?.enabled !== false; follow(); }).catch(report);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) follow(); });
  setInterval(follow, 1000);
})();
