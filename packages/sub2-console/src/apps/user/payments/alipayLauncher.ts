export type AlipayLaunchState = 'idle' | 'launching' | 'backgrounded' | 'fallback';
export function createAlipayLauncher(options: {
  url: string; userAgent: string; doc: Document; host: Window;
  navigate: (url: string) => void; update: (state: AlipayLaunchState) => void; returned: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, state: AlipayLaunchState = 'idle';
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const update = (next: AlipayLaunchState) => { if (!disposed) { state = next; options.update(next); } };
  const backgrounded = () => { if (state === 'launching') { clear(); update('backgrounded'); } };
  const visibility = () => {
    if (options.doc.hidden) backgrounded();
    else if (state === 'backgrounded') { options.returned(); update('idle'); }
  };
  const pageshow = () => { if (state === 'backgrounded') { options.returned(); update('idle'); } };
  options.doc.addEventListener('visibilitychange', visibility);
  options.host.addEventListener('pagehide', backgrounded);
  options.host.addEventListener('pageshow', pageshow);
  return {
    launch() {
      if (disposed) return;
      clear(); update('launching');
      try { options.navigate(options.url); } catch { update('fallback'); return; }
      if (state !== 'launching') return;
      timer = setTimeout(() => {
        timer = undefined;
        if (options.doc.hidden) backgrounded(); else update('fallback');
      }, /MicroMessenger|MQQBrowser|\bQQ\//i.test(options.userAgent) ? 300 : 2200);
    },
    dispose() { disposed = true; clear(); options.doc.removeEventListener('visibilitychange', visibility); options.host.removeEventListener('pagehide', backgrounded); options.host.removeEventListener('pageshow', pageshow); },
  };
}
