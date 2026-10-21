// 离线缓存：首次访问后把页面和公式引擎缓存到本地，之后断网也能打开。
// 静态资源「网络优先」：联网时总是拿最新代码，避免发新版后仍加载到旧缓存；断网时回退缓存。
// KaTeX 字体「缓存优先」：字体几乎不变，且首次没命中就会拖慢公式渲染。
const CACHE = 'math-review-v12';

// 常用公式字形（正文、粗体、斜体、数学斜体、上下标与大型定界符尺寸 1/2）。
// 这几类覆盖绝大多数公式，预缓存后打开页面公式立即正确成型。
const FONTS_CORE = [
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Main-BoldItalic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Size1-Regular.woff2',
  'KaTeX_Size2-Regular.woff2'
];

const CORE = [
  './',
  './index.html',
  './styles.css',
  './lib.js',
  './app.js',
  './papers-data.json',
  './manifest.json',
  './vendor/katex/katex.min.css',
  './vendor/katex/katex.min.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
].concat(FONTS_CORE.map(f => './vendor/katex/fonts/' + f));

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 逐个 add 并吞掉单个失败：某个字体缺失不该让整个 SW 装不上
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NET_TIMEOUT = 2500;
const FONT_RE = /\/vendor\/katex\/fonts\/[^/]+\.(?:woff2?|ttf)$/;

function put(req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
}

// 字体：缓存优先。没命中才回源，回源结果写进缓存供以后使用。
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    put(req, res);
    return res;
  } catch (e) {
    // 断网且没缓存：给一个明确的失败，而不是拿别的内容（如首页 HTML）冒充字体，
    // 否则浏览器会把 HTML 当字体解析失败，公式掉回系统字体，看起来「变丑」。
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function netFirst(req) {
  const net = fetch(req, { cache: 'reload' }).then((res) => {
    put(req, res);
    return res;
  });

  // 页面导航：弱网时先给缓存页，别让首屏一直干等；网络跑完后照旧更新缓存
  if (req.mode !== 'navigate') {
    // 其余静态资源：只信网络真实结果，失败才回退缓存。
    // 这里不给超时兜底 —— 超时后乱给内容（历史 bug：拿 index.html 顶替字体/CSS）比慢更糟。
    try {
      return await net;
    } catch (e) {
      return (await caches.match(req)) || Response.error();
    }
  }

  const slow = new Promise((resolve) => setTimeout(() => resolve(null), NET_TIMEOUT));
  const first = await Promise.race([net.catch(() => null), slow]);
  if (first) return first;
  return (await caches.match('./index.html')) || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(FONT_RE.test(url.pathname) ? cacheFirst(req) : netFirst(req));
});
