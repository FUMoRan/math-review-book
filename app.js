/* =========================================================
   数学复习本 · app.js
   两个视图：q=错题 / k=知识点，数据分开存，共用一套标签
   ========================================================= */

/* ===================== storage ===================== */
const K_Q = 'mq_items';
const K_K = 'mq_kps';

/* 纯逻辑统一放在 lib.js（浏览器与单测共用），此处引用即可 */
const {
  STATUS, STATUS_NEXT, uid, normText,
  makeGramProfile, simFromProfile,
  parseText, parseSearch,
  normalizeQuestion, normalizeKp, scheduleSrs, isDue, dueLabel, DAY,
} = MQ;

/* ===================== 设置（偏好，与数据分开存） ===================== */
const K_SET = 'mq_settings';
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on' };

function readSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(K_SET));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
const settings = Object.assign({}, SET_DEF, readSettings());

function saveSettings() {
  try { localStorage.setItem(K_SET, JSON.stringify(settings)); } catch (e) {}
}

const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const effectiveTheme = () => settings.theme === 'system' ? (mqDark.matches ? 'dark' : 'light') : settings.theme;
const effectiveAnim = () => settings.anim === 'off' ? 'off' : (mqMotion.matches ? 'off' : 'on');

// 实际列数：手机（<768）固定 1 列；宽屏按设置，同时不超过屏幕能容纳的列数
function effectiveCols() {
  const w = window.innerWidth;
  if (w < 768) return 1;
  const cap = Math.max(1, Math.floor((w - 48) / 320));
  let want;
  if (settings.cols === 'auto') want = w >= 1440 ? 3 : (w >= 1024 ? 2 : 1);
  else want = parseInt(settings.cols, 10) || 1;
  return Math.min(want, cap);
}

function applySettings() {
  const root = document.documentElement;
  const cols = effectiveCols();
  root.dataset.theme = effectiveTheme();
  root.dataset.density = settings.density;
  root.dataset.anim = effectiveAnim();
  root.dataset.cols = cols;
  root.style.setProperty('--cols', cols);
  root.style.setProperty('--mainw', cols >= 3 ? '1560px' : (cols === 2 ? '1180px' : '840px'));

  document.querySelectorAll('#setCols button').forEach(b => b.classList.toggle('on', b.dataset.cols === settings.cols));
  document.querySelectorAll('#setTheme button').forEach(b => b.classList.toggle('on', b.dataset.theme === settings.theme));
  document.querySelectorAll('#setDensity button').forEach(b => b.classList.toggle('on', b.dataset.density === settings.density));
  document.querySelectorAll('#setAnim button').forEach(b => b.classList.toggle('on', b.dataset.anim === settings.anim));

  const note = document.getElementById('colsNote');
  if (note) {
    note.textContent = window.innerWidth < 768
      ? '当前屏幕较窄，固定 1 列（把窗口拉宽或平板横屏后可多列）。'
      : `当前实际显示 ${cols} 列。`;
  }
}


/* ===================== 图片 / 文本持久化（IndexedDB；文本在 IDB 不可用时回退 localStorage） ===================== */
const K_TRASH = 'mq_trash';
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((res, rej) => {
      const rq = indexedDB.open('mqimg', 2);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return idbPromise;
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('imgs', 'readonly').objectStore('imgs').get(id);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbKeys() {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('imgs', 'readonly').objectStore('imgs').getAllKeys();
    rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error);
  });
}
// base64（不含前缀）→ Blob，用于从完整备份还原图片
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'image/jpeg' });
}
// 仍被引用（含回收站）的图片 id 集合，用于清理孤儿图片
function referencedImageIds() {
  const s = new Set();
  const add = list => list.forEach(it => (it.images || []).forEach(id => s.add(id)));
  add(stores.q.items); add(stores.k.items); add(trash.map(t => t.item));
  return s;
}
async function gcImages() {
  try {
    const keep = referencedImageIds();
    const keys = await idbKeys();
    const gone = keys.filter(k => !keep.has(k));
    for (const k of gone) await idbDel(k);
    return gone.length;
  } catch (e) { return 0; }
}

const imgCache = new Map(); // id -> objectURL
async function imgUrl(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  try {
    const rec = await idbGet(id);
    if (!rec || !rec.blob) return null;
    const u = URL.createObjectURL(rec.blob);
    imgCache.set(id, u);
    return u;
  } catch (e) { return null; }
}
function hydrateImages(root) {
  root.querySelectorAll('img[data-img-id]').forEach(el => {
    imgUrl(el.dataset.imgId).then(u => {
      if (u) el.src = u; else el.classList.add('broken');
    });
  });
}
function dropImage(id) {
  const u = imgCache.get(id);
  if (u) { URL.revokeObjectURL(u); imgCache.delete(id); }
  idbDel(id).catch(() => {});
}

// 压缩：默认最长边 1600、JPEG 0.85；小图或压缩后反而更大则保留原图
function compressImage(file, maxSide, quality) {
  const limit = maxSide || 1600;
  const q = quality || 0.85;
  return new Promise(resolve => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, limit / Math.max(w, h));
      if (scale === 1 && file.size <= 200 * 1024) { URL.revokeObjectURL(url); return resolve(file); }
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas');
      cv.width = outW; cv.height = outH;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);
      URL.revokeObjectURL(url);
      cv.toBlob(b => resolve(b && b.size < file.size ? b : file), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function attachImages(item, files) {
  let added = 0;
  for (const f of files) {
    const blob = await compressImage(f);
    if (!blob) continue;
    const id = 'img_' + uid();
    await idbPut({ id, blob, type: blob.type || 'image/jpeg', size: blob.size || 0, addedAt: Date.now() });
    item.images = (item.images || []).concat(id);
    added++;
  }
  return added;
}

const imgStrip = it => (it.images && it.images.length)
  ? `<div class="imgs">${it.images.map(id => `<img class="thumb" data-img-id="${id}" alt="配图" loading="lazy">`).join('')}</div>`
  : '';

function renderThumbs(box, ids, onDelete) {
  if (!ids.length) { box.innerHTML = '<span class="section-label">还没有图片</span>'; return; }
  box.innerHTML = ids.map(id =>
    `<div class="thumb-wrap"><img class="thumb" data-img-id="${id}" alt="配图"><button class="thumb-del" data-del="${id}" title="移除">×</button></div>`
  ).join('');
  hydrateImages(box);
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation(); onDelete(b.dataset.del); });
}

/* ---------- 图片查看 ---------- */
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add('open');
}
document.getElementById('lightboxClose').onclick = () => lightbox.classList.remove('open');
lightbox.onclick = e => { if (e.target === lightbox) lightbox.classList.remove('open'); };
document.addEventListener('click', e => {
  if (!e.target || !e.target.closest) return;
  const t = e.target.closest('img.thumb');
  if (t && t.src) openLightbox(t.src);
});

/* ---------- 回收站（软删除，30 天自动清理） ---------- */
const TRASH_DAYS = 30;
let trash = []; // 启动时由 loadInitial 从 IndexedDB 载入
function saveTrash() { persist(K_TRASH, trash); }
function updateTrashCount() {
  const el = document.getElementById('trashCount');
  if (el) el.textContent = trash.length;
}
function toTrash(kind, item) {
  trash.unshift({ kind, item, deletedAt: Date.now() });
  saveTrash();
  updateTrashCount();
}
function purgeTrash() {
  const limit = TRASH_DAYS * 24 * 3600 * 1000;
  const keep = [], gone = [];
  for (const t of trash) (Date.now() - t.deletedAt > limit ? gone : keep).push(t);
  if (!gone.length) return;
  trash = keep;
  saveTrash();
  gone.forEach(t => (t.item.images || []).forEach(dropImage));
}
function purgeTrashOne(i) {
  const t = trash[i];
  if (!t) return;
  (t.item.images || []).forEach(dropImage);
  trash.splice(i, 1);
  saveTrash();
  updateTrashCount();
}
function restoreTrashOne(i) {
  const t = trash[i];
  if (!t) return;
  const kind = t.kind === 'k' ? 'k' : 'q';
  stores[kind].items.push(stores[kind].norm(t.item));
  saveStore(stores[kind].key, stores[kind].items);
  trash.splice(i, 1);
  saveTrash();
  updateTrashCount();
  refreshTagPicker();
  render();
}

const trashModal = document.getElementById('trashModal');
function renderTrash() {
  const box = document.getElementById('trashList');
  if (!trash.length) {
    box.innerHTML = '<div class="empty" style="padding:24px 0">回收站是空的。</div>';
    return;
  }
  box.innerHTML = trash.map((t, i) => {
    const isK = t.kind === 'k';
    const title = isK ? (t.item.title || '（无名称）') : (t.item.stem || '（无题目）');
    const days = Math.floor((Date.now() - t.deletedAt) / 86400000);
    return `<div class="pvi">
      <div class="section-label" style="margin-bottom:6px">${isK ? '知识点' : '错题'} · 删除于 ${days > 0 ? days + ' 天前' : '今天'}</div>
      <div class="stem">${renderMath(title)}</div>
      <div class="imgs">${(t.item.images || []).map(id => `<img class="thumb" data-img-id="${id}" alt="配图">`).join('')}</div>
      <div class="row" style="margin-top:8px">
        <button data-restore="${i}">恢复</button>
        <button class="danger" data-purge="${i}">彻底删除</button>
      </div>
    </div>`;
  }).join('');
  hydrateImages(box);
  box.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { restoreTrashOne(+b.dataset.restore); renderTrash(); });
  box.querySelectorAll('[data-purge]').forEach(b => b.onclick = () => {
    if (confirm('彻底删除，无法恢复。确定？')) { purgeTrashOne(+b.dataset.purge); renderTrash(); }
  });
}
document.getElementById('openTrash').onclick = () => {
  settingsDrawer.classList.remove('open');
  renderTrash();
  trashModal.classList.add('open');
};
document.getElementById('trashClose').onclick = () => trashModal.classList.remove('open');
trashModal.onclick = e => { if (e.target === trashModal) trashModal.classList.remove('open'); };
document.getElementById('trashEmpty').onclick = () => {
  if (!trash.length) return;
  if (!confirm(`彻底删除回收站里的全部 ${trash.length} 项？无法恢复。`)) return;
  trash.forEach(t => (t.item.images || []).forEach(dropImage));
  trash = [];
  saveTrash();
  updateTrashCount();
  renderTrash();
};

