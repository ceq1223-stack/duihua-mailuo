(() => {
  let controller;
  let lastLocation = null, lastMatch = null;
  const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
  const plain = value => normalized(String(value || '').replace(/```[^\n]*\n/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[ \t]*(?:#{1,6}|[-+>]|\d+[.)])\s+/gm, '').replace(/[*_`~]/g, ''));
  function renderedText(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('br, p, li, pre, h1, h2, h3, h4, h5, h6').forEach(n => n.appendChild(node.ownerDocument.createTextNode('\n')));
    return normalized(copy.textContent);
  }
  const compact = value => plain(value).normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const excluded = 'nav,aside,header,footer,form,button,input,textarea,script,style,[contenteditable="true"],[hidden],[aria-hidden="true"]';
  function blocks(root) {
    const scope = root.querySelector('main,[role="main"]') || root.body || root;
    const doc = root.ownerDocument || root, found = new Map();
    const walker = doc.createTreeWalker(scope, 4);
    let text;
    while ((text = walker.nextNode())) {
      const parent = text.parentElement;
      if (!parent || !text.data.trim() || parent.closest(excluded)) continue;
      if (doc.defaultView && !parent.getClientRects().length) continue;
      for (let node = parent, depth = 0; node && node !== scope && depth < 9; node = node.parentElement, depth++) {
        if (!found.has(node)) found.set(node, []);
        found.get(node).push(text.data);
      }
    }
    return [...found].map(([node, pieces]) => ({ node, text: compact(pieces.join(' ')) })).filter(b => b.text);
  }
  function anchors(text) {
    if (text.length < 80) return [text];
    const length = Math.min(48, Math.floor(text.length / 3)), last = text.length - length;
    return [...new Set([0, .25, .5, .75, 1].map(r => text.slice(Math.floor(last * r), Math.floor(last * r) + length)))];
  }
  function uniqueTextMatch(allBlocks, segment) {
    const text = compact(segment.text);
    if (!text || segment.ambiguous || text.startsWith('［非文本消息')) return null;
    const snippets = anchors(text), scored = [];
    for (const block of allBlocks) {
      const roleNode = block.node.closest('[data-message-author-role],[data-message-role],[data-turn="user"],[data-turn="assistant"]');
      const role = roleNode?.getAttribute('data-message-author-role') || roleNode?.getAttribute('data-message-role') || roleNode?.getAttribute('data-turn');
      if (role && role !== segment.role) continue;
      const body = block.text;
      if (body.length > text.length * 4 + 120) continue;
      const exact = text.length < 24 ? body === text : body.includes(text);
      const hits = snippets.filter(s => body.includes(s)).length;
      const score = exact ? 100 : text.length >= 80 && hits >= Math.min(2, snippets.length) ? hits : 0;
      if (score) scored.push({ ...block, score });
    }
    const distinct = scored.filter(b => !scored.some(other => other.node !== b.node && b.node.contains(other.node) && other.score >= b.score));
    const best = Math.max(0, ...distinct.map(b => b.score));
    const matches = distinct.filter(b => b.score === best);
    if (matches.length !== 1) return null;
    lastMatch = best === 100 ? 'plain-text' : 'text-anchors';
    return matches[0].node;
  }
  function find(doc, message, platform) {
    lastMatch = null;
    const segments = message.segments?.length ? [...message.segments] : [message];
    if (message.role === 'assistant') segments.sort((a, b) => (b.channel === 'final') - (a.channel === 'final'));
    const roots = Atlas.pageRoots(doc);
    // Match stable message IDs before relying on any text or page position.
    for (const segment of segments) {
      if (!segment.nativeId) continue;
      for (const root of roots) {
        const node = [...root.querySelectorAll('[data-message-id], [data-turn-id], [id]')].find(n =>
          !n.closest('[hidden], [aria-hidden="true"]') &&
          (!n.ownerDocument.defaultView || n.getClientRects().length > 0) &&
          [n.getAttribute('data-message-id'), n.getAttribute('data-turn-id'), n.id].includes(segment.nativeId));
        if (node) { lastMatch = 'native-id'; return node; }
      }
    }
    const extracted = Atlas.extract(doc, platform);
    for (const segment of segments) {
      const exact = extracted.find(m => m.id === segment.id);
      if (exact) { lastMatch = 'source-id'; return exact._node; }
      if (segment.ambiguous) continue;
      const equalText = extracted.filter(m => m.role === segment.role && normalized(m.text) === normalized(segment.text));
      if (equalText.length === 1) { lastMatch = 'role-text'; return equalText[0]._node; }
      const text = plain(segment.text);
      if (text.length < 24) continue;
      for (const root of roots) {
        const scope = root.querySelector('main, [role="main"]') || root;
        const matches = [...scope.querySelectorAll('.whitespace-pre-wrap, .markdown, .prose, [data-message-content], [data-testid="assistant-message"], p, pre, li')].filter(n =>
          !n.closest('nav, aside, form, [contenteditable="true"], [hidden], [aria-hidden="true"]') &&
          renderedText(n).includes(text.slice(0, 120)) &&
          (!n.closest('[data-message-author-role], [data-turn]') ||
            [n.closest('[data-message-author-role], [data-turn]').getAttribute('data-message-author-role'), n.closest('[data-message-author-role], [data-turn]').getAttribute('data-turn')].includes(segment.role)));
        const distinct = matches.filter(n => !matches.some(other => other !== n && n.contains(other)));
        // Ambiguous repeated quotes are not a reliable target.
        if (distinct.length === 1) { lastMatch = 'formatted-text'; return distinct[0]; }
      }
    }
    // No author tags or standard message classes are required on this path.
    // Stitch inline text nodes together before comparing so CJK wrapping,
    // Markdown styling and arbitrary div/span containers do not break anchors.
    const allBlocks = roots.flatMap(blocks);
    for (const segment of segments) {
      const node = uniqueTextMatch(allBlocks, segment);
      if (node) return node;
    }
    return null;
  }
  function scrollRoot(doc) {
    const win = doc.defaultView;
    const main = doc.querySelector('main, [role="main"]');
    const seed = main?.querySelector('[data-message-id], [data-turn], article, .whitespace-pre-wrap') || main;
    for (let n = seed; n; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 40 && /auto|scroll/.test(win.getComputedStyle(n).overflowY)) return n;
    }
    const scrollable = [...(main || doc).querySelectorAll('*')].filter(n =>
      !n.closest(excluded) && n.clientHeight > 80 && n.scrollHeight > n.clientHeight + 40 && /auto|scroll|overlay/.test(win.getComputedStyle(n).overflowY));
    return scrollable.sort((a, b) => b.clientHeight - a.clientHeight)[0] || doc.scrollingElement;
  }
  function highlight(node) {
    const target = node.closest('[data-message-id], article, [data-turn], [data-testid="assistant-message"], .prose') || node;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.animate?.([{ outline: '3px solid #5b7ce0', outlineOffset: '5px' }, { outline: '3px solid transparent', outlineOffset: '5px' }], { duration: 3000 });
  }
  function visiblePathIndices(doc, context) {
    const roots = Atlas.pageRoots(doc), ids = context.pathNativeIds || [], indices = new Set();
    for (const node of roots.flatMap(r => [...r.querySelectorAll('[data-message-id],[data-turn-id]')])) {
      const index = ids.indexOf(node.getAttribute('data-message-id') || node.getAttribute('data-turn-id'));
      if (index >= 0) indices.add(index);
    }
    const texts = (context.pathTexts || []).map(t => compact(t).slice(0, 40));
    if (texts.length) {
      const bodies = roots.flatMap(blocks);
      texts.forEach((prefix, index) => {
        if (prefix.length >= 20 && texts.indexOf(prefix) === texts.lastIndexOf(prefix) && bodies.some(b => b.text.includes(prefix))) indices.add(index);
      });
    }
    return [...indices];
  }
  async function locate(doc, message, context = {}) {
    controller?.abort(); const own = new AbortController(); controller = own;
    const initialKey = Atlas.conversation(doc.location?.href)?.key;
    const cancel = () => own.abort();
    doc.addEventListener('wheel', cancel, { passive: true }); doc.addEventListener('pointerdown', cancel); doc.addEventListener('keydown', cancel);
    let root, originalTop, moved = false;
    const metrics = { attempts: 0, moved: false, match: null, canceled: false };
    const finish = result => { lastLocation = { ...metrics, match: result.ok ? lastMatch : null, canceled: own.signal.aborted, found: Boolean(result.ok) }; return result; };
    const valid = () => !own.signal.aborted && (!initialKey || Atlas.conversation(doc.location?.href)?.key === initialKey);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      let node = find(doc, message, context.platform || 'ChatGPT');
      if (node) { highlight(node); return finish({ ok: true, method: 'id-or-text', attempts: 0 }); }
      if (context.inactiveBranch) return finish({ error: '这条消息属于其他分支。请在 ChatGPT 中打开对应版本后再定位；侧栏已保留该分支正文。' });
      const roots = Atlas.pageRoots(doc).filter(r => r.nodeType === 9).map(r => scrollRoot(r)).filter(Boolean);
      root = roots.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      if (!root) return finish({ error: '没有找到可滚动的对话区域。' });
      originalTop = root.scrollTop;
      const path = context.pathNativeIds || context.pathTexts || [], targetIndex = context.pathIndex || 0;
      const ratio = path.length > 1 ? targetIndex / (path.length - 1) : 0;
      const initialMax = Math.max(0, root.scrollHeight - root.clientHeight);
      const estimate = initialMax * ratio;
      const fallback = [ratio <= .1 ? 0 : ratio >= .9 ? initialMax : estimate, estimate];
      const scanStep = Math.max(100, root.clientHeight * .8);
      for (let i = 1; i <= 20; i++) fallback.push(estimate - scanStep * i, estimate + scanStep * i);
      fallback.push(0, initialMax);
      const visited = new Set();
      for (let attempt = 0; attempt < 28 && valid(); attempt++) {
        const max = Math.max(0, root.scrollHeight - root.clientHeight), step = Math.max(100, root.clientHeight * .85);
        let position = fallback.shift();
        const visibleIndices = visiblePathIndices(doc, context);
        if (attempt && visibleIndices.length) {
          if (targetIndex < Math.min(...visibleIndices)) position = root.scrollTop - step;
          else if (targetIndex > Math.max(...visibleIndices)) position = root.scrollTop + step;
        }
        position = Math.max(0, Math.min(max, position ?? root.scrollTop - step));
        if (visited.has(Math.round(position / 20))) position = Math.max(0, Math.min(max, fallback.shift() ?? position + step));
        visited.add(Math.round(position / 20));
        const before = root.scrollTop;
        root.scrollTo({ top: position, behavior: 'instant' }); moved = true;
        metrics.attempts = attempt + 1; metrics.moved = metrics.moved || Math.abs(root.scrollTop - before) > 1;
        await wait(attempt === 0 ? 600 : 320); if (!valid()) break;
        node = find(doc, message, context.platform || 'ChatGPT');
        if (node) { highlight(node); return finish({ ok: true, method: 'auto-scroll', attempts: attempt + 1 }); }
      }
      // Do not override a user's own scroll/input when they cancel the search.
      if (valid() && moved) root.scrollTo({ top: originalTop, behavior: 'instant' });
      return finish({ error: own.signal.aborted ? '已取消定位。' : '已尝试自动加载，但仍未匹配到可靠的正文节点。请复制采集诊断，其中已附定位过程信息。' });
    } finally {
      doc.removeEventListener('wheel', cancel); doc.removeEventListener('pointerdown', cancel); doc.removeEventListener('keydown', cancel);
    }
  }
  globalThis.AtlasLocator = { locate, find, diagnostics: () => lastLocation };
})();
