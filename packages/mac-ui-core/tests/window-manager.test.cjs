// Run from the workspace: node --test packages/mac-ui-core/tests/window-manager.test.cjs
// Uses existing TypeScript/Vue dependencies; never starts a server or calls a backend.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Module, createRequire } = require('node:module');
const coreRequire = createRequire(path.resolve(__dirname, '../package.json'));
const ts = coreRequire('typescript');
const { effectScope } = coreRequire('vue');
const { ref } = coreRequire('vue');

function loadTypeScript(relativePath, dependencies = {}) {
  const filename = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : coreRequire(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const geometry = loadTypeScript('../src/composables/windowGeometry.ts');
const draftRegistry = loadTypeScript('../src/composables/draftRegistry.ts');
const { createWindowManager } = loadTypeScript('../src/composables/useWindowManager.ts', {
  './windowGeometry': geometry, './draftRegistry': draftRegistry
});
const { getWindowWorkArea, clampWindowRect, resizeWindowRect, readWindowViewport } = geometry;
const originalWindow = global.window;
const managers = [];
afterEach(() => {
  managers.splice(0).forEach(wm => wm.dispose());
  if (originalWindow === undefined) delete global.window;
  else global.window = originalWindow;
});

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(name, handler, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    super.addEventListener(name, handler, options);
  }
  removeEventListener(name, handler) {
    this.listeners.get(name)?.delete(handler);
    super.removeEventListener(name, handler);
  }
  count() { return [...this.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
}

function environment(width = 1440, height = 900) {
  const fake = new TrackedTarget();
  const visual = Object.assign(new TrackedTarget(), {
    width, height, scale: 1, offsetLeft: 0, offsetTop: 0
  });
  const frames = new Map();
  let nextFrame = 0;
  Object.assign(fake, {
    innerWidth: width, innerHeight: height, visualViewport: visual,
    requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  global.window = fake;
  return {
    fake, visual, frames,
    resize(w, h) {
      fake.innerWidth = visual.width = w;
      fake.innerHeight = visual.height = h;
      fake.dispatchEvent(new Event('resize'));
    },
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(cb => cb(0));
    }
  };
}

function manager() {
  const wm = createWindowManager();
  managers.push(wm);
  wm.registerApps(['one', 'two', 'three'].map(id => ({
    id, name: id, title: id, icon: '', defaultW: 800, defaultH: 560,
    minW: 500, minH: 360, category: 'user'
  })));
  return wm;
}

function within(rect, area) {
  const epsilon = 1e-7;
  assert.ok(rect.w > 0 && rect.h > 0);
  assert.ok(rect.x >= area.x - epsilon && rect.y >= area.y - epsilon);
  assert.ok(rect.x + rect.w <= area.x + area.w + epsilon, JSON.stringify({ rect, area }));
  assert.ok(rect.y + rect.h <= area.y + area.h + epsilon, JSON.stringify({ rect, area }));
}

function draft(wm, win, initial = true) {
  const dirty = ref(initial), busy = ref(false);
  const release = wm.drafts.register({ windowId: win.id, dirty: () => dirty.value, busy: () => busy.value });
  return { dirty, busy, release };
}

test('clean closes stay synchronous and another window draft cannot block them', () => {
  environment(); const wm = manager(), one = wm.openApp('one'), two = wm.openApp('two');
  draft(wm, one);
  assert.equal(wm.closeWindow(two.id), true);
  assert.equal(wm.drafts.prompt.value, null);
  assert.equal(wm.windows.value.length, 1);
});

test('cancel preserves a minimized draft and explicit discard closes only its owner', async () => {
  environment(); const wm = manager(), one = wm.openApp('one'), two = wm.openApp('two');
  draft(wm, one); wm.minimizeWindow(one.id);
  const pending = wm.closeWindow(one.id);
  assert.equal(wm.activeWindowId.value, one.id);
  assert.equal(one.isMinimized, false);
  wm.drafts.cancel(); assert.equal(await pending, false);
  assert.equal(wm.windows.value.length, 2);
  const discard = wm.closeWindow(one.id); wm.drafts.confirm();
  assert.equal(await discard, true);
  assert.deepEqual(wm.windows.value.map(win => win.id), [two.id]);
});

test('global close is atomic; repeat or different actions cannot share one approval', async () => {
  environment(); const wm = manager(), one = wm.openApp('one'), two = wm.openApp('two');
  draft(wm, one); draft(wm, two);
  const pending = wm.closeAllWindows('退出登录');
  assert.equal(wm.closeAllWindows('重新启动'), false);
  assert.equal(wm.closeWindow(two.id), false);
  wm.drafts.cancel(); assert.equal(await pending, false);
  assert.equal(wm.windows.value.length, 2);
  const approved = wm.closeAllWindows(); wm.drafts.confirm();
  assert.equal(await approved, true); assert.equal(wm.windows.value.length, 0);
});

test('busy with no dirty data blocks close and is rechecked when confirming', async () => {
  environment(); const wm = manager(), one = wm.openApp('one'); const state = draft(wm, one, false);
  state.busy.value = true;
  const pending = wm.closeWindow(one.id); wm.drafts.confirm();
  assert.equal(wm.windows.value.length, 1); assert.ok(wm.drafts.prompt.value);
  state.busy.value = false; state.dirty.value = true;
  wm.drafts.confirm(); assert.equal(await pending, true);
});

test('a newly busy sibling blocks an already visible global discard decision', async () => {
  environment(); const wm = manager(), one = wm.openApp('one'), two = wm.openApp('two');
  draft(wm, one); const sibling = draft(wm, two, false);
  const pending = wm.closeAllWindows(); sibling.busy.value = true; wm.drafts.confirm();
  assert.equal(wm.windows.value.length, 2);
  sibling.busy.value = false; wm.drafts.confirm(); assert.equal(await pending, true);
});

test('beforeunload follows live dirty and busy state and releases after save/unmount', () => {
  const { fake } = environment(); const wm = manager(), one = wm.openApp('one'); const state = draft(wm, one, false);
  const blocked = () => { const event = new Event('beforeunload', { cancelable: true }); fake.dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(blocked(), false); state.dirty.value = true; assert.equal(blocked(), true);
  wm.minimizeWindow(one.id); assert.equal(blocked(), true);
  state.dirty.value = false; assert.equal(blocked(), false);
  state.busy.value = true; assert.equal(blocked(), true);
  state.release(); assert.equal(blocked(), false);
  assert.equal(fake.listeners.get('beforeunload')?.size ?? 0, 0);
});

test('auth force clear and disposal invalidate pending approval without blocking cleanup', async () => {
  const { fake } = environment(); const wm = manager(), one = wm.openApp('one'); draft(wm, one);
  const pending = wm.closeAllWindows(); wm.forceCloseAllWindows();
  assert.equal(await pending, false); assert.equal(wm.windows.value.length, 0);
  const fresh = wm.openApp('one'); wm.drafts.confirm(); assert.equal(wm.windows.value[0].id, fresh.id);
  draft(wm, fresh); const closing = wm.closeWindow(fresh.id); wm.dispose();
  assert.equal(await closing, false); assert.equal(fake.count(), 0); wm.drafts.confirm();
});

test('unmounting a draft cancels pending work instead of authorizing stale callbacks', async () => {
  environment(); const wm = manager(), one = wm.openApp('one'); const state = draft(wm, one);
  const pending = wm.closeWindow(one.id); state.release();
  assert.equal(await pending, false); wm.drafts.confirm(); assert.equal(wm.windows.value.length, 1);
});

test('viewport is the hard limit even when app minimums exceed phone dimensions', () => {
  for (const [width, height] of [[390, 844], [320, 568], [640, 360], [641, 480], [768, 1024], [1440, 900], [20, 60]]) {
    const area = getWindowWorkArea({ width, height });
    const rect = clampWindowRect({ x: -200, y: 900, w: 1800, h: 1200 }, area, 900, 700);
    within(rect, area);
    assert.equal(area.compact, width <= 640);
    if (area.compact) assert.equal(area.w, width);
  }
});

test('eight resize directions remain in bounds and preserve opposite edges', () => {
  const area = getWindowWorkArea({ width: 1440, height: 900 });
  const initial = { x: 200, y: 150, w: 800, h: 500 };
  for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const dx of [-5000, -280, 0, 280, 5000]) {
      for (const dy of [-5000, -200, 0, 200, 5000]) {
        const rect = resizeWindowRect(initial, direction, dx, dy, area, 500, 360);
        within(rect, area);
        assert.ok(rect.w >= 500 && rect.h >= 360);
        if (direction.includes('w')) assert.equal(rect.x + rect.w, initial.x + initial.w);
        else assert.equal(rect.x, initial.x);
        if (direction.includes('n')) assert.equal(rect.y + rect.h, initial.y + initial.h);
        else assert.equal(rect.y, initial.y);
      }
    }
  }
});

test('phone opens fill the work area and focusing keeps exactly one active window', () => {
  environment(390, 844);
  const wm = manager();
  const one = wm.openApp('one');
  const two = wm.openApp('two');
  assert.equal(wm.isCompact.value, true);
  assert.equal(one.rect.w, 390);
  assert.equal(one.rect.y, 34);
  assert.equal(one.rect.h, 724);
  assert.deepEqual(one.rect, two.rect);
  wm.focusWindow(one.id);
  assert.deepEqual(wm.windows.value.filter(w => w.isFocused).map(w => w.id), [one.id]);
  const revision = one.focusRevision;
  wm.toggleMaximizeWindow(one.id);
  assert.equal(one.isMaximized, false);
  wm.minimizeWindow(one.id);
  assert.equal(wm.activeWindowId.value, two.id);
  wm.openApp('one');
  assert.equal(one.isMinimized, false);
  assert.equal(one.focusRevision, revision + 2);
  assert.equal(wm.windows.value.length, 2);
});

test('desktop to phone to desktop restores both window arrangements after keyboard resize', () => {
  const env = environment();
  const wm = manager();
  const one = wm.openApp('one');
  const two = wm.openApp('two');
  one.rect = { x: 84, y: 62, w: 800, h: 560 };
  const beforeOne = { ...one.rect };
  const beforeTwo = { ...two.rect };
  env.resize(390, 844); env.flush();
  assert.equal(wm.isCompact.value, true);
  env.visual.height = 440;
  env.visual.dispatchEvent(new Event('resize')); env.flush();
  within(one.rect, wm.workArea.value);
  env.resize(1440, 900); env.flush();
  assert.deepEqual(one.rect, beforeOne);
  assert.deepEqual(two.rect, beforeTwo);
  assert.equal(two.isFocused, true);
});

test('maximized restore rect survives compact mode and clamps after desktop resizing', () => {
  const env = environment();
  const wm = manager();
  const win = wm.openApp('one');
  const original = { ...win.rect };
  wm.toggleMaximizeWindow(win.id);
  env.resize(390, 844); env.flush();
  env.resize(1440, 900); env.flush();
  assert.equal(win.isMaximized, true);
  wm.toggleMaximizeWindow(win.id);
  assert.deepEqual(win.rect, original);
  wm.toggleMaximizeWindow(win.id);
  env.resize(768, 600); env.flush();
  wm.toggleMaximizeWindow(win.id);
  assert.equal(win.isMaximized, false);
  within(win.rect, wm.workArea.value);
});

test('new windows opened on a phone get a useful default desktop size', () => {
  const env = environment(390, 844);
  const wm = manager();
  const win = wm.openApp('one');
  env.resize(1440, 900); env.flush();
  assert.equal(win.rect.w, 800);
  assert.equal(win.rect.h, 560);
  within(win.rect, wm.workArea.value);
});

test('closing or minimizing a background window does not steal focus', () => {
  environment();
  const wm = manager();
  const one = wm.openApp('one');
  const two = wm.openApp('two');
  const three = wm.openApp('three');
  wm.minimizeWindow(one.id);
  wm.closeWindow(two.id);
  assert.equal(wm.activeWindowId.value, three.id);
  const z = three.zIndex;
  wm.focusWindow(three.id);
  assert.equal(three.zIndex, z);
  wm.closeWindow(three.id);
  assert.equal(wm.activeWindowId.value, null);
});

test('resize events coalesce and scope disposal removes listeners and pending frames', () => {
  const env = environment();
  const scope = effectScope();
  let wm;
  scope.run(() => { wm = manager(); });
  wm.openApp('one');
  env.resize(1280, 800);
  env.resize(1000, 700);
  env.visual.dispatchEvent(new Event('resize'));
  assert.equal(env.frames.size, 1);
  assert.equal(env.fake.count(), 1);
  assert.equal(env.visual.count(), 2);
  scope.stop();
  assert.equal(env.fake.count(), 0);
  assert.equal(env.visual.count(), 0);
  assert.equal(env.frames.size, 0);
  wm.dispose();
});

test('visual keyboard shrink is observed; pinch zoom preserves the layout viewport', () => {
  const env = environment(390, 844);
  env.visual.height = 420;
  assert.equal(readWindowViewport().height, 420);
  env.visual.scale = 2;
  env.visual.width = 195;
  assert.equal(readWindowViewport().width, 390);
  assert.equal(readWindowViewport().height, 844);
});

test('manager can be created without window for SSR and non-component consumers', () => {
  delete global.window;
  const wm = manager();
  const win = wm.openApp('one');
  assert.equal(wm.isCompact.value, false);
  within(win.rect, wm.workArea.value);
  wm.dispose();
});

test('window SFC compiles and dark theme selectors remain scoped to the window', () => {
  const { parse, compileStyle, compileTemplate, compileScript } = coreRequire('vue/compiler-sfc');
  const filename = path.resolve(__dirname, '../src/components/MacWindow.vue');
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const style = compileStyle({
    source: descriptor.styles[0].content, filename, id: 'data-v-window-test', scoped: true
  });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'data-v-window-test' });
  assert.deepEqual(style.errors, []);
  assert.deepEqual(template.errors, []);
  assert.ok(compileScript(descriptor, { id: 'data-v-window-test' }).content);
  assert.match(style.code, /\.dark \.mac-window\[data-v-window-test\]/);
  assert.doesNotMatch(style.code, /(?:^|\})\s*\.dark\s*\{/);
});
