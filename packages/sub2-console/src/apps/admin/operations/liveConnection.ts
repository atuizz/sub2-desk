import { opsAPI, type OpsWSStatus } from '../../../api/admin/ops';

/** Socket messages signal fresh data; the typed HTTP summary remains authoritative. */
export function createLiveConnection(options: {
  visible: () => boolean;
  status: (status: OpsWSStatus | 'paused' | 'disabled') => void;
  refresh: () => void;
  error: (message: string) => void;
}) {
  let stop: (() => void) | null = null;
  let disposed = false, enabled = false, generation = 0, fatal = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  function disconnect() {
    generation++; clearTimeout(debounce); debounce = undefined;
    const previous = stop; stop = null; previous?.();
  }
  function connect() {
    if (disposed || !enabled || !options.visible() || stop || fatal) return;
    const epoch = ++generation;
    options.status('connecting');
    try {
      stop = opsAPI.subscribeQPS((data: unknown) => {
        if (disposed || epoch !== generation || !options.visible() || !data || typeof data !== 'object' || Array.isArray(data) || debounce) return;
        // Do not guess the shape of the legacy WS metric payload or show its contents.
        debounce = setTimeout(() => {
          debounce = undefined;
          if (!disposed && epoch === generation && enabled && options.visible()) options.refresh();
        }, 500);
      }, {
        maxReconnectAttempts: 5, staleTimeoutMs: 30000, staleCheckIntervalMs: 10000,
        onStatusChange: state => { if (!disposed && epoch === generation) options.status(state); },
        onError: () => { if (!disposed && epoch === generation) options.error('实时连接异常，正在等待重连；保留上次统计快照'); },
        onOpen: () => { if (!disposed && epoch === generation) { options.error(''); options.refresh(); } },
        onFatalClose: () => { if (!disposed && epoch === generation) { fatal = true; options.status('disabled'); options.error('后端已关闭实时监控；启用后可手动重连'); } },
      });
    } catch { if (!disposed && epoch === generation) { options.status('closed'); options.error('无法建立实时连接，请重试'); } }
  }
  return {
    setEnabled(value: boolean) { enabled = value; if (!value) { disconnect(); options.status('closed'); } else { fatal = false; if (!options.visible()) options.status('paused'); else connect(); } },
    visibilityChanged() { if (disposed || !enabled) return; if (!options.visible()) { disconnect(); options.status('paused'); } else connect(); },
    reconnect() { if (disposed || !enabled) return; disconnect(); fatal = false; connect(); },
    dispose() { disposed = true; enabled = false; disconnect(); },
  };
}
