import type { PluginUISession } from '../../../api/admin/plugins';

/** Official v1 opaque-origin bridge; each document owns its pending requests. */
export function createPluginBridge(options: {
  session: PluginUISession;
  frame: () => Window | null;
  load: () => Promise<Record<string, unknown>>;
  save: (config: Record<string, unknown>, active: () => boolean) => Promise<Record<string, unknown>>;
  test: (active: () => boolean) => Promise<{ success: boolean; message: string; latency_ms: number }>;
  resize: (height: number) => void;
  notify: (message: string) => void;
}) {
  let generation = 0;
  let disposed = false;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  function invalidate() {
    generation++;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  }
  async function handle(event: MessageEvent) {
    const { session } = options;
    const target = options.frame();
    if (disposed || !target || event.source !== target || event.origin !== 'null' ||
      !Number.isFinite(Date.parse(session.expires_at)) || Date.now() >= Date.parse(session.expires_at)) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.source !== 'sub2api-plugin-ui' || msg.bridge_token !== session.bridge_token) return;
    if (msg.type === 'ui.resize') {
      if (Number.isFinite(msg.height)) options.resize(Math.min(960, Math.max(520, Math.round(msg.height))));
      return;
    }
    if (msg.type === 'ui.notify') {
      if (typeof msg.message === 'string') options.notify(msg.message.slice(0, 500));
      return;
    }
    if (!['config.load', 'config.save', 'config.test'].includes(msg.type)) return;
    const id = typeof msg.request_id === 'string' ? msg.request_id.trim() : '';
    if (!id || id.length > 200 || pending.has(id) || pending.size >= 32) return;
    const epoch = generation;
    const timer = setTimeout(() => pending.delete(id), 30000);
    pending.set(id, timer);
    const active = () => !disposed && epoch === generation && pending.get(id) === timer && options.frame() === target && Date.now() < Date.parse(session.expires_at);
    let payload: Record<string, unknown>;
    try {
      if (msg.type === 'config.load') payload = { ok: true, config: await options.load() };
      else if (msg.type === 'config.save') {
        if (!msg.config || typeof msg.config !== 'object' || Array.isArray(msg.config)) throw new Error('配置必须为对象');
        payload = { ok: true, config: await options.save(msg.config, active) };
      } else {
        const result = await options.test(active);
        payload = { ok: result.success, result };
      }
    } catch (error) {
      // Do not echo HTTP objects, tokens or server configuration into untrusted UI.
      payload = { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : '操作失败' };
    }
    if (disposed || epoch !== generation || pending.get(id) !== timer || options.frame() !== target || Date.now() >= Date.parse(session.expires_at)) return;
    clearTimeout(timer); pending.delete(id);
    target.postMessage({ source: 'sub2api-plugin-host', bridge_token: session.bridge_token,
      type: `${msg.type}.result`, request_id: id, ...payload }, '*');
  }
  return { handle, invalidate, dispose() { disposed = true; invalidate(); } };
}

export function validatePluginSession(session: PluginUISession, base: string) {
  if (!session || typeof session.url !== 'string' || !session.url.trim() || typeof session.bridge_token !== 'string' || !session.bridge_token.trim()) throw new Error('插件会话响应无效');
  const url = new URL(session.url, base);
  if (url.origin !== new URL(base).origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    session.ui_bridge_version !== 1 || !session.bridge_token || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) {
    throw new Error('插件会话无效、已过期或桥接版本不受支持');
  }
  return { ...session, url: url.href };
}
