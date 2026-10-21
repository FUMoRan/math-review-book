// Service Worker 的离线策略测试。
// sw.js 是普通脚本（不是模块），在浏览器里靠 self/caches/fetch 全局对象工作，
// 这里用 vm 造一个最小沙箱把它跑起来，只验证「哪种请求回退到什么」这一层决策。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

// 起一个沙箱：返回 handlers（已注册的监听器）和 store（缓存内容，键为 url）
function boot({ fetchImpl, cached = [] } = {}) {
  const handlers = {};
  const store = new Map(cached.map(([url, body, ct]) => [url, new Response(body, { status: 200, headers: { 'content-type': ct || 'text/plain' } })]));

  // 相对路径按 SW 作用域解析，与浏览器 caches.match('./index.html') 的行为一致
  const keyOf = (req) => (typeof req === 'string' ? new URL(req, 'https://x.test/').href : req.url);
  const cache = {
    add: async (u) => { store.set(keyOf(u), new Response('ok')); },
    put: async (req, res) => { store.set(keyOf(req), res); },
    match: async (req) => store.get(keyOf(req)) || null,
  };
  const caches = {
    open: async () => cache,
    match: async (req) => cache.match(req),
    keys: async () => ['math-review-v12'],
    delete: async () => true,
  };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: 'https://x.test' },
  };

  vm.runInContext(SW_SRC, vm.createContext({ self, caches, fetch: fetchImpl, Response, URL, setTimeout, console, Promise }));
  return { handlers, store };
}

// 走一遍 fetch 监听器，返回 respondWith 拿到的响应
async function fireFetch(handlers, url, mode) {
  const req = { url: new URL(url, 'https://x.test/').href, method: 'GET', mode: mode || 'no-cors' };
  let out;
  handlers.fetch({ request: req, respondWith: (p) => { out = p; } });
  return out;
}

const FONT = 'https://x.test/vendor/katex/fonts/KaTeX_Main-Regular.woff2';
const CSS = 'https://x.test/styles.css';

test('字体已缓存时直接用缓存，不打扰网络', async () => {
  let called = 0;
  const { handlers } = boot({
    cached: [[FONT, 'wOF2-bytes', 'font/woff2']],
    fetchImpl: async () => { called++; return new Response('net'); },
  });
  const res = await fireFetch(handlers, FONT);
  assert.equal(await res.text(), 'wOF2-bytes');
  assert.equal(called, 0);
});

test('字体缓存未命中且网络正常时返回真实字体并写入缓存', async () => {
  const { handlers, store } = boot({
    fetchImpl: async () => new Response('wOF2-bytes', { status: 200, headers: { 'content-type': 'font/woff2' } }),
  });
  const res = await fireFetch(handlers, FONT);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(store.has(FONT), '字体应被写进缓存');
});

test('字体断网且无缓存时给 504，绝不能拿 HTML 顶替', async () => {
  const { handlers } = boot({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const res = await fireFetch(handlers, FONT);
  assert.equal(res.status, 504);
  assert.ok(!/text\/html/i.test(res.headers.get('content-type') || ''), '不能把 HTML 当字体返回');
  assert.equal((await res.text()).includes('<!DOCTYPE'), false);
});

test('非导航资源断网且无缓存时走网络错误，不回退 index.html', async () => {
  const { handlers } = boot({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const res = await fireFetch(handlers, CSS);
  assert.equal(res.type, 'error', '应是 Response.error()，而不是首页 HTML');
});

test('导航请求断网时回退缓存的 index.html', async () => {
  const { handlers } = boot({
    cached: [['https://x.test/index.html', '<!DOCTYPE html>app', 'text/html']],
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const res = await fireFetch(handlers, 'https://x.test/', 'navigate');
  assert.ok((await res.text()).includes('<!DOCTYPE html>app'));
});

test('预缓存清单包含 KaTeX 常用字体', async () => {
  const { handlers, store } = boot({ fetchImpl: async () => new Response('ok') });
  let done;
  handlers.install({ waitUntil: (p) => { done = p; } });
  await done;
  const urls = [...store.keys()].filter((u) => u.includes('/fonts/'));
  // 8 个常用字形 + 页面本体
  assert.ok(urls.length >= 8, `字体预缓存至少 8 个，实际 ${urls.length}`);
  assert.ok(urls.some((u) => u.includes('KaTeX_Math-Italic.woff2')));
  assert.ok(store.has('https://x.test/index.html'));
});
