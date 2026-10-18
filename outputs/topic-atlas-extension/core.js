(function (root) {
  'use strict';
  function hash(text) {
    let n = 2166136261;
    for (const c of text) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
    return (n >>> 0).toString(36);
  }
  function conversation(url) {
    try {
      const u = new URL(url);
      const platform = /^(chatgpt\.com|chat\.openai\.com)$/.test(u.hostname) ? 'ChatGPT' : u.hostname === 'gemini.google.com' ? 'Gemini' : null;
      if (!platform || u.protocol !== 'https:') return null;
      // Only stable conversation routes can be archived. Draft landing pages are excluded.
      const valid = platform === 'ChatGPT' ? /\/(?:c)\/[^/]+/.test(u.pathname) : /^(?:\/u\/\d+)?\/app\/[^/]+/.test(u.pathname);
      if (!valid) return { platform, draft: true };
      const clean = u.origin + u.pathname.replace(/\/$/, '');
      return { platform, url: clean, key: platform + ':' + clean };
    } catch { return null; }
  }
  function clean(text) { return String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim(); }
  function excerpt(text, max = 58) {
    const line = clean(text).replace(/\s+/g, ' ');
    return line.length > max ? line.slice(0, max) + '…' : line;
  }
  function pageRoots(doc) {
    const roots = [doc], visited = new Set(roots);
    for (let i = 0; i < roots.length; i++) roots[i].querySelectorAll('*').forEach(node => {
      if (node.shadowRoot && !visited.has(node.shadowRoot)) { visited.add(node.shadowRoot); roots.push(node.shadowRoot); }
      if (node.tagName === 'IFRAME' && !node.closest('[hidden], [aria-hidden="true"]')) {
        try {
          const child = node.contentDocument;
          if (child?.documentElement && !visited.has(child)) { visited.add(child); roots.push(child); }
        } catch { /* Cross-origin frames stay inaccessible; never bypass browser isolation. */ }
      }
    });
    return roots;
  }
  function extract(doc, platform) {
    // Prefer explicit roles. Newer ChatGPT layouts can put the role on the turn
    // article instead of rendering a data-message-author-role descendant.
    const roots = pageRoots(doc);
    const selectors = platform === 'ChatGPT'
      ? '[data-message-author-role], [data-message-role], [data-turn="user"], [data-turn="assistant"], article[data-testid^="conversation-turn"], [data-testid^="conversation-turn-"], article[aria-label]'
      : 'user-query, model-response, [data-message-author-role="user"], [data-message-author-role="assistant"]';
    function roleOf(node) {
      for (const attr of ['data-message-author-role', 'data-message-role', 'data-turn']) {
        const value = node.getAttribute(attr);
        if (['user', 'assistant'].includes(value)) return value;
      }
      if (node.tagName.toLowerCase() === 'user-query') return 'user';
      if (node.tagName.toLowerCase() === 'model-response') return 'assistant';
      const explicit = node.querySelector('[data-message-author-role="user"], [data-message-author-role="assistant"], [data-message-role="user"], [data-message-role="assistant"]');
      if (explicit) return roleOf(explicit);
      const label = clean(node.getAttribute('aria-label') || node.querySelector('h5, h6, .sr-only, [data-testid="message-author"]')?.textContent).toLowerCase();
      if (/^(you(?: said)?|user|你说|你說|您说|您說|你|您)[\s:：]*$/.test(label)) return 'user';
      if (/^(chatgpt(?: said)?|assistant|chatgpt\s*[说說](?:道)?)[\s:：]*$/.test(label)) return 'assistant';
      return null;
    }
    const candidates = roots.flatMap(root => [...root.querySelectorAll(selectors)]).map(node => ({ node, role: roleOf(node) })).filter(x => x.role);
    // Keep the innermost role-bearing element, so a turn wrapping a message is
    // not extracted twice and toolbar/author text on the wrapper stays out.
    let entries = candidates.filter(entry => !candidates.some(other => other.node !== entry.node && entry.node.contains(other.node)));
    if (!entries.length && platform === 'ChatGPT') {
      // The reported layout has text containers but no author/turn markers.
      // Preserve these as unclassified fragments, never guess alternating roles.
      const fragments = roots.flatMap(root => {
        const scope = root.querySelector('main, [role="main"]') || root;
        return [...scope.querySelectorAll('.whitespace-pre-wrap')].filter(node =>
          !node.closest('nav, aside, header, footer, form, button, [contenteditable="true"], [hidden], [aria-hidden="true"]') &&
          !node.querySelector('.whitespace-pre-wrap') && clean(node.textContent)
        );
      });
      entries = fragments.map(node => ({ node, role: 'unknown' }));
    }
    const messages = [], occurrences = new Map();
    entries.forEach(({ node, role }) => {
      if (node.closest('[hidden], [aria-hidden="true"]')) return;
      const body = platform === 'ChatGPT'
        ? node.querySelector('[data-message-content], [data-testid="user-message"], [data-testid="assistant-message"], .markdown, .whitespace-pre-wrap') || node
        : role === 'user' ? node.querySelector('.query-text, .query-content') || node : node.querySelector('.model-response-text, message-content, .markdown') || node;
      const copy = body.cloneNode(true);
      copy.querySelectorAll('button, script, style, nav, textarea, [hidden], [aria-hidden="true"], .sr-only, .cdk-visually-hidden, h5, h6').forEach(n => n.remove());
      // Preserve block separation without capturing toolbar labels.
      copy.querySelectorAll('p, li, pre, h1, h2, h3, br').forEach(n => n.appendChild(doc.createTextNode('\n')));
      const text = clean(copy.textContent);
      if (!text) return;
      const parent = node.closest('[data-message-id], [data-turn-id], conversation-container[id]');
      const nativeId = node.getAttribute('data-message-id') || node.getAttribute('data-turn-id') || node.id || parent?.getAttribute('data-message-id') || parent?.getAttribute('data-turn-id') || parent?.id;
      const base = role + ':text:' + hash(text);
      const count = occurrences.get(base) || 0; occurrences.set(base, count + 1);
      // Keep a DOM-local ID stable while an answer streams; exact-text matching survives reloads.
      if (!nativeId && !node.getAttribute('data-atlas-message-id')) node.setAttribute('data-atlas-message-id', base + ':' + count);
      messages.push({ id: nativeId ? role + ':' + nativeId : node.getAttribute('data-atlas-message-id'), nativeId: nativeId || null, role, text, _node: node });
    });
    return messages;
  }
  function diagnose(doc, platform) {
    const selectors = ['[data-message-author-role]', '[data-message-role]', '[data-turn]', 'article', '[data-testid^="conversation-turn"]', '.markdown', '.whitespace-pre-wrap', 'user-query', 'model-response', 'iframe'];
    const counts = Object.fromEntries(selectors.map(s => [s, doc.querySelectorAll(s).length]));
    // Only structure and allowlisted role markers. No message text, titles,
    // conversation IDs, account details, links or raw HTML are included.
    const structures = [...doc.querySelectorAll('main article, main [data-testid^="conversation-turn"], [data-turn]')].slice(0, 8).map(n => ({
      tag: n.tagName.toLowerCase(),
      role: ['user', 'assistant'].includes(n.getAttribute('data-turn')) ? n.getAttribute('data-turn') : null,
      author: ['user', 'assistant'].includes(n.getAttribute('data-message-author-role')) ? n.getAttribute('data-message-author-role') : null,
      children: [...n.children].slice(0, 8).map(c => c.tagName.toLowerCase()),
      hasHeading: Boolean(n.querySelector('h5, h6, .sr-only')),
      hasText: Boolean(clean(n.textContent))
    }));
    const roots = pageRoots(doc);
    const frames = roots.flatMap(root => [...root.querySelectorAll('iframe')]).map(frame => {
      try { return { readable: Boolean(frame.contentDocument?.documentElement) }; }
      catch { return { readable: false }; }
    });
    const rootCounts = roots.map((root, index) => ({ index, kind: root.nodeType === 9 ? 'document' : 'shadow-root', counts: Object.fromEntries(selectors.map(s => [s, root.querySelectorAll(s).length])) }));
    const fragments = roots.flatMap(root => [...root.querySelectorAll('.whitespace-pre-wrap')]).slice(0, 5).map(node => {
      const ancestors = []; let current = node;
      for (let i = 0; current && i < 5; i++, current = current.parentElement) ancestors.push({
        tag: current.tagName.toLowerCase(), attributes: current.getAttributeNames().filter(a => a !== 'id' && a !== 'style'),
        inMain: Boolean(current.closest('main, [role="main"]'))
      });
      return ancestors;
    });
    const messages = extract(doc, platform);
    return { platform, readyState: doc.readyState, counts, structures, rootCounts, frames, fragments, extracted: messages.length, unclassified: messages.filter(m => m.role === 'unknown').length };
  }
  function merge(previous, incoming, now) {
    const messages = (previous?.messages || []).map(m => ({ ...m }));
    // Find existing IDs or exact text so lazy-loaded subsets never erase archived messages.
    const positions = new Map(messages.map((m, i) => [m.id, i]));
    let cursor = -1;
    const fresh = [];
    for (const raw of incoming) {
      const item = { id: raw.id, nativeId: raw.nativeId, role: raw.role, text: raw.text };
      let index = positions.get(item.id);
      if (index === undefined) index = messages.findIndex((m, i) => i > cursor && m.role === item.role && m.text === item.text);
      if (index !== undefined && index >= 0) {
        cursor = index;
        // Keep original ID to preserve manual annotations.
        messages[index] = { ...messages[index], text: item.text, nativeId: item.nativeId || messages[index].nativeId, lastSeenAt: now };
        fresh.push({ existing: messages[index] });
      } else fresh.push({ new: { ...item, firstSeenAt: now, lastSeenAt: now } });
    }
    // Place new nodes relative to known neighbors (supports loading earlier messages).
    let insertion = 0;
    for (let i = 0; i < fresh.length; i++) {
      const f = fresh[i];
      if (f.existing) { insertion = messages.indexOf(f.existing) + 1; continue; }
      const next = fresh.slice(i + 1).find(v => v.existing);
      if (insertion === 0 && next) insertion = messages.indexOf(next.existing);
      if (!next && insertion === 0) insertion = messages.length;
      messages.splice(insertion++, 0, f.new);
    }
    return messages;
  }
  function turns(messages) {
    const result = [];
    function combined(segments) {
      const first = segments[0];
      return { ...first, text: segments.map(m => m.text).filter(Boolean).join('\n\n'), segments: segments.map(m => ({ id: m.id, nativeId: m.nativeId, role: m.role, text: m.text, channel: m.channel })) };
    }
    for (const message of messages) {
      if (message.role === 'unknown') result.push({ id: message.id, user: null, assistants: [], unknowns: [message] });
      else if (message.role === 'user') {
        const last = result[result.length - 1];
        if (last?.user && !last.assistants.length && !last.unknowns) last.user = combined([...(last.user.segments || [last.user]), message]);
        else result.push({ id: message.id, user: combined([message]), assistants: [] });
      }
      else {
        if (!result.length || result[result.length - 1].unknowns) result.push({ id: message.id, user: null, assistants: [] });
        const turn = result[result.length - 1];
        turn.assistants = [combined([...(turn.assistants[0]?.segments || []), message])];
      }
    }
    return result;
  }
  function graph(record) {
    const ts = turns(record.messages), nodes = [], edges = [], seen = new Set();
    let previous = null;
    ts.forEach((turn, i) => {
      const annotation = record.annotations?.[turn.id] || {};
      const label = annotation.topic?.trim() || '待命名主题 ' + (i + 1);
      if (!nodes.some(n => n.label === label)) nodes.push({ label, turnIds: [], named: Boolean(annotation.topic?.trim()) });
      nodes.find(n => n.label === label).turnIds.push(turn.id);
      if (previous && previous !== label) edges.push({ from: previous, to: label, type: annotation.relation || (seen.has(label) ? 'return' : 'flow'), turnId: turn.id, manual: Boolean(annotation.relation) });
      seen.add(label); previous = label;
    });
    return { nodes, edges };
  }
  function normalizeChatGPT(data) {
    if (!data?.mapping || typeof data.mapping !== 'object' || Array.isArray(data.mapping)) throw new Error('SCHEMA_CHANGED');
    const mapping = data.mapping, allMessages = [], byNode = new Map();
    let omitted = 0, unreadable = 0, empty = 0, broken = false;
    function textParts(value, depth = 0) {
      if (depth > 5 || value == null) return [];
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(v => textParts(v, depth + 1));
      if (typeof value !== 'object') return [];
      if (typeof value.text === 'string') return [value.text];
      if (Array.isArray(value.parts)) return textParts(value.parts, depth + 1);
      if (typeof value.content === 'string' || (value.content && typeof value.content === 'object')) return textParts(value.content, depth + 1);
      return [];
    }
    function hasMedia(value, depth = 0) {
      if (!value || depth > 5 || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(v => hasMedia(v, depth + 1));
      if (typeof value.asset_pointer === 'string' || typeof value.audio_asset_pointer === 'string' || typeof value.video_asset_pointer === 'string') return true;
      if (typeof value.content_type === 'string' && /(?:^|_)(?:image|audio|video|file|attachment)(?:_|$)/.test(value.content_type) && !['multimodal_text'].includes(value.content_type)) return true;
      return Array.isArray(value.parts) && hasMedia(value.parts, depth + 1);
    }
    for (const [nodeId, node] of Object.entries(mapping)) {
      if (node?.parent && !mapping[node.parent]) broken = true;
      if (Array.isArray(node?.children) && node.children.some(id => !mapping[id])) broken = true;
      const m = node?.message;
      if (!m || !['user', 'assistant'].includes(m.author?.role) || m.metadata?.is_visually_hidden_from_conversation || m.metadata?.is_user_system_message || m.channel === 'analysis') continue;
      const content = m.content || {};
      const text = clean(textParts(content).filter(Boolean).join('\n'));
      const nonText = hasMedia(content);
      if (!text && !nonText) {
        // Empty/internal/unknown payloads are not evidence of an attachment.
        if (!content.content_type || ['text', 'multimodal_text'].includes(content.content_type)) empty++;
        else unreadable++;
        continue;
      }
      if (nonText) omitted++;
      const nativeId = typeof m.id === 'string' ? m.id : nodeId;
      const item = { id: m.author.role + ':' + nativeId, nativeId, nodeId, parentNodeId: node.parent || null,
        childNodeIds: node.children || [], role: m.author.role, channel: m.channel || null, text: text || '［非文本消息：本版不提取附件／音视频正文］',
        nonText, status:typeof m.status === 'string' ? m.status : null, createdAt: typeof m.create_time === 'number' && Number.isFinite(m.create_time) && Math.abs(m.create_time) < 8640000000000 ? new Date(m.create_time * 1000).toISOString() : null };
      byNode.set(nodeId, item); allMessages.push(item);
    }
    function pathFor(leaf) {
      const path = [], seen = new Set(); let id = leaf;
      while (id) {
        if (seen.has(id) || !mapping[id]) { broken = true; break; }
        seen.add(id); if (byNode.has(id)) path.unshift(byNode.get(id).id);
        id = mapping[id].parent;
      }
      return path;
    }
    const parents = new Set(Object.values(mapping).map(n => n?.parent).filter(Boolean));
    const leaves = Object.keys(mapping).filter(id => !parents.has(id));
    const activeNode = typeof data.current_node === 'string' && mapping[data.current_node] ? data.current_node : null;
    if (!activeNode) broken = true;
    const activePath = activeNode ? pathFor(activeNode) : [];
    if (!activePath.length) broken = true;
    const branches = [{ id: 'current', label: '网页当前路径', messageIds: activePath }];
    for (const leaf of leaves) {
      const ids = pathFor(leaf);
      if (ids.length && ids.join('|') !== activePath.join('|')) branches.push({ id: leaf, label: '其他分支 ' + branches.length, messageIds: ids });
    }
    if (!allMessages.length) throw new Error('NO_MESSAGES');
    const byId = new Map(allMessages.map(m => [m.id, m]));
    return { allMessages, messages: activePath.map(id => byId.get(id)).filter(Boolean),
      branches, activeNode, source: { type: 'chatgpt-api', completeness: broken || unreadable ? 'partial' : 'returned-tree', total: allMessages.length, omittedNonText: omitted, unreadableContent: unreadable, skippedEmpty: empty,
        note: broken ? '返回数据的当前节点或父链不完整，请选择可用分支或重试。' : unreadable ? '消息树可读取，但部分节点尚无可解析正文；没有将其当作附件或补造正文。' : '已读取接口返回的消息树；不保证包含平台未返回或已删除的历史版本。' } };
  }
  const api = { hash, clean, excerpt, conversation, extract, diagnose, merge, turns, graph, normalizeChatGPT, pageRoots };
  root.Atlas = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