/* ---------- 重复检测（bigram 预编译；批量导入时复用同一索引） ---------- */
function dupKey(kind) { return kind === 'k' ? 'title' : 'stem'; }

function buildDupIndex(kind) {
  const key = dupKey(kind);
  const out = [];
  for (const it of stores[kind].items) {
    const p = makeGramProfile(it[key]);
    if (p.len) out.push({ item: it, profile: p });
  }
  return out;
}
function findDupIn(index, value) {
  if (!normText(value)) return null;
  let best = null;
  for (const p of index) {
    const s = simFromProfile(p.profile, value);
    if (s >= 0.85 && (!best || s > best.score)) best = { score: s, item: p.item };
  }
  return best;
}
// 统计一批待导入项里，有多少与现有条目高度相似
function countDups(kind, incoming) {
  const key = dupKey(kind);
  const index = buildDupIndex(kind);
  let n = 0;
  for (const o of incoming) {
    const val = o && o[key];
    if (!normText(val)) continue;
    if (findDupIn(index, val)) n++;
  }
  return n;
}

/* ---------- 持久化：优先 IndexedDB（容量大），不可用时回退 localStorage ---------- */
const KV_STORE = 'kv';
function lsRead(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return undefined; } }
function lsWrite(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }

async function idbKVGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbKVPut(key, json) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put({ key, json });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
// 读：IndexedDB 优先；IDB 不可用时读 localStorage
async function kvGet(key) {
  try {
    const rec = await idbKVGet(key);
    return rec === undefined ? undefined : JSON.parse(rec.json);
  } catch (e) { return lsRead(key); }
}
// 写：IndexedDB 优先；失败回退 localStorage；两者都失败才提示
async function persist(key, val) {
  try {
    await idbKVPut(key, JSON.stringify(val));
    localStorage.removeItem(key); // 迁移到 IDB 后释放 localStorage 空间
    return true;
  } catch (e) {
    if (lsWrite(key, val)) return true;
    alert('本地存储写入失败（可能是隐私模式或空间不足），建议先「导出」备份。');
    return false;
  }
}
// 沿用 saveStore 名字：触发异步写入，不阻塞 UI
function saveStore(key, list) { return persist(key, list); }

function seedQuestions() {
  const now = Date.now();
  return [
    {
      id: uid(), status: 'new', tags: ['二次函数', '最值'], createdAt: now, updatedAt: now,
      stem: '求函数 $f(x)=x^{2}-2x+1$ 的最小值，并指出取最小值时 $x$ 的取值。',
      analysis: '配方得 $f(x)=(x-1)^{2}$。因为 $(x-1)^{2}\\ge 0$，所以最小值为 $0$，当且仅当 $x=1$ 时取得。',
      knowledge: '二次函数顶点式 $y=a(x-h)^{2}+k$，顶点为 $(h,k)$。当 $a>0$ 时开口向上，顶点处取最小值。易错点：忘记验证取等条件。',
    },
    {
      id: uid(), status: 'reviewing', tags: ['导数', '单调性'], createdAt: now, updatedAt: now,
      stem: "已知 $f(x)=x^{3}-3x$，求 $f(x)$ 的单调递增区间。",
      analysis: "求导得 $f'(x)=3x^{2}-3=3(x-1)(x+1)$。令 $f'(x)>0$，解得 $x<-1$ 或 $x>1$，故单调递增区间为 $(-\\infty,-1)$ 与 $(1,+\\infty)$。",
      knowledge: "用导数判断单调性：$f'(x)>0$ 的区间上 $f$ 递增，$f'(x)<0$ 的区间上递减。易错点：区间端点是否可取、以及导数为零的点。",
    },
  ];
}

function seedKps() {
  const now = Date.now();
  return [
    {
      id: uid(), status: 'new', tags: ['函数', '二次函数'], createdAt: now, updatedAt: now,
      title: '二次函数顶点式',
      content: '把二次函数写成 $y=a(x-h)^{2}+k$ 的形式，顶点坐标为 $(h,k)$。当 $a>0$ 时开口向上，顶点处取最小值；当 $a<0$ 时开口向下，顶点处取最大值。\n易错点：配方时符号容易出错；取最值要验证取等条件。',
    },
    {
      id: uid(), status: 'reviewing', tags: ['导数', '单调性'], createdAt: now, updatedAt: now,
      title: '用导数判断单调性',
      content: '$f\'(x)>0$ 的区间上 $f$ 单调递增，$f\'(x)<0$ 的区间上单调递减。\n步骤：求导 → 解 $f\'(x)=0$ → 列表判断各区间导数符号。\n易错点：单调区间端点是否可取；导数不存在的点要单独讨论。',
    },
  ];
}

const stores = {
  q: { key: K_Q, norm: normalizeQuestion, items: [] },
  k: { key: K_K, norm: normalizeKp, items: [] },
};

// 启动时从 IndexedDB 载入（并把旧版 localStorage 数据迁移过来）
async function loadInitial() {
  for (const kind of ['q', 'k']) {
    const key = stores[kind].key;
    let raw = await kvGet(key);
    if (!Array.isArray(raw)) raw = lsRead(key); // IDB 无记录时，检查旧版 localStorage
    if (Array.isArray(raw)) {
      stores[kind].items = raw.map(stores[kind].norm);
    } else {
      stores[kind].items = (kind === 'q' ? seedQuestions() : seedKps()).map(stores[kind].norm);
    }
    await persist(key, stores[kind].items); // 迁移或首次种子都落盘
  }
  let t = await kvGet(K_TRASH);
  if (!Array.isArray(t)) t = lsRead(K_TRASH);
  trash = Array.isArray(t) ? t : [];
}

/* ===================== 视图定义 ===================== */
const DEF = {
  q: {
    noun: '道错题',
    addLabel: '+ 新增错题',
    randomLabel: '随机一题',
    overviewTitle: '随机一题 · 先自己想，再展开',
    fieldLabels: { stem: '题目（公式用 $...$）', analysis: '解析', knowledge: '知识点讲解', myAnswer: '我的错误答案（可选）' },
    importFieldMap: { 题目: 'stem', 解析: 'analysis', 知识点: 'knowledge', 我的错误答案: 'myAnswer', 标签: 'tags' },
    importRequired: '题目',
    importExample: '【题目】\n求函数 $f(x)=x^2-2x+1$ 的最小值。\n【解析】\n配方得 $f(x)=(x-1)^2$，故最小值为 $0$，在 $x=1$ 处取得。\n【知识点】\n二次函数顶点式 $y=a(x-h)^2+k$，顶点为 $(h,k)$。\n【我的错误答案】\n（选填：我当时是怎么错的）\n【标签】\n二次函数, 最值\n\n多题之间用单独一行 === 分隔',
    main: it => `<div class="stem">${renderMath(it.stem)}</div>`,
    details: it => [
      { label: '查看我的错误答案', text: it.myAnswer || '' },
      { label: '查看解析', text: it.analysis },
      { label: '查看知识点讲解', text: it.knowledge },
    ],
    hay: it => [it.stem, it.analysis, it.knowledge, it.myAnswer || '', it.tags.join(' ')].join(' '),
    previewMain: o => o.stem || '（无题目）',
    previewInfo: o => `解析 ${o.analysis ? '✓' : '✗'} · 知识点 ${o.knowledge ? '✓' : '✗'} · 标签 ${o.tags.length}`,
  },
  k: {
    noun: '个知识点',
    addLabel: '+ 新增知识点',
    randomLabel: '随机一个知识点',
    overviewTitle: '只看知识点 · 先回忆，再展开',
    fieldLabels: { title: '知识点名称', content: '讲解（公式用 $...$）' },
    importFieldMap: { 知识点: 'title', 讲解: 'content', 标签: 'tags' },
    importRequired: '知识点',
    importExample: '【知识点】\n二次函数顶点式\n【讲解】\n$y=a(x-h)^2+k$，顶点为 $(h,k)$，$a>0$ 时开口向上。\n【标签】\n函数, 二次函数\n\n多个知识点之间用单独一行 === 分隔',
    main: it => `<div class="stem"><span class="kp-badge">知识点</span>${renderMath(it.title)}</div>`,
    details: it => [{ label: '查看讲解', text: it.content }],
    hay: it => [it.title, it.content, it.tags.join(' ')].join(' '),
    previewMain: o => o.title || '（无名称）',
    previewInfo: o => `讲解 ${o.content ? '✓' : '✗'} · 标签 ${o.tags.length}`,
  },
};

