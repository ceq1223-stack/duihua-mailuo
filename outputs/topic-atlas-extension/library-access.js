/* Visible UI only. Retain the handle so requestPermission starts in the click gesture. */
const AtlasLibraryAccess = (() => {
  let active;
  async function prepare() { active = await AtlasLibrary.handle(); return !!active; }
  async function authorize(send) {
    const h = active;
    if (!h) throw new Error('文件夹记录尚未就绪，请打开资料库设置选择文件夹。');
    // No storage/runtime awaits before this permission request.
    if (await h.requestPermission({mode:'readwrite'}) !== 'granted') throw new Error('未获得文件夹访问权限，记录仍暂存浏览器。');
    return send({type:'library-reconnect'});
  }
  function summary(l,notice='') {
    const needsAccess = l.connected && !l.granted;
    const folder = needsAccess ? (l.permission === 'denied' ? '文件夹访问被拒绝 · 新内容暂存浏览器' : '本次文件夹授权已结束 · 新内容暂存浏览器') : l.error || (!l.connected ? '尚未连接资料库 · 记录暂存浏览器' : `文件夹：${l.name}`);
    // The same archive error is also stored by the queue. Show it once.
    const archiveNotice = /^(文件夹保存失败|等待文件夹授权)/.test(notice);
    return [folder, notice && notice !== l.error && !(archiveNotice && (needsAccess || l.error)) ? notice : ''].filter(Boolean);
  }
  return {prepare,authorize,summary};
})();
