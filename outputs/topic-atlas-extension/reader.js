// This function is serialized into ChatGPT's MAIN world. Keep it self-contained.
// Login credentials remain in page memory; only an allowlisted conversation
// payload is returned to the extension. No session/token is stored or logged.
async function readChatGPTPage(expectedId) {
  const currentId = () => location.pathname.match(/\/c\/([^/]+)/)?.[1];
  if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname) || currentId() !== expectedId || !/^[a-zA-Z0-9_-]{1,128}$/.test(expectedId)) return { error: 'PAGE_CHANGED' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    let token;
    try {
      const session = await fetch('/api/auth/session', { credentials: 'include', signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (session.ok) {
        const auth = await session.json();
        if (typeof auth.accessToken === 'string') token = auth.accessToken;
      }
    } catch (error) { if (controller.signal.aborted) throw error; }
    const response = await fetch('/backend-api/conversation/' + encodeURIComponent(expectedId), {
      method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    });
    token = undefined;
    if (!response.ok) return { error: 'HTTP_' + response.status };
    if (!response.headers.get('content-type')?.includes('json')) return { error: 'NOT_JSON' };
    const data = await response.json();
    if (currentId() !== expectedId) return { error: 'PAGE_CHANGED' };
    if (!data || typeof data.mapping !== 'object' || Array.isArray(data.mapping) || !data.mapping) return { error: 'SCHEMA_CHANGED' };
    if (Object.keys(data.mapping).length > 30000) return { error: 'TOO_LARGE' };
    const mapping = {};
    for (const [id, node] of Object.entries(data.mapping)) {
      if (!node || typeof node !== 'object') continue;
      const message = node.message;
      mapping[id] = { id, parent: typeof node.parent === 'string' ? node.parent : null,
        children: Array.isArray(node.children) ? node.children.filter(v => typeof v === 'string') : [],
        message: message ? { id: message.id, author: { role: message.author?.role }, content: message.content, channel: message.channel, status:typeof message.status === 'string' ? message.status : null,
          create_time: message.create_time, metadata: { is_visually_hidden_from_conversation: Boolean(message.metadata?.is_visually_hidden_from_conversation), is_user_system_message: Boolean(message.metadata?.is_user_system_message) } } : null };
    }
    return { data: { mapping, current_node: data.current_node, title: typeof data.title === 'string' ? data.title : '' } };
  } catch (error) { return { error: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' }; }
  finally { clearTimeout(timer); }
}
