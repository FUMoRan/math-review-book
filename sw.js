// 离线缓存：首次访问后把页面和公式引擎缓存到本地，之后断网也能打开。
// 采用「网络优先」：联网时总是拿最新代码，避免发新版后仍加载到旧缓存；断网时回退缓存。
const CACHE = 'math-review-v11';
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
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
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

// 网络优先，但给网络设一个上限：弱网/断网时不让首屏一直干等。
// 超时后先给缓存，网络请求仍继续跑完并顺手更新缓存（下次打开就是新版）。
const NET_TIMEOUT = 2500;

function fromCache(req) {
  return caches.match(req).then(hit => hit || caches.match('./index.html'));
}

async function netFirst(req) {
  // cache:'reload' 强制绕过浏览器 HTTP 缓存（托管平台常给静态资源设 max-age，
  // 否则发新版后仍可能拿到旧 app.js，出现「按钮在但点了没反应」）。
  const net = fetch(req, { cache: 'reload' }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), NET_TIMEOUT));
  const first = await Promise.race([net.catch(() => null), slow]);
  if (first) return first;
  const cached = await fromCache(req);
  return cached || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(netFirst(req));
});
