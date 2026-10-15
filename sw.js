// 离线缓存：首次访问后把页面和公式引擎缓存到本地，之后断网也能打开。
// 采用「网络优先」：联网时总是拿最新代码，避免发新版后仍加载到旧缓存；断网时回退缓存。
const CACHE = 'math-review-v5';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './lib.js',
  './app.js',
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 网络优先：拿到新版本就顺带更新缓存；失败（离线/超时）再用缓存兜底。
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