const PAGE = 30;
const views = {
  q: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false },
  k: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false },
};
let active = 'q';
let editingId = null;
let pending = [];
let pendingAnim = false;
// 记录已展开的折叠区（键为 `itemId|label`），使重渲染后不丢失展开状态
const openDetails = new Set();

const cur = () => views[active];
const curItems = () => stores[active].items;
const saveActive = () => saveStore(stores[active].key, curItems());

/* ===================== render ===================== */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMath(text) {
  if (!text) return '';
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map(p => {
    let m;
    if ((m = p.match(/^\$\$([\s\S]+?)\$\$$/))) {
      try { return katex.renderToString(m[1], { displayMode: true, throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    if ((m = p.match(/^\$([^$]+?)\$$/))) {
      try { return katex.renderToString(m[1], { throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    return esc(p).replace(/\n/g, '<br>');
  }).join('');
}

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const statusEl = document.getElementById('statusFilter');
const loadMoreRow = document.getElementById('loadMoreRow');
const addBtn = document.getElementById('addBtn');
const randomBtn = document.getElementById('randomBtn');
const tabEls = [...document.querySelectorAll('.tab')];

// 搜索文本缓存：按 id + updatedAt 命中，避免每次筛选重新拼接
const hayCache = new Map();
function hayOf(it) {
  const c = hayCache.get(it.id);
  if (c && c.u === it.updatedAt) return c.hay;
  const hay = DEF[active].hay(it).toLowerCase();
  hayCache.set(it.id, { u: it.updatedAt, hay });
  return hay;
}

function currentFiltered() {
  const v = cur();
  const s = parseSearch(v.search);
  const now = Date.now();
  const out = curItems().filter(it => {
    if (v.status && it.status !== v.status) return false;
    if (s.status && it.status !== s.status) return false;
    if (v.starOnly && !it.star) return false;
    if (s.star && !it.star) return false;
    if (v.dueOnly && !isDue(it, now)) return false;
    if (s.due && !isDue(it, now)) return false;
    // 标签筛选：默认「同时满足全部（交集）」；由「相关 X 个」跳转时改为「满足其一（并集）」，与计数口径一致
    if (v.activeTags.size) {
      const hit = v.tagMode === 'any'
        ? [...v.activeTags].some(t => it.tags.includes(t))
        : [...v.activeTags].every(t => it.tags.includes(t));
      if (!hit) return false;
    }
    if (s.tags.length && !s.tags.every(t => it.tags.includes(t))) return false;
    if (s.text && !hayOf(it).includes(s.text)) return false;
    return true;
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function bindLazy(detailsEl, key, text, emptyLabel) {
  const body = detailsEl.querySelector('.body');
  const paint = () => {
    if (body.dataset.done === '1') return;
    body.innerHTML = text ? renderMath(text) : `<span class="section-label">${emptyLabel}</span>`;
    body.dataset.done = '1';
  };
  if (detailsEl.open) paint();
  detailsEl.addEventListener('toggle', () => {
    if (detailsEl.open) { openDetails.add(key); paint(); }
    else openDetails.delete(key);
  });
}

// 与「另一库」按标签交集的数量：错题视图看知识点，知识点视图看错题
function relatedCount(it) {
  if (!it.tags.length) return 0;
  const other = active === 'k' ? stores.q.items : stores.k.items;
  return other.filter(o => o.tags.some(t => it.tags.includes(t))).length;
}

// 统一的复习动作：切换状态并安排下次复习时间（SRS）
function applyStatus(item, next) {
  item.status = next;
  item.updatedAt = Date.now();
  scheduleSrs(item, next);
  saveActive();
}

function makeCard(it) {
  const d = DEF[active];
  const v = cur();
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = it.id;
  const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const rc = relatedCount(it); // 只计算一次
  const rel = rc
    ? `<span class="relchip" data-rel="1">相关${active === 'k' ? '错题' : '知识点'} ${rc} ${active === 'k' ? '道' : '个'}</span>` : '';
  const due = `<span class="duechip${isDue(it) ? ' due' : ''}" data-due="1" title="点击标记为「复习中」">🕒 ${dueLabel(it)}</span>`;
  // 「我的错误答案」为空时不显示该折叠区，避免噪音
  const dets = d.details(it).filter(x => x.label !== '查看我的错误答案' || x.text);
  card.innerHTML = `
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <button class="star ${it.star ? 'on' : ''}" data-act="star" title="${it.star ? '取消收藏' : '收藏'}">${it.star ? '★' : '☆'}</button>
      ${tags}${rel}
      <div class="cardacts">
        ${due}
        <span class="status ${it.status}" data-act="status">● ${STATUS[it.status]}</span>
        <button class="link" data-act="edit">编辑</button>
        <button class="link" data-act="delete">删除</button>
      </div>
    </div>
    ${dets.map(x => {
      const key = it.id + '|' + x.label;
      return `<details data-key="${esc(key)}"${openDetails.has(key) ? ' open' : ''}><summary>${x.label}</summary><div class="body"></div></details>`;
    }).join('')}
  `;
  card.querySelectorAll('details').forEach((el, i) => bindLazy(el, it.id + '|' + dets[i].label, dets[i].text, '（暂无）'));

  card.querySelector('[data-act="status"]').onclick = () => {
    applyStatus(it, STATUS_NEXT[it.status]);
    const el = card.querySelector('[data-act="status"]');
    el.className = 'status ' + it.status;
    el.textContent = '● ' + STATUS[it.status];
    const dueEl = card.querySelector('[data-due]');
    if (dueEl) { dueEl.textContent = '🕒 ' + dueLabel(it); dueEl.classList.toggle('due', isDue(it)); }
    // 状态筛选 / 待复习筛选生效时，列表组成会变化，需要整体重渲染
    if (v.status || v.dueOnly) render();
  };
  card.querySelector('[data-act="star"]').onclick = () => {
    it.star = !it.star;
    saveActive();
    const btn = card.querySelector('[data-act="star"]');
    btn.classList.toggle('on', it.star);
    btn.textContent = it.star ? '★' : '☆';
    btn.title = it.star ? '取消收藏' : '收藏';
    if (v.starOnly && !it.star) render();
  };
  card.querySelector('[data-act="edit"]').onclick = () => openEdit(it);
  card.querySelector('[data-act="delete"]').onclick = () => {
    if (confirm('移入回收站？30 天内可在「设置 → 回收站」恢复。')) {
      toTrash(active, it);
      stores[active].items = curItems().filter(x => x.id !== it.id);
      v.selected.delete(it.id);
      saveActive();
      refreshTagPicker();
      render();
    }
  };
  const pick = card.querySelector('[data-act="pick"]');
  if (pick) pick.onchange = () => {
    pick.checked ? v.selected.add(it.id) : v.selected.delete(it.id);
    updateToolbar();
    if (v.groupMode) render();
  };
  const relEl = card.querySelector('[data-rel]');
  if (relEl) relEl.onclick = () => {
    const other = active === 'k' ? 'q' : 'k';
    const ov = views[other];
    ov.activeTags = new Set(it.tags);
    ov.tagMode = 'any';          // 与「相关 X 个」的计数口径一致：命中任一标签即算相关
    ov.visibleCount = PAGE;
    ov.search = '';
    ov.status = '';
    ov.starOnly = false;
    ov.dueOnly = false;
    ov.selectMode = false;
    ov.selected.clear();
    switchView(other);
  };
  // 移动端：长按 0.5 秒进入多选并选中该项
  let pressT = null, moved = false;
  card.addEventListener('touchstart', () => {
    if (v.selectMode) return;
    moved = false;
    pressT = setTimeout(() => {
      if (moved) return;
      enterSelectMode([it.id]);
      if (navigator.vibrate) navigator.vibrate(15);
      const s = window.getSelection && window.getSelection();
      if (s && s.removeAllRanges) s.removeAllRanges();
    }, 500);
  }, { passive: true });
  card.addEventListener('touchmove', () => { moved = true; clearTimeout(pressT); }, { passive: true });
  card.addEventListener('touchend', () => clearTimeout(pressT));
  card.addEventListener('touchcancel', () => { moved = true; clearTimeout(pressT); });

  return card;
}

function render() {
  const v = cur();
  const filtered = currentFiltered();
  const shown = filtered.slice(0, v.visibleCount);
  countEl.textContent = `共 ${curItems().length} ${DEF[active].noun}，筛选出 ${filtered.length}，已显示 ${shown.length}`;
  listEl.innerHTML = '';

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty">还没有内容。点右上角「${DEF[active].addLabel}」粘贴一段试试。</div>`;
    loadMoreRow.style.display = 'none';
    pendingAnim = false;
    updateToolbar();
    return;
  }

  if (v.groupMode) {
    const groups = new Map();
    for (const it of shown) {
      const key = it.tags[0] || '未分类';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    for (const [tag, arr] of groups) {
      const g = document.createElement('details');
      g.className = 'group';
      g.open = true;
      g.innerHTML = `<summary>${esc(tag)} · ${arr.length} 道</summary>`;
      const box = document.createElement('div');
      box.className = 'group-body';
      arr.forEach(it => box.appendChild(makeCard(it)));
      g.appendChild(box);
      listEl.appendChild(g);
    }
  } else {
    shown.forEach(it => listEl.appendChild(makeCard(it)));
  }

  if (pendingAnim) {
    [...listEl.querySelectorAll('.card')].forEach((c, i) => {
      c.classList.add('enter');
      c.style.animationDelay = Math.min(i, 12) * 18 + 'ms';
    });
    pendingAnim = false;
  }
  loadMoreRow.style.display = filtered.length > shown.length ? 'flex' : 'none';
  hydrateImages(listEl);
  updateToolbar();
}

function updateToolbar() {
  const v = cur();
  document.getElementById('toolbar').style.display = v.selectMode ? 'flex' : 'none';
  document.getElementById('selCount').textContent = `已选 ${v.selected.size} 项`;
}

/* ===================== 标签（两库并集） ===================== */
function allTags() {
  return [...new Set([...stores.q.items, ...stores.k.items].flatMap(i => i.tags))].sort();
}

function refreshTagPicker() {
  const menu = document.getElementById('tagMenu');
  const v = cur();
  const tags = allTags();
  const clearRow = v.activeTags.size ? '<div class="tagopt clear">清除标签筛选</div>' : '';
  const note = v.activeTags.size >= 2
    ? `<div class="tagopt" style="color:var(--muted); font-size:12px; cursor:default">已选 ${v.activeTags.size} 个 · ${v.tagMode === 'any' ? '满足其一即可（并集）' : '需同时满足（交集）'}</div>`
    : '';
  menu.innerHTML = clearRow + note + (tags.length
    ? tags.map(t => `<label class="tagopt"><input type="checkbox" value="${esc(t)}" ${v.activeTags.has(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')
    : '<div class="tagopt" style="color:var(--muted)">暂无标签</div>');
  menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      v.tagMode = 'all';         // 手动勾选时回到交集语义
      cb.checked ? v.activeTags.add(cb.value) : v.activeTags.delete(cb.value);
      refreshTagPicker();
      applyFilters();
    };
  });
  const clear = menu.querySelector('.tagopt.clear');
  if (clear) clear.onclick = () => { v.activeTags.clear(); v.tagMode = 'all'; refreshTagPicker(); applyFilters(); };
  document.getElementById('tagPickBtn').textContent = v.activeTags.size ? `标签 · ${v.activeTags.size}个 ▾` : '标签 ▾';
}

/* ===================== ui ===================== */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function applyFilters() {
  cur().visibleCount = PAGE;
  cur().selected.clear();
  pendingAnim = true;
  render();
}

function syncHeader() {
  const v = cur();
  searchEl.value = v.search;
  statusEl.value = v.status;
  document.getElementById('selectBtn').classList.toggle('primary', v.selectMode);
  document.getElementById('groupBtn').classList.toggle('primary', v.groupMode);
  const sb = document.getElementById('starBtn');
  sb.classList.toggle('on', v.starOnly);
  sb.textContent = v.starOnly ? '★ 只看收藏' : '☆ 只看收藏';
  const db = document.getElementById('dueBtn');
  if (db) {
    db.classList.toggle('on', v.dueOnly);
    const dueN = curItems().filter(it => isDue(it)).length;
    db.textContent = dueN ? `🕒 待复习 ${dueN}` : '🕒 待复习';
  }
}

function switchView(v) {
  active = v;
  tabEls.forEach(t => t.classList.toggle('active', t.dataset.view === v));
  addBtn.textContent = DEF[v].addLabel;
  randomBtn.textContent = DEF[v].randomLabel;
  syncHeader();
  refreshTagPicker();
  pendingAnim = true;
  render();
}

tabEls.forEach(t => t.onclick = () => switchView(t.dataset.view));
searchEl.oninput = debounce(() => { cur().search = searchEl.value; applyFilters(); }, 200);
statusEl.onchange = () => { cur().status = statusEl.value; applyFilters(); };
document.getElementById('loadMoreBtn').onclick = () => { cur().visibleCount += PAGE; render(); };

document.getElementById('tagPickBtn').onclick = e => {
  e.stopPropagation();
  document.getElementById('tagMenu').classList.toggle('open');
};
document.getElementById('tagMenu').onclick = e => e.stopPropagation();
document.addEventListener('click', () => document.getElementById('tagMenu').classList.remove('open'));

document.getElementById('selectBtn').onclick = () => {
  const v = cur();
  v.selectMode = !v.selectMode;
  if (!v.selectMode) v.selected.clear();
  document.getElementById('selectBtn').classList.toggle('primary', v.selectMode);
  render();
};
document.getElementById('groupBtn').onclick = () => {
  const v = cur();
  v.groupMode = !v.groupMode;
  document.getElementById('groupBtn').classList.toggle('primary', v.groupMode);
  render();
};

function enterSelectMode(ids) {
  const v = cur();
  v.selectMode = true;
  v.selected = new Set(ids || []);
  document.getElementById('selectBtn').classList.add('primary');
  render();
}

document.getElementById('starBtn').onclick = () => {
  const v = cur();
  v.starOnly = !v.starOnly;
  syncHeader();
  applyFilters();
};

document.getElementById('dueBtn').onclick = () => {
  const v = cur();
  v.dueOnly = !v.dueOnly;
  syncHeader();
  applyFilters();
};

/* ---------- 批量操作 ---------- */
document.getElementById('selAll').onclick = () => {
  const v = cur();
  currentFiltered().slice(0, v.visibleCount).forEach(it => v.selected.add(it.id));
  render();
};
document.getElementById('selNone').onclick = () => { cur().selected.clear(); render(); };
document.getElementById('exitSelect').onclick = () => {
  const v = cur();
  v.selectMode = false;
  v.selected.clear();
  document.getElementById('selectBtn').classList.remove('primary');
  render();
};
document.querySelectorAll('[data-batch-status]').forEach(btn => {
  btn.onclick = () => {
    const v = cur();
    if (!v.selected.size) return alert('还没选任何项。');
    curItems().forEach(it => {
      if (v.selected.has(it.id)) { it.status = btn.dataset.batchStatus; it.updatedAt = Date.now(); scheduleSrs(it, btn.dataset.batchStatus); }
    });
    saveActive();
    render();
  };
});
document.getElementById('batchTag').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  const input = prompt('给选中的项添加标签（多个用逗号分隔）：');
  if (!input) return;
  const add = input.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  curItems().forEach(it => {
    if (v.selected.has(it.id)) { it.tags = [...new Set(it.tags.concat(add))]; it.updatedAt = Date.now(); }
  });
  saveActive();
  refreshTagPicker();
  render();
};
document.getElementById('batchDelete').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  if (!confirm(`确定把选中的 ${v.selected.size} 项移入回收站？30 天内可恢复。`)) return;
  curItems().filter(it => v.selected.has(it.id)).forEach(it => toTrash(active, it));
  stores[active].items = curItems().filter(it => !v.selected.has(it.id));
  v.selected.clear();
  saveActive();
  refreshTagPicker();
  render();
};

/* ---------- 新增 / 粘贴导入 ---------- */
const modal = document.getElementById('modal');
const previewEl = document.getElementById('preview');
const importRow = document.getElementById('importRow');
const addImgRow = document.getElementById('addImgRow');

/* 导入时临时配图（只有解析出 1 项时可用） */
let pendingImgs = [];
function renderPendingThumbs() {
  renderThumbs(document.getElementById('addThumbs'), pendingImgs, id => {
    pendingImgs = pendingImgs.filter(x => x !== id);
    dropImage(id);
    document.getElementById('addImgMsg').textContent = '';
    renderPendingThumbs();
  });
}
function resetPendingImgs() {
  pendingImgs = [];
  document.getElementById('addThumbs').innerHTML = '';
  document.getElementById('addImgMsg').textContent = '';
  addImgRow.style.display = 'none';
}
addImgRow.querySelector('#addImgBtn').onclick = () => document.getElementById('addImgInput').click();
document.getElementById('addImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const holder = { images: pendingImgs };
  const n = await attachImages(holder, files);
  pendingImgs = holder.images;
  document.getElementById('addImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderPendingThumbs();
};

addBtn.onclick = () => {
  const d = DEF[active];
  pending = [];
  resetPendingImgs();
  document.getElementById('addTitle').textContent = active === 'q' ? '粘贴 AI 内容 / 手动填写' : '粘贴 / 手动新增知识点';
  document.getElementById('addHint').innerHTML = `按固定格式粘贴，点「拆分预览」自动拆成字段。多项之间用单独一行 <b>===</b> 分隔。`;
  document.getElementById('formatHint').textContent = '格式示例：\n' + d.importExample;
  document.getElementById('rawInput').value = '';
  previewEl.classList.remove('show');
  previewEl.innerHTML = '';
  importRow.style.display = 'none';
  document.getElementById('parseMsg').textContent = '';
  modal.classList.add('open');
  document.getElementById('rawInput').focus();
};
document.getElementById('closeBtn').onclick = () => modal.classList.remove('open');
modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };

document.getElementById('parseBtn').onclick = () => {
  const d = DEF[active];
  pending = parseText(document.getElementById('rawInput').value, d.importFieldMap, d.importRequired);
  const msg = document.getElementById('parseMsg');
  if (!pending.length) {
    previewEl.classList.remove('show');
    importRow.style.display = 'none';
    msg.textContent = '没解析到内容，检查一下格式。';
    return;
  }
  const bad = pending.filter(p => p.errors.length).length;
  msg.textContent = `解析到 ${pending.length} 项${bad ? `，其中 ${bad} 项有问题` : ''}。`;
  previewEl.classList.add('show');
  importRow.style.display = 'flex';
  if (pending.length === 1) {
    addImgRow.style.display = 'block';
    renderPendingThumbs();
  } else {
    resetPendingImgs();
  }
  previewEl.innerHTML = pending.map((p, i) => `
    <div class="pvi">
      <div class="row" style="margin:0 0 8px">
        <input type="checkbox" data-i="${i}" checked>
        <span class="section-label">第 ${i + 1} 项</span>
        ${p.errors.length ? `<span class="badge-note">⚠ ${p.errors.map(esc).join('；')}</span>` : ''}
      </div>
      <div class="stem">${renderMath(d.previewMain(p))}</div>
      <div class="fields">${d.previewInfo(p)}</div>
    </div>
  `).join('');
};

document.getElementById('importBtn').onclick = () => {
  const checked = [...previewEl.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => +c.dataset.i);
  if (!checked.length) { alert('至少选一项。'); return; }

  // 去重：与已有内容高度相似时先提醒（索引只建一次，避免逐条重扫）
  const dupIndex = buildDupIndex(active);
  const key = dupKey(active);
  const dups = checked.filter(i => findDupIn(dupIndex, pending[i][key]));
  if (dups.length) {
    const names = dups.slice(0, 5).map(i => '· ' + DEF[active].previewMain(pending[i])).join('\n');
    if (!confirm(`检测到 ${dups.length} 项与已有内容高度相似：\n${names}${dups.length > 5 ? '\n…' : ''}\n\n仍要全部导入吗？点「取消」将中止本次导入。`)) return;
  }

  // 单题导入时把临时配图挂上去
  if (checked.length === 1 && pendingImgs.length) pending[checked[0]].images = pendingImgs.slice();

  const norm = stores[active].norm;
  for (const i of checked) stores[active].items.push(norm(pending[i]));
  saveActive();
  refreshTagPicker();
  resetPendingImgs();
  modal.classList.remove('open');
  applyFilters();
};

/* ---------- 编辑弹窗 ----------
   图片改动走「草稿」：在弹窗里的增删只改草稿，点「保存」才落盘并清理被移除的图片；
   点「取消」/关闭则丢弃本次新增的图片，不动原始条目。 */
const editModal = document.getElementById('editModal');
let editImgs = [];      // 草稿图片列表
let editOrig = null;    // 打开弹窗时的原始图片集合

function renderEditThumbs() {
  renderThumbs(document.getElementById('editThumbs'), editImgs, id => {
    editImgs = editImgs.filter(x => x !== id); // 先只改草稿，保存时才真正删 blob
    renderEditThumbs();
  });
}
document.getElementById('editImgBtn').onclick = () => document.getElementById('editImgInput').click();
document.getElementById('editImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !editOrig) return;
  const holder = { images: [] };
  const n = await attachImages(holder, files);
  editImgs = editImgs.concat(holder.images);
  document.getElementById('editImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderEditThumbs();
};

function openEdit(it) {
  editingId = it.id;
  editOrig = new Set(it.images || []);
  editImgs = (it.images || []).slice();
  const d = DEF[active];
  document.getElementById('editTitle').textContent = active === 'q' ? '编辑错题' : '编辑知识点';
  document.getElementById('editForm').innerHTML = Object.entries(d.fieldLabels).map(([key, label]) => `
    <label>${label}</label>
    <textarea id="ef_${key}" rows="4"></textarea>
  `).join('') + `
    <label>标签（英文逗号分隔）</label>
    <input id="ef_tags" class="field-input" type="text" placeholder="导数, 极值">
  `;
  for (const key of Object.keys(d.fieldLabels)) document.getElementById('ef_' + key).value = it[key];
  document.getElementById('ef_tags').value = it.tags.join(', ');
  document.getElementById('editImgMsg').textContent = '';
  renderEditThumbs();
  editModal.classList.add('open');
}
function finishEdit() {
  editImgs = []; editOrig = null; editingId = null;
  editModal.classList.remove('open');
}
function cancelEdit() {
  // 丢弃本次新增、未被保存的图片
  if (editOrig) editImgs.filter(id => !editOrig.has(id)).forEach(dropImage);
  finishEdit();
}
document.getElementById('editCancel').onclick = cancelEdit;
editModal.onclick = e => { if (e.target === editModal) cancelEdit(); };
document.getElementById('editSave').onclick = () => {
  const it = curItems().find(x => x.id === editingId);
  if (!it) return;
  for (const key of Object.keys(DEF[active].fieldLabels)) it[key] = document.getElementById('ef_' + key).value.trim();
  it.tags = document.getElementById('ef_tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  it.updatedAt = Date.now();
  // 图片：提交草稿，并删除被移除的 blob
  if (editOrig) [...editOrig].filter(id => !editImgs.includes(id)).forEach(dropImage);
  it.images = editImgs.slice();
  saveActive();
  refreshTagPicker();
  render();
  finishEdit();
};

/* ---------- 随机复习 ---------- */
const randomModal = document.getElementById('randomModal');
randomBtn.onclick = () => {
  const pool = currentFiltered();
  if (!pool.length) return alert('当前筛选下没有内容。');
  const it = pool[Math.floor(Math.random() * pool.length)];
  const d = DEF[active];
  document.getElementById('randomTitle').textContent = d.overviewTitle;
  const secs = d.details(it).filter(x => x.label !== '查看我的错误答案' || x.text);
  document.getElementById('randomBody').innerHTML = `
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <span class="duechip${isDue(it) ? ' due' : ''}">🕒 ${dueLabel(it)}</span>
      ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      <span class="spacer"></span>
      <span class="status ${it.status}">● ${STATUS[it.status]}</span>
    </div>
    ${secs.map(x => `<details><summary>${x.label}</summary><div class="body">${renderMath(x.text) || '<span class="section-label">（暂无）</span>'}</div></details>`).join('')}
  `;
  hydrateImages(document.getElementById('randomBody'));
  randomModal.classList.add('open');
};
document.getElementById('randomClose').onclick = () => randomModal.classList.remove('open');
document.getElementById('randomNext').onclick = () => randomBtn.click();
randomModal.onclick = e => { if (e.target === randomModal) randomModal.classList.remove('open'); };

/* ---------- 导出 / 导入（两库一起） ---------- */
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 体积小的纯文字备份（不含配图）
document.getElementById('exportBtn').onclick = () => {
  const payload = { version: 2, questions: stores.q.items, knowledge: stores.k.items };
  downloadBlob(`数学复习本-${dateStamp()}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

// 完整备份：把配图以 base64 一并写入，换设备后可完整还原
document.getElementById('exportFullBtn').onclick = async () => {
  settingsDrawer.classList.remove('open');
  const payload = { version: 3, questions: stores.q.items, knowledge: stores.k.items, images: {} };
  try {
    for (const id of referencedImageIds()) {
      const rec = await idbGet(id);
      if (rec && rec.blob) payload.images[id] = { type: rec.type || 'image/jpeg', data: await blobToB64(rec.blob) };
    }
  } catch (e) { /* 图片读取失败时仍导出文字部分 */ }
  downloadBlob(`数学复习本-完整备份-${dateStamp()}.json`,
    new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

// 手动清理未被任何条目（含回收站）引用的图片
document.getElementById('gcBtn').onclick = async () => {
  const n = await gcImages();
  alert(n ? `已清理 ${n} 张无用图片。` : '没有发现无用图片。');
};

document.getElementById('importBtn2').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (err) { alert('文件不是合法的 JSON。'); return; }

    let qs = null, ks = null, imgs = null;
    if (Array.isArray(data)) {
      qs = data; // 兼容旧版：数组即错题列表
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.questions)) qs = data.questions;
      if (Array.isArray(data.knowledge)) ks = data.knowledge;
      if (data.images && typeof data.images === 'object') imgs = data.images;
    }
    if (qs === null && ks === null) { alert('文件结构不符合要求，未做任何修改。'); return; }
    if (qs && !qs.every(x => x && typeof x === 'object')) { alert('questions 结构非法，未做任何修改。'); return; }
    if (ks && !ks.every(x => x && typeof x === 'object')) { alert('knowledge 结构非法，未做任何修改。'); return; }

    const mode = confirm('点「确定」= 替换现有全部数据；点「取消」= 追加到现有数据之后。');
    if (!mode) {
      const dupQ = qs ? countDups('q', qs) : 0;
      const dupK = ks ? countDups('k', ks) : 0;
      if (dupQ + dupK) {
        const parts = [];
        if (dupQ) parts.push(`错题 ${dupQ} 道`);
        if (dupK) parts.push(`知识点 ${dupK} 个`);
        if (!confirm(`追加模式：检测到 ${parts.join('、')}与已有内容高度相似。仍要继续吗？`)) return;
      }
    }
    if (qs) { const inc = qs.map(normalizeQuestion); stores.q.items = mode ? inc : stores.q.items.concat(inc); saveStore(K_Q, stores.q.items); }
    if (ks) { const inc = ks.map(normalizeKp); stores.k.items = mode ? inc : stores.k.items.concat(inc); saveStore(K_K, stores.k.items); }

    // 还原配图（完整备份）：写入 IndexedDB，使条目里的图片 id 能取到
    let restored = 0;
    if (imgs) {
      for (const [id, rec] of Object.entries(imgs)) {
        if (!rec || typeof rec.data !== 'string') continue;
        try {
          const blob = b64ToBlob(rec.data, rec.type);
          await idbPut({ id, blob, type: rec.type || 'image/jpeg', size: blob.size || 0, addedAt: Date.now() });
          restored++;
        } catch (e) { /* 单张失败忽略 */ }
      }
    }
    // 替换模式下，被覆盖条目遗留的图片不再被引用，一并清掉
    if (mode) await gcImages();

    refreshTagPicker();
    applyFilters();
    alert(`导入完成：错题 ${stores.q.items.length} 道，知识点 ${stores.k.items.length} 个。` +
      (restored ? `\n已还原配图 ${restored} 张。` : ''));
  };
  reader.readAsText(file);
};

/* ---------- 统计 ---------- */
const statsModal = document.getElementById('statsModal');
document.getElementById('statsClose').onclick = () => statsModal.classList.remove('open');
statsModal.onclick = e => { if (e.target === statsModal) statsModal.classList.remove('open'); };
document.getElementById('openStats').onclick = () => {
  settingsDrawer.classList.remove('open');
  renderStats();
  statsModal.classList.add('open');
};

function statRow(label, value, total, cls) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return `<div class="stat-line"><span>${label}</span><b>${value}</b></div>
    <div class="stat-bar ${cls || ''}"><i style="width:${pct}%"></i></div>`;
}

function renderStats() {
  const week = Date.now() - 7 * 86400000;
  const sum = (list, st) => list.filter(i => i.status === st).length;
  const starN = list => list.filter(i => i.star).length;
  const imgN = list => list.reduce((n, i) => n + (i.images ? i.images.length : 0), 0);
  const weekN = list => list.filter(i => (i.createdAt || 0) >= week).length;

  const q = stores.q.items, k = stores.k.items;
  const freq = new Map();
  [...q, ...k].forEach(i => i.tags.forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const topTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  document.getElementById('statsBody').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <h3>错题</h3>
        ${statRow('总计', q.length, q.length)}
        ${statRow('未复习', sum(q, 'new'), q.length)}
        ${statRow('复习中', sum(q, 'reviewing'), q.length, 'warn')}
        ${statRow('已掌握', sum(q, 'mastered'), q.length, 'ok')}
        <div class="stat-line"><span>⭐ 收藏</span><b>${starN(q)}</b></div>
        <div class="stat-line"><span>近 7 天新增</span><b>${weekN(q)}</b></div>
      </div>
      <div class="stat-card">
        <h3>知识点</h3>
        ${statRow('总计', k.length, k.length)}
        ${statRow('未复习', sum(k, 'new'), k.length)}
        ${statRow('复习中', sum(k, 'reviewing'), k.length, 'warn')}
        ${statRow('已掌握', sum(k, 'mastered'), k.length, 'ok')}
        <div class="stat-line"><span>⭐ 收藏</span><b>${starN(k)}</b></div>
        <div class="stat-line"><span>近 7 天新增</span><b>${weekN(k)}</b></div>
      </div>
    </div>
    <div class="stat-card" style="margin-top:12px">
      <h3>其他</h3>
      <div class="stat-line"><span>配图数量</span><b>${imgN(q) + imgN(k)}</b></div>
      <div class="stat-line"><span>标签数量</span><b>${freq.size}</b></div>
      <div class="stat-line"><span>回收站</span><b>${trash.length}</b></div>
      <div style="margin-top:8px">
        <span class="section-label">常用标签</span>
        <div class="tagfreq">${topTags.length
          ? topTags.map(([t, n]) => `<span class="chip">${esc(t)} · ${n}</span>`).join('')
          : '<span class="section-label">暂无标签</span>'}</div>
      </div>
    </div>
  `;
}

/* ---------- 导出 Markdown ---------- */
function toMarkdown() {
  const isQ = active === 'q';
  const items = curItems().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const out = [`# 数学复习本 · ${isQ ? '错题' : '知识点'}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${items.length} 项`, ''];
  items.forEach((it, idx) => {
    const tags = it.tags.join('、') || '—';
    out.push(`## ${idx + 1}. ${STATUS[it.status]}${it.star ? ' ★' : ''}`);
    out.push('');
    out.push(`标签：${tags}`);
    out.push('');
    if (isQ) {
      out.push('**题目**');
      out.push('');
      out.push(it.stem || '（无题目）');
      if (it.myAnswer) { out.push(''); out.push('**我的错误答案**'); out.push(''); out.push(it.myAnswer); }
      if (it.analysis) { out.push(''); out.push('**解析**'); out.push(''); out.push(it.analysis); }
      if (it.knowledge) { out.push(''); out.push('**知识点**'); out.push(''); out.push(it.knowledge); }
    } else {
      out.push(`**${it.title || '（无名称）'}**`);
      if (it.content) { out.push(''); out.push(it.content); }
    }
    if (it.images && it.images.length) { out.push(''); out.push(`> 含配图 ${it.images.length} 张（图片未包含在 Markdown 中）`); }
    out.push('');
    out.push('---');
    out.push('');
  });
  return out.join('\n');
}

document.getElementById('exportMdBtn').onclick = () => {
  settingsDrawer.classList.remove('open');
  const isQ = active === 'q';
  const items = curItems();
  if (!items.length) { alert(`当前${isQ ? '错题' : '知识点'}库是空的。`); return; }
  const blob = new Blob([toMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `数学复习本-${isQ ? '错题' : '知识点'}-${stamp}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ---------- 打印（当前视图） ---------- */
document.getElementById('printBtn').onclick = () => {
  settingsDrawer.classList.remove('open');
  const isQ = active === 'q';
  const items = curItems().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) { alert(`当前${isQ ? '错题' : '知识点'}库是空的。`); return; }
  const area = document.getElementById('printArea');
  const head = `<h1>数学复习本 · ${isQ ? '错题' : '知识点'}</h1>
    <p class="print-meta">共 ${items.length} 项 · ${new Date().toLocaleDateString('zh-CN')}</p>`;
  const body = items.map((it, i) => {
    const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const main = isQ ? renderMath(it.stem) : `<b>${renderMath(it.title)}</b>`;
    const secs = isQ
      ? [['我的错误答案', it.myAnswer], ['解析', it.analysis], ['知识点', it.knowledge]]
      : [['讲解', it.content]];
    const secHtml = secs.filter(s => s[1]).map(s =>
      `<div class="print-sec"><div class="print-label">${s[0]}</div><div>${renderMath(s[1])}</div></div>`).join('');
    return `<div class="print-item">
      <div class="print-num">第 ${i + 1} 题${isQ ? '' : '（知识点）'} · ${STATUS[it.status]}${it.star ? ' ★' : ''}</div>
      <div class="print-head">${main}</div>
      ${tags ? `<div class="print-tags">${tags}</div>` : ''}
      ${imgStrip(it)}
      ${secHtml}
    </div>`;
  }).join('');
  area.innerHTML = head + body;
  hydrateImages(area);
  setTimeout(() => window.print(), 350);
};

/* ---------- 备份提醒 ---------- */
const K_LASTEXPORT = 'mq_lastexport';
const BACKUP_DAYS = 14;
const SNOOZE_DAYS = 7;
function getBackupMeta() {
  try { return JSON.parse(localStorage.getItem(K_LASTEXPORT)) || {}; } catch (e) { return {}; }
}
function setBackupMeta(o) {
  try { localStorage.setItem(K_LASTEXPORT, JSON.stringify(o)); } catch (e) {}
}
function updateBackupBar() {
  const bar = document.getElementById('backupBar');
  if (!bar) return;
  const total = stores.q.items.length + stores.k.items.length;
  const meta = getBackupMeta();
  if (!total || (meta.snooze && Date.now() - meta.snooze < SNOOZE_DAYS * 86400000)) {
    bar.style.display = 'none';
    return;
  }
  let txt;
  if (!meta.json) {
    txt = '你还没导出过备份，建议现在导出一份 JSON，避免数据丢失。';
  } else {
    const days = Math.floor((Date.now() - meta.json) / 86400000);
    if (days < BACKUP_DAYS) { bar.style.display = 'none'; return; }
    txt = `距上次备份已 ${days} 天，建议再导出一份 JSON 备份。`;
  }
  document.getElementById('backupText').textContent = txt;
  bar.style.display = 'flex';
}
document.getElementById('backupNow').onclick = () => document.getElementById('exportBtn').click();
document.getElementById('backupLater').onclick = () => {
  setBackupMeta(Object.assign(getBackupMeta(), { snooze: Date.now() }));
  updateBackupBar();
};

/* ---------- 返回顶部 ---------- */
const toTopEl = document.getElementById('toTop');
function updateToTop() {
  toTopEl.classList.toggle('show', window.scrollY > 400 && !cram.open);
}
window.addEventListener('scroll', updateToTop, { passive: true });
toTopEl.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

/* ---------- 背题模式 ---------- */
const cramEl = document.getElementById('cram');
const cramStage = document.getElementById('cramStage');
const cram = { open: false, pool: [], idx: 0, shown: {} };

function cramGo(delta) {
  cram.idx = Math.max(0, Math.min(cram.pool.length - 1, cram.idx + delta));
  cram.shown = {};
  renderCram();
}

function revealNext() {
  const it = cram.pool[cram.idx];
  if (!it) return;
  const next = DEF[active].details(it).filter(x => x.text).find(x => !cram.shown[x.label]);
  if (next) { cram.shown[next.label] = true; renderCram(); }
}

function renderCram() {
  const d = DEF[active];
  const it = cram.pool[cram.idx];
  if (!it) { closeCram(); return; }
  document.getElementById('cramProg').textContent = `${cram.idx + 1} / ${cram.pool.length}`;
  document.getElementById('cramPrev').disabled = cram.idx === 0;
  document.getElementById('cramNext').disabled = cram.idx === cram.pool.length - 1;

  const secs = d.details(it).filter(x => x.text);
  const secHtml = secs.map(x => cram.shown[x.label]
    ? `<div class="cram-sec"><span class="section-label">${esc(x.label.replace('查看', ''))}</span><div class="cram-body">${renderMath(x.text)}</div></div>`
    : `<button class="cram-reveal" data-reveal="${esc(x.label)}">👁 ${esc(x.label.replace('查看', '看'))}</button>`
  ).join('');

  cramStage.innerHTML = `
    <div class="cram-card">
      <div class="cram-meta">
        <button class="star ${it.star ? 'on' : ''}" data-cram-star title="收藏">${it.star ? '★' : '☆'}</button>
        ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        <span class="spacer"></span>
        <span class="status ${it.status}" data-cram-status>● ${STATUS[it.status]}</span>
      </div>
      ${d.main(it)}
      ${imgStrip(it)}
      ${secHtml}
      <p class="cram-hint">${secs.length ? '左右滑动 / 点下方按钮翻页 · 空格键揭示下一段' : '（这一项没有解析或讲解内容）'}</p>
    </div>
  `;
  hydrateImages(cramStage);

  cramStage.querySelector('[data-cram-status]').onclick = () => {
    applyStatus(it, STATUS_NEXT[it.status]);
    renderCram();
  };
  cramStage.querySelector('[data-cram-star]').onclick = () => {
    it.star = !it.star;
    saveActive();
    renderCram();
  };
  cramStage.querySelectorAll('[data-reveal]').forEach(b => {
    b.onclick = () => { cram.shown[b.dataset.reveal] = true; renderCram(); };
  });
  cramStage.scrollTop = 0;
}

function openCram() {
  const pool = currentFiltered();
  if (!pool.length) { alert('当前筛选下没有内容。'); return; }
  cram.open = true;
  cram.pool = pool;
  cram.idx = 0;
  cram.shown = {};
  cramEl.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateToTop();
  renderCram();
}
function closeCram() {
  cram.open = false;
  cramEl.classList.remove('open');
  document.body.style.overflow = '';
  updateToTop();
}
document.getElementById('cramBtn').onclick = openCram;
document.getElementById('cramExit').onclick = closeCram;
document.getElementById('cramPrev').onclick = () => cramGo(-1);
document.getElementById('cramNext').onclick = () => cramGo(1);

let cramSX = 0, cramSY = 0;
cramStage.addEventListener('touchstart', e => {
  cramSX = e.touches[0].clientX; cramSY = e.touches[0].clientY;
}, { passive: true });
cramStage.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - cramSX;
  const dy = e.changedTouches[0].clientY - cramSY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) cramGo(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('keydown', e => {
  if (cram.open) {
    if (e.key === 'ArrowRight') cramGo(1);
    else if (e.key === 'ArrowLeft') cramGo(-1);
    else if (e.key === 'Escape') closeCram();
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); revealNext(); }
    return;
  }
  if (e.key === 'Escape' && settingsDrawer.classList.contains('open')) settingsDrawer.classList.remove('open');
});

/* ---------- 设置抽屉 ---------- */
const settingsDrawer = document.getElementById('settingsDrawer');
document.getElementById('settingsBtn').onclick = () => settingsDrawer.classList.add('open');
document.getElementById('settingsClose').onclick = () => settingsDrawer.classList.remove('open');
settingsDrawer.onclick = e => { if (e.target === settingsDrawer) settingsDrawer.classList.remove('open'); };
settingsDrawer.querySelectorAll('.seg button').forEach(btn => {
  btn.onclick = () => {
    const key = btn.closest('.seg').id.slice(3).toLowerCase(); // setCols→cols 等
    settings[key] = btn.dataset[key];
    saveSettings();
    applySettings();
  };
});

window.addEventListener('resize', debounce(applySettings, 120));
if (mqDark.addEventListener) mqDark.addEventListener('change', applySettings);
if (mqMotion.addEventListener) mqMotion.addEventListener('change', applySettings);

/* ===================== AI 识题（可选功能，仅此功能需要联网） =====================
   上传题目图片 → 调用你所选服务商的视觉模型 → 按固定格式返回 → 你核对后导入。
   API Key 仅存本机 localStorage（键 mq_ai）：不写入导出备份，也不进仓库。
   支持三种协议：OpenAI 兼容 / Google Gemini / Anthropic Claude。 */
const K_AI = 'mq_ai';

const AI_PRESETS = [
  { id: 'gemini', name: 'Google Gemini', protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest',
    keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'ark', name: '火山方舟（豆包）', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-pro-260215',
    keyUrl: 'https://console.volcengine.com/ark' },
  { id: 'qwen', name: '阿里百炼（通义千问）', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max',
    keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'zhipu', name: '智谱 GLM', protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash',
    keyUrl: 'https://open.bigmodel.cn/' },
  { id: 'kimi', name: 'Kimi（月之暗面）', protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview',
    keyUrl: 'https://platform.moonshot.cn/' },
  { id: 'openrouter', name: 'OpenRouter（聚合多模型）', protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash',
    keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', name: '自定义（任意 OpenAI 兼容接口）', protocol: 'openai',
    baseUrl: '', model: '', keyUrl: '' },
];

let aiCfg = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(K_AI));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
})();
function saveAiCfg() { try { localStorage.setItem(K_AI, JSON.stringify(aiCfg)); } catch (e) {} }

const aiEl = id => document.getElementById(id);
const aiReady = () => !!(aiCfg.baseUrl && aiCfg.model && aiCfg.key);
const aiPreset = id => AI_PRESETS.find(p => p.id === id) || AI_PRESETS[AI_PRESETS.length - 1];
let aiAbort = null;

aiEl('aiPreset').innerHTML = AI_PRESETS
  .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');

function updateAiHint() {
  const p = aiPreset(aiEl('aiPreset').value);
  aiEl('aiKeyHint').innerHTML = p.keyUrl
    ? `申请 API Key：<a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer">${esc(p.keyUrl)}</a>`
    : '';
}
function fillAiForm() {
  const id = aiCfg.preset || 'gemini';
  aiEl('aiPreset').value = AI_PRESETS.some(p => p.id === id) ? id : 'gemini';
  aiEl('aiProtocol').value = aiCfg.protocol || 'gemini';
  aiEl('aiBase').value = aiCfg.baseUrl || '';
  aiEl('aiModel').value = aiCfg.model || '';
  aiEl('aiKey').value = aiCfg.key || '';
  updateAiHint();
}
function readAiForm() {
  aiCfg = {
    preset: aiEl('aiPreset').value,
    protocol: aiEl('aiProtocol').value,
    baseUrl: aiEl('aiBase').value.trim().replace(/\/+$/, ''),
    model: aiEl('aiModel').value.trim(),
    key: aiEl('aiKey').value.trim(),
  };
  saveAiCfg();
}
function applyAiPreset() {
  const p = aiPreset(aiEl('aiPreset').value);
  if (p.id !== 'custom') {
    aiEl('aiProtocol').value = p.protocol;
    aiEl('aiBase').value = p.baseUrl;
    aiEl('aiModel').value = p.model;
  }
  readAiForm();
  updateAiHint();
  aiEl('aiMsg').textContent = '';
}
aiEl('aiPreset').onchange = applyAiPreset;
aiEl('aiApplyPreset').onclick = applyAiPreset;
['aiProtocol', 'aiBase', 'aiModel', 'aiKey'].forEach(id => {
  aiEl(id).onchange = () => { readAiForm(); aiEl('aiMsg').textContent = ''; };
});

/* ---------- 图片 → base64 ---------- */
function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
// 测试连接用的极小图片（现场生成，避免硬编码二进制）
function aiTinyImage() {
  return new Promise(res => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 16, 16);
    cv.toBlob(b => blobToB64(b).then(res), 'image/jpeg', 0.8);
  });
}

/* ---------- 提示词：分两步（先只转录原文，再解题整理） ---------- */
const aiNoun = () => active === 'q' ? '题目' : '知识点';

// 第一步：只做识别/转录，不解答、不给答案
function aiOcrPrompt() {
  const n = aiNoun();
  return [
    `你是数学${n}识别助手。用户会给你一张图片（拍照或截图）。`,
    `请只把图中的${n}**原文**准确转录出来，不要解答，也不要添加任何解析、答案或说明。`,
    '要求：',
    '1. 只输出原文本身，不要输出【】这类标记，不要标题，不要任何解释；',
    '2. 公式一律使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$；',
    `3. 图中若有多道${n}，它们之间用单独一行 === 分隔；`,
    '4. 若图中没有可识别的内容，就只回答：未识别到内容。',
  ].join('\n');
}

// 第二步：基于用户已核对/修正过的原文，解题并整理成导入格式
function aiSolvePrompt(stem) {
  const d = DEF[active];
  return [
    `下面是用户已经核对确认过的数学${aiNoun()}原文，请据此完成整理。`,
    '',
    '原文：',
    stem,
    '',
    '要求：',
    '1. 严格按下面的格式输出，不要输出任何解释、寒暄或标题；',
    '2. 不要用 ``` 代码块包裹；',
    '3. 公式一律使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$；',
    '4. 上面的原文里若含多项（以 === 分隔），输出的每一项与之一一对应；',
    '5. 不要改动原文的题目内容，只在其基础上补充解答与整理；',
    '6. 【我的错误答案】是留给用户自己填的，请保持为空、不要输出该段内容。',
    '',
    '格式示例：',
    d.importExample,
  ].join('\n');
}

function aiHttpErr(status, data) {
  let m = '';
  if (data) {
    if (typeof data.error === 'string') m = data.error;
    else if (data.error && data.error.message) m = data.error.message;
    else if (typeof data.message === 'string') m = data.message;
  }
  return `请求失败（HTTP ${status}）${m ? '：' + m : ''}`;
}

/* ---------- 发起请求（system=角色设定；ask=本次指令；可选带图） ---------- */
async function aiCall({ system, ask, b64, mime }) {
  readAiForm();
  if (!aiReady()) throw new Error('AI 配置不完整（需要 Base URL、模型名、API Key）。');
  const cfg = aiCfg;
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const hasImg = !!(b64 && mime);
  const ctrl = new AbortController();
  aiAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    if (cfg.protocol === 'gemini') {
      const url = base + '/v1beta/models/' + encodeURIComponent(cfg.model) +
        ':generateContent?key=' + encodeURIComponent(cfg.key);
      const gParts = [{ text: system }, { text: ask }];
      if (hasImg) gParts.push({ inline_data: { mime_type: mime, data: b64 } });
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: gParts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(aiHttpErr(r.status, data));
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map(p => p.text || '').join('').trim();
    }

    if (cfg.protocol === 'anthropic') {
      const aContent = [{ type: 'text', text: ask }];
      if (hasImg) aContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
      const r = await fetch(base + '/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: aContent }],
        }),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(aiHttpErr(r.status, data));
      return (data.content || []).map(c => c.text || '').join('').trim();
    }

    // OpenAI 兼容（多数国内外服务商，包含方舟/百炼/智谱/Kimi/OpenRouter 等）
    const oContent = [{ type: 'text', text: ask }];
    if (hasImg) oContent.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } });
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: oContent },
        ],
      }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(aiHttpErr(r.status, data));
    const msg = ((data.choices || [])[0] || {}).message || {};
    return (Array.isArray(msg.content)
      ? msg.content.map(c => c.text || '').join('')
      : (msg.content || '')).trim();
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const m = (err && err.message) || '';
    // 浏览器的 fetch 在网络/CORS 失败时只会抛 TypeError（Failed to fetch），对用户没有信息量
    if (err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(m)) {
      throw new Error('无法连接到该接口地址。常见原因：网络不通；该服务商不允许浏览器直接调用（CORS 限制）；Base URL 填写有误。');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    aiAbort = null;
  }
}

/* ---------- 识题主流程 ---------- */
function showAiBusy(text) {
  aiEl('aiBusyText').textContent = text || '正在识别…';
  aiEl('aiBusy').classList.add('open');
}
function hideAiBusy() { aiEl('aiBusy').classList.remove('open'); }
aiEl('aiCancel').onclick = () => { if (aiAbort) aiAbort.abort(); };

/* 第一步：只识别原文，弹出核对框；第二步：用户确认后才解题 */
const aiCheckModal = aiEl('aiCheckModal');
let aiSourceBlob = null, aiSourceUrl = null;

function closeAiCheck() {
  aiCheckModal.classList.remove('open');
  if (aiSourceUrl) { URL.revokeObjectURL(aiSourceUrl); aiSourceUrl = null; }
}
aiEl('aiCheckCancel').onclick = closeAiCheck;
aiEl('aiRePick').onclick = () => { closeAiCheck(); aiEl('aiImgInput').click(); };
aiCheckModal.onclick = e => { if (e.target === aiCheckModal) closeAiCheck(); };

async function aiExtractFromFile(file) {
  if (!aiReady()) {
    settingsDrawer.classList.add('open');
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里选择服务商，填入 API Key 与模型名后再试。');
    return;
  }
  showAiBusy('正在压缩图片…');
  try {
    const blob = await compressImage(file, 1280, 0.8) || file;
    const mime = blob.type || 'image/jpeg';
    const b64 = await blobToB64(blob);
    if (!b64) throw new Error('图片读取失败。');
    aiSourceBlob = blob;

    showAiBusy(`正在识别${aiNoun()}，请稍候…`);
    const text = await aiCall({
      system: aiOcrPrompt(),
      ask: '请把这张图片里的内容按上述要求转录出来，不要解答。',
      b64, mime,
    });
    hideAiBusy();
    if (!text) throw new Error('模型没有返回任何内容。');

    // 弹出核对框，让用户先确认/修正原文
    aiEl('aiCheckTitle').textContent = `第 1 步 · 核对识别出的${aiNoun()}`;
    aiEl('aiCheckHint').innerHTML =
      `下面是 AI 从图片里识别出的${aiNoun()}原文。<b>请核对并直接修正</b>（公式、正负号、上下标最容易出错），` +
      `确认无误后点「${active === 'q' ? '开始解题' : '开始整理'}」，AI 才会继续作答。`;
    aiEl('aiCheckText').value = text;
    aiEl('aiCheckMsg').textContent = '';
    if (aiSourceUrl) URL.revokeObjectURL(aiSourceUrl);
    aiSourceUrl = URL.createObjectURL(blob);
    aiEl('aiCheckImg').src = aiSourceUrl;
    aiEl('aiCheckImgBox').style.display = 'block';
    aiCheckModal.classList.add('open');
    aiEl('aiCheckText').focus();
  } catch (e) {
    hideAiBusy();
    if (e && e.name === 'AbortError') { alert('已取消。'); return; }
    alert('识别失败：' + ((e && e.message) || e) +
      '\n\n常见原因：\n· Base URL / 模型名 / API Key 填写有误\n· 该服务商不允许浏览器直接调用（CORS 限制）\n· 网络不通或请求超时');
  }
}

async function aiSolve() {
  const stem = aiEl('aiCheckText').value.trim();
  if (!stem) { aiEl('aiCheckMsg').textContent = '内容为空，请先填写，或点「重选图片」。'; return; }
  aiEl('aiCheckGo').disabled = true;
  showAiBusy(active === 'q' ? 'AI 正在解题，请稍候…' : 'AI 正在整理，请稍候…');
  try {
    const text = await aiCall({
      system: aiSolvePrompt(stem),
      ask: '请按上述格式输出整理结果。',
    });
    if (!text) throw new Error('模型没有返回任何内容。');

    hideAiBusy();
    closeAiCheck();

    // 打开「新增 / 导入」面板并预填整理结果
    document.getElementById('addBtn').click();
    document.getElementById('addTitle').textContent =
      active === 'q' ? 'AI 解题结果 · 请核对后导入' : 'AI 整理结果 · 请核对后导入';
    document.getElementById('addHint').innerHTML =
      `已基于你核对过的${aiNoun()}原文生成（模型：<b>${esc(aiCfg.model)}</b>）。<b>请核对</b>公式与答案后，再点「导入选中项」。`;
    document.getElementById('rawInput').value = text;
    document.getElementById('parseBtn').click();

    // 只整理出 1 项时，把原题图片自动挂为配图
    if (pending.length === 1 && aiSourceBlob) {
      const id = 'img_' + uid();
      await idbPut({ id, blob: aiSourceBlob, type: aiSourceBlob.type || 'image/jpeg', size: aiSourceBlob.size || 0, addedAt: Date.now() });
      pendingImgs = pendingImgs.concat(id);
      addImgRow.style.display = 'block';
      renderPendingThumbs();
      document.getElementById('addImgMsg').textContent = '已自动附上原题图片';
    } else if (pending.length > 1) {
      document.getElementById('parseMsg').textContent += ' 识别到多项：可先整批导入，再逐条「编辑」补配图。';
    }
  } catch (e) {
    hideAiBusy();
    if (e && e.name === 'AbortError') { aiEl('aiCheckMsg').textContent = '已取消'; return; }
    aiEl('aiCheckMsg').textContent = '失败：' + ((e && e.message) || e);
  } finally {
    aiEl('aiCheckGo').disabled = false;
  }
}
aiEl('aiCheckGo').onclick = aiSolve;

aiEl('aiBtn').onclick = () => {
  if (!aiReady()) {
    settingsDrawer.classList.add('open');
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里选择服务商，填入 API Key 与模型名。');
    return;
  }
  aiEl('aiImgInput').click();
};
aiEl('aiImgInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) aiExtractFromFile(f);
};

aiEl('aiTest').onclick = async () => {
  const msg = aiEl('aiMsg');
  readAiForm();
  if (!aiReady()) { msg.textContent = '请先填写 Base URL / 模型名 / API Key'; return; }
  msg.textContent = '测试中…';
  showAiBusy('正在测试连接…');
  try {
    const b64 = await aiTinyImage();
    const t = await aiCall({
      system: aiOcrPrompt(),
      ask: '请把这张图片里的内容按上述要求转录出来，不要解答。',
      b64, mime: 'image/jpeg',
    });
    hideAiBusy();
    msg.textContent = t ? '连接成功 ✓' : '连上了，但模型没有返回内容';
  } catch (e) {
    hideAiBusy();
    msg.textContent = (e && e.name === 'AbortError') ? '已取消' : '失败：' + ((e && e.message) || e);
  }
};

/* ---------- 初始化 ---------- */
async function boot() {
  await loadInitial();
  applySettings();
  fillAiForm();
  purgeTrash();
  await gcImages(); // 清理历史遗留的孤儿图片
  updateTrashCount();
  updateBackupBar();
  refreshTagPicker();
  render();
}
boot();
