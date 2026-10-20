/* =========================================================
   数学复习本 · app.js
   两个视图：q=错题 / k=知识点，数据分开存，共用一套标签
   ========================================================= */

/* ===================== storage ===================== */
const K_Q = 'mq_items';
const K_K = 'mq_kps';
const K_P = 'mq_papers';
const K_C_Q = 'mq_collections_q';   // 错题库的合集树
const K_C_K = 'mq_collections_k';   // 知识点库的合集树
const K_SEED = 'mq_seed_papers_v1';   // 内置真题只灌一次，之后不管你删不删都不再自动补

/* 纯逻辑统一放在 lib.js（浏览器与单测共用），此处引用即可 */
const {
  STATUS, STATUS_NEXT, uid, normText,
  makeGramProfile, simFromProfile,
  parseText, parseSearch,
  normalizeQuestion, normalizeKp, scheduleSrs, isDue, dueLabel, DAY,
  normalizePaper, parsePaper, paperWrongToQuestion, mergeSeedPapers,
  nextUnmarked, paperProgress,
  sortItems, materializeOrder, reorderItems,
  settleCollections, collectionSubtreeIds, flattenCollections, collectionChildren,
  collectionPath, addCollection, renameCollection, canMoveCollection, moveCollection,
  deleteCollection, collectionCounts, sanitizeItemCollections,
  parseAiJson, normTag, mergeSuggestTags, resolveCollectionPath, applyOrganizePlan,
  clusterBySimilarity, groupStats,
  bareMathSegments,
} = MQ;

/* ===================== 设置（偏好，与数据分开存） ===================== */
const K_SET = 'mq_settings';
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on', rail: 'off', sortMode: { q: 'auto', k: 'auto' } };

function readSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(K_SET));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
const settings = Object.assign({}, SET_DEF, readSettings());
// sortMode 是嵌套对象，浅合并会整体覆盖，这里单独补全两库默认值
settings.sortMode = Object.assign({ q: 'auto', k: 'auto' }, settings.sortMode);

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

  const sm = (settings.sortMode && settings.sortMode[active]) || 'auto';
  document.querySelectorAll('#setSort button').forEach(b => b.classList.toggle('on', b.dataset.sort === sm));
  const sortLib = document.getElementById('sortLibName');
  if (sortLib) sortLib.textContent = active === 'p' ? '试卷（不适用）' : (active === 'k' ? '知识点' : '错题');
  document.querySelectorAll('#setRail button').forEach(b => b.classList.toggle('on', b.dataset.rail === settings.rail));

  // 宽屏且已「收起」→ 侧栏切成窄竖条；窄屏（<1024）始终是抽屉，不加该类
  if (colTreeEl) {
    colTreeEl.classList.toggle('rail', settings.rail === 'on' && window.innerWidth >= 1024);
    renderColTree();
  }

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
// 仍被引用（含回收站、试卷题目）的图片 id 集合，用于清理孤儿图片
function referencedImageIds() {
  const s = new Set();
  const add = list => list.forEach(it => (it.images || []).forEach(id => s.add(id)));
  add(stores.q.items); add(stores.k.items); add(trash.map(t => t.item));
  (stores.p.items || []).forEach(p => add(p.questions || []));
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
  p: { key: K_P, norm: normalizePaper, items: [] },
};

/* 合集树：错题、知识点各一棵（试卷视图不使用） */
const colStores = { q: [], k: [] };
const colKey = kind => kind === 'k' ? K_C_K : K_C_Q;
const saveCols = kind => persist(colKey(kind), colStores[kind]);
// 合集树/未分类在侧栏里作为「虚拟节点」的筛选值
const COL_ALL = '__all__';

// 启动时从 IndexedDB 载入（并把旧版 localStorage 数据迁移过来）
async function loadInitial() {
  for (const kind of ['q', 'k', 'p']) {
    const key = stores[kind].key;
    let raw = await kvGet(key);
    if (!Array.isArray(raw)) raw = lsRead(key);
    stores[kind].items = Array.isArray(raw)
      ? raw.map(stores[kind].norm)
      : (kind === 'q' ? seedQuestions() : (kind === 'k' ? seedKps() : [])).map(stores[kind].norm);
    await persist(key, stores[kind].items);
  }
  // 合集树（两库各一棵）
  for (const kind of ['q', 'k']) {
    const key = colKey(kind);
    let raw = await kvGet(key);
    if (!Array.isArray(raw)) raw = lsRead(key);
    colStores[kind] = settleCollections(Array.isArray(raw) ? raw : []);
    await persist(key, colStores[kind]);
    // 把指向已不存在合集的条目纠正为「未分类」，保证筛选与计数口径一致
    if (sanitizeItemCollections(stores[kind].items, colStores[kind])) await persist(stores[kind].key, stores[kind].items);
  }
  let t = await kvGet(K_TRASH);
  if (!Array.isArray(t)) t = lsRead(K_TRASH);
  trash = Array.isArray(t) ? t : [];
  await seedBuiltinPapers();
}

// 首次启动灌入内置数一真题（只灌一次；你删掉后不再自动补回，也不会覆盖你新建的试卷）
async function seedBuiltinPapers() {
  try { if (localStorage.getItem(K_SEED)) return; } catch (e) { return; }
  try {
    const res = await fetch('papers-data.json', { cache: 'no-store' });
    if (!res || !res.ok) return;          // 拿不到（离线/不存在）就下次再说，不写标记
    const seeds = await res.json();
    const add = mergeSeedPapers(stores.p.items, seeds);
    if (add.length) {
      stores.p.items = stores.p.items.concat(add);
      await persist(K_P, stores.p.items);
    }
    try { localStorage.setItem(K_SEED, '1'); } catch (e) {}
  } catch (e) {}
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
    importExample: [
      '【题目】',
      '求函数 $f(x)=x^2-2x+1$ 的最小值。',
      '【解析】',
      '第 1 步：看二次项系数。$a=1>0$，抛物线开口向上，所以最小值在顶点处取得。',
      '第 2 步：求对称轴。代入对称轴公式 $x=-\\frac{b}{2a}$，得 $$x=-\\frac{-2}{2\\times 1}=1$$',
      '第 3 步：配方验证。$x^2-2x+1$ 本身是完全平方式：$$x^2-2x+1=(x-1)^2$$',
      '第 4 步：读出顶点。对照顶点式 $y=a(x-h)^2+k$，得 $h=1$、$k=0$，顶点为 $(1,0)$。',
      '第 5 步：下结论。开口向上时最小值就是顶点的纵坐标，故最小值为 $0$，在 $x=1$ 处取得。',
      '【知识点】',
      '二次函数顶点式 $y=a(x-h)^2+k$：顶点为 $(h,k)$；$a>0$ 时开口向上、有最小值 $k$，$a<0$ 时开口向下、有最大值 $k$。',
      '【我的错误答案】',
      '（选填：我当时是怎么错的）',
      '【标签】',
      '二次函数, 最值',
      '',
      '多题之间用单独一行 === 分隔',
    ].join('\n'),
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
    importExample: [
      '【知识点】',
      '二次函数顶点式',
      '【讲解】',
      '第 1 步：定义。把二次函数写成 $y=a(x-h)^2+k$（$a\\ne 0$）的形式叫顶点式，顶点坐标是 $(h,k)$、对称轴是 $x=h$。',
      '第 2 步：为什么成立。因为 $(x-h)^2\\ge 0$ 恒成立，所以 $a>0$ 时 $y\\ge k$、$a<0$ 时 $y\\le k$，最值可以直接从式子里读出来。',
      '第 3 步：怎么用。把一般式 $y=ax^2+bx+c$ 配方：$$y=a\\left(x+\\frac{b}{2a}\\right)^2+\\frac{4ac-b^2}{4a}$$ 由此得 $h=-\\frac{b}{2a}$、$k=\\frac{4ac-b^2}{4a}$。',
      '第 4 步：易错点。配方要先提出二次项系数 $a$ 再配平方，别在提出 $a$ 之前直接对 $bx$ 配；$a$ 的符号决定最值是最大还是最小。',
      '【标签】',
      '函数, 二次函数',
      '',
      '多个知识点之间用单独一行 === 分隔',
    ].join('\n'),
    main: it => `<div class="stem"><span class="kp-badge">知识点</span>${renderMath(it.title)}</div>`,
    details: it => [{ label: '查看讲解', text: it.content }],
    hay: it => [it.title, it.content, it.tags.join(' ')].join(' '),
    previewMain: o => o.title || '（无名称）',
    previewInfo: o => `讲解 ${o.content ? '✓' : '✗'} · 标签 ${o.tags.length}`,
  },
  p: { noun: '张试卷', addLabel: '+ 新增试卷', randomLabel: '随机一题' },
};

const PAGE = 30;
const views = {
  q: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false, collectionFilter: COL_ALL },
  k: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false, collectionFilter: COL_ALL },
  p: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false },
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

// 依次识别：$$...$$ / \[...\] 行间公式，$...$ / \(...\) 行内公式，
// 以及没有任何定界符的裸 LaTeX（如部分 AI 直接输出 y'' = \frac{dp}{dx} …）。
function renderMath(text) {
  if (!text) return '';
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g);
  return parts.map(p => {
    let m;
    if ((m = p.match(/^\$\$([\s\S]+?)\$\$$/)) || (m = p.match(/^\\\[([\s\S]+?)\\\]$/))) {
      try { return katex.renderToString(m[1], { displayMode: true, throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    if ((m = p.match(/^\$([^$]+?)\$$/)) || (m = p.match(/^\\\(([\s\S]+?)\\\)$/))) {
      try { return katex.renderToString(m[1], { throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    return renderBareMath(p);
  }).join('');
}

// 无定界符文本：切出裸 LaTeX 片段后渲染，其余按普通文本处理（保留换行）
function renderBareMath(text) {
  return bareMathSegments(text).map(seg => {
    if (seg.t === 'text') return esc(seg.v).replace(/\n/g, '<br>');
    try { return katex.renderToString(seg.v, { displayMode: !!seg.display, throwOnError: false }); }
    catch (e) { return esc(seg.v); }
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
  // 合集筛选：null = 未分类；其余 = 该合集及其子合集；COL_ALL = 不过滤
  const cf = v.collectionFilter;
  const subIds = (cf && cf !== COL_ALL) ? collectionSubtreeIds(colStores[active] || [], cf) : null;
  const out = curItems().filter(it => {
    if (cf !== COL_ALL) {
      if (cf == null) { if (it.collectionId) return false; }
      else if (!it.collectionId || !subIds.has(it.collectionId)) return false;
    }
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
  // 按当前库的排序模式：自动=创建时间倒序（新增的排最前）；手动=order（新条目 order=null 排最前）
  return sortItems(out, (settings.sortMode && settings.sortMode[active]) || 'auto');
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
  const canDrag = dragAllowed();
  const card = document.createElement('div');
  card.className = 'card' + (canDrag ? ' has-drag' : '');
  card.dataset.id = it.id;
  const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const rc = relatedCount(it); // 只计算一次
  const rel = rc
    ? `<span class="relchip" data-rel="1">相关${active === 'k' ? '错题' : '知识点'} ${rc} ${active === 'k' ? '道' : '个'}</span>` : '';
  const due = `<span class="duechip${isDue(it) ? ' due' : ''}" data-due="1" title="点击标记为「复习中」">🕒 ${dueLabel(it)}</span>`;
  const src = it.fromPaper
    ? `<span class="relchip" data-frompaper="1" title="来自试卷，点击查看原卷">来自试卷</span>` : '';
  const col = it.collectionId ? collectionById(active, it.collectionId) : null;
  const colChip = col
    ? `<span class="colchip" data-col="${esc(col.id)}" title="所属合集，点击只看这个合集">📁 ${esc(col.name)}</span>` : '';
  // 「我的错误答案」为空时不显示该折叠区，避免噪音
  const dets = d.details(it).filter(x => x.label !== '查看我的错误答案' || x.text);
  card.innerHTML = `
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${canDrag ? `<button type="button" class="drag-handle" data-act="drag" title="按住拖拽调整顺序" aria-label="拖拽排序">⠿</button>` : ''}
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <button class="star ${it.star ? 'on' : ''}" data-act="star" title="${it.star ? '取消收藏' : '收藏'}">${it.star ? '★' : '☆'}</button>
      ${tags}${rel}${src}${colChip}
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
  const srcEl = card.querySelector('[data-frompaper]');
  if (srcEl) srcEl.onclick = () => {
    if (it.fromPaper && paperOf(it.fromPaper.paperId)) openPaper(it.fromPaper.paperId);
    else alert('原试卷已删除。');
  };
  const colEl = card.querySelector('[data-col]');
  if (colEl) colEl.onclick = () => {
    v.collectionFilter = colEl.dataset.col;
    closeColDrawerIfNarrow();
    applyFilters();
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

  if (canDrag) {
    const handle = card.querySelector('[data-act="drag"]');
    if (handle) bindDragHandle(handle);
  }

  return card;
}

/* ===================== 试卷：全屏试卷页（打开后）===================== */

let pqEditing = null;   // { paperId, questionId } —— 单题编辑弹层（编辑页）用

// 试卷页状态（打开后）：判分/重做、专注、仅看错题、答案显隐、当前题
const paperState = {
  paperId: null,
  mode: 'grade',        // 'grade' 判分 | 'redo' 重做
  focus: false,         // 专注模式（一题一屏）
  wrongOnly: false,     // 仅看错题
  showAnswers: false,   // 重做模式下整卷显示答案
  revealed: new Set(),  // 重做模式下逐题手动揭示过的题 id
  curId: null,          // 当前题 id（导航高亮 / 专注当前题）
};

function paperOf(id) { return stores.p.items.find(p => p.id === id); }
function curPaper() { return paperOf(paperState.paperId); }

function addPaperWrongToBook() {
  const p = curPaper();
  if (!p) return;
  // 已在本子里（按 fromPaper 判重）的题目 id
  const inBook = new Set(
    stores.q.items
      .filter(it => it.fromPaper && it.fromPaper.paperId === p.id)
      .map(it => it.fromPaper.questionId)
  );
  const raws = paperWrongToQuestion(p, Date.now()).filter(raw => !inBook.has(raw.fromPaper.questionId));
  if (!raws.length) { alert('没有可加入的题（未标错题，或都已在错题本）。'); return; }
  const added = raws.map(raw => normalizeQuestion(raw));
  duplicatePaperImages(added).then(() => {
    added.forEach(it => stores.q.items.push(it));
    // 回写 linkedQid，标记这些题已在错题本
    added.forEach(it => {
      const q = p.questions.find(x => x.id === it.fromPaper.questionId);
      if (q) q.linkedQid = it.id;
    });
    p.updatedAt = Date.now();
    saveStore(K_Q, stores.q.items);
    savePapers();
    refreshTagPicker();
    renderPaperView();
    alert(`已加入错题本 ${added.length} 道（解析留空，可在错题本里用「复制提示词」让 AI 补解析）。`);
  });
}

// 试卷题目若带配图，复制一份给错题条目：避免「删其一影响另一个」的共享引用
async function duplicatePaperImages(items) {
  for (const it of items) {
    if (!it.images || !it.images.length) continue;
    const copies = [];
    for (const id of it.images) {
      try {
        const rec = await idbGet(id);
        if (!rec || !rec.blob) continue;
        const nid = 'img_' + uid();
        await idbPut({ id: nid, blob: rec.blob, type: rec.type || 'image/jpeg', size: rec.blob.size || 0, addedAt: Date.now() });
        copies.push(nid);
      } catch (e) { /* 单张复制失败则忽略，宁可少一张也不留下悬空引用 */ }
    }
    it.images = copies;
  }
}

function openPaper(id) {
  paperState.paperId = id;
  paperState.mode = 'grade';       // 默认判分模式
  paperState.focus = false;
  paperState.wrongOnly = false;
  paperState.showAnswers = false;
  paperState.revealed = new Set();
  paperState.curId = null;
  renderPaperView();
  document.getElementById('paperView').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePaperView() {
  document.getElementById('paperView').classList.remove('open');
  document.body.style.overflow = '';
  paperState.paperId = null;
  renderPapers();      // 刷新卡片「错 n」统计
}

let paperToastTimer = null;
function paperToast(msg) {
  const view = document.getElementById('paperView');
  let el = document.getElementById('paperToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'paperToast';
    el.className = 'paper-toast';
    view.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(paperToastTimer);
  paperToastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// 当前可见题目（应用「仅看错题」）
function paperVisibleQuestions(p) {
  return p.questions.filter(q => !paperState.wrongOnly || q.wrong === 'wrong');
}
// 答案是否对某题可见：判分模式始终可见；重做模式需整卷开或该题已揭示
function paperAnswerVisible(q) {
  return paperState.mode === 'grade' || paperState.showAnswers || paperState.revealed.has(q.id);
}
// 更新某题三态（沿用 papers 数据结构，只改 wrong 字段）
function setPaperQ(qid, patch) {
  const p = curPaper();
  const q = p && p.questions.find(x => x.id === qid);
  if (!q) return;
  Object.assign(q, patch);
  p.updatedAt = Date.now();
  savePapers();
}

// 整块渲染：工具栏状态 → 题号导航条 → 题目区 → 底栏
function renderPaperView() {
  const p = curPaper();
  if (!p) { closePaperView(); return; }
  const bodyEl = document.querySelector('.paperview-body');
  const keepTop = bodyEl ? bodyEl.scrollTop : 0;

  document.getElementById('paperViewTitle').textContent = p.title;
  document.getElementById('paperModeSec').querySelectorAll('button')
    .forEach(b => b.classList.toggle('on', b.dataset.mode === paperState.mode));
  document.getElementById('paperWrongOnlyBtn').classList.toggle('on', paperState.wrongOnly);
  const ansBtn = document.getElementById('paperAnsBtn');
  ansBtn.disabled = paperState.mode === 'grade';
  ansBtn.classList.toggle('on', paperState.showAnswers);
  ansBtn.textContent = paperState.showAnswers ? '隐藏答案' : '显示答案';

  const qs = paperVisibleQuestions(p);
  if (!qs.some(q => q.id === paperState.curId)) paperState.curId = qs.length ? qs[0].id : null;

  renderPaperNav(p, qs);

  const qsEl = document.getElementById('paperQs');
  const focusEl = document.getElementById('paperFocus');
  const footEl = document.getElementById('paperFoot');
  if (paperState.focus) {
    qsEl.style.display = 'none'; focusEl.style.display = '';
    renderPaperFocus(p, qs, focusEl);
    footEl.innerHTML = '<button id="paperPrev">‹ 上一题</button><button id="paperNext">下一题 ›</button>';
    footEl.querySelector('#paperPrev').onclick = () => paperStep(-1);
    footEl.querySelector('#paperNext').onclick = () => paperStep(1);
  } else {
    qsEl.style.display = ''; focusEl.style.display = 'none';
    renderPaperList(p, qs, qsEl);
    footEl.innerHTML = '<span class="spacer"></span><button class="primary" id="paperNextUnmarked">跳到下一道未标</button>';
    footEl.querySelector('#paperNextUnmarked').onclick = jumpToNextUnmarked;
  }

  const body2 = document.querySelector('.paperview-body');
  if (body2) body2.scrollTop = keepTop;
  hydrateImages(qsEl);
  hydrateImages(focusEl);
}

// 右侧/顶部题号导航条：进度 + 每题的 对/错/未标 颜色方块 + 当前高亮
function renderPaperNav(p, qs) {
  const pr = paperProgress(p.questions);
  const nav = document.getElementById('paperNav');
  nav.innerHTML = `
    <div class="paper-nav-head">
      <span class="section-label">已标 ${pr.marked} / 共 ${pr.total}</span>
      <span class="badge-note">错 ${pr.wrong}</span>
    </div>
    <div class="paper-nav-grid">
      ${qs.map(q => `<button class="paper-nav-sq ${q.wrong}${q.id === paperState.curId ? ' cur' : ''}" data-qid="${q.id}" title="第 ${q.no} 题">${q.no}</button>`).join('')}
    </div>`;
  nav.querySelectorAll('.paper-nav-sq').forEach(btn => {
    btn.onclick = () => goToPaperQuestion(btn.dataset.qid);
  });
}

// 一览整卷：每题显眼的三态切换 + 答案（按模式显隐）
function renderPaperList(p, qs, host) {
  if (!qs.length) { host.innerHTML = '<div class="empty">没有可显示的题。</div>'; return; }
  host.innerHTML = qs.map(q => `
    <div class="paper-q" data-qid="${q.id}">
      <div class="paper-q-head">
        <span class="section-label">第 ${q.no} 题</span>
        ${q.linkedQid ? '<span class="badge-note">已在错题本</span>' : ''}
      </div>
      <div class="paper-q-stem">${renderMath(q.stem) || '（无题干）'}</div>
      ${imgStrip(q)}
      ${paperRenderAnswer(q)}
      <div class="paper-q-acts">
        <div class="paper-tri" data-qid="${q.id}">
          <button data-wrong="right" class="${q.wrong === 'right' ? 'on right' : ''}">对</button>
          <button data-wrong="wrong" class="${q.wrong === 'wrong' ? 'on wrong' : ''}">错</button>
          <button data-wrong="unset" class="${q.wrong === 'unset' ? 'on unset' : ''}">未标</button>
        </div>
      </div>
    </div>`).join('');
  host.querySelectorAll('.paper-tri').forEach(tri => {
    tri.querySelectorAll('button').forEach(b => {
      b.onclick = () => markPaperQuestion(tri.dataset.qid, b.dataset.wrong);
    });
  });
  host.querySelectorAll('.paper-reveal').forEach(b => {
    b.onclick = () => { paperState.revealed.add(b.dataset.reveal); renderPaperView(); };
  });
}

// 单题答案块：可见则渲染；重做模式未揭示则给「显示答案」按钮
function paperRenderAnswer(q) {
  if (!q.answer) return '';
  if (paperAnswerVisible(q)) {
    return `<div class="paper-q-answer"><span class="section-label">答案</span><div class="body">${renderMath(q.answer)}</div></div>`;
  }
  return `<button class="paper-reveal" data-reveal="${q.id}">👁 显示答案</button>`;
}

// 专注模式（一题一屏）：顶部进度条 + 题干/答案 + 大按钮「做对/做错」
function renderPaperFocus(p, qs, host) {
  const q = qs.find(x => x.id === paperState.curId) || qs[0];
  if (!q) { host.innerHTML = '<div class="empty">没有可显示的题。</div>'; return; }
  const idx = qs.findIndex(x => x.id === q.id);
  const pct = qs.length ? Math.round(((idx + 1) / qs.length) * 100) : 0;
  host.innerHTML = `
    <div class="paper-focus-progress"><div class="paper-focus-bar" style="width:${pct}%"></div></div>
    <div class="paper-focus-card">
      <div class="paper-focus-head">
        <span class="section-label">第 ${q.no} 题</span>
        <span class="spacer"></span>
        <span class="section-label">${idx + 1} / ${qs.length}</span>
      </div>
      <div class="paper-q-stem">${renderMath(q.stem) || '（无题干）'}</div>
      ${imgStrip(q)}
      ${paperRenderAnswer(q)}
      <div class="paper-focus-acts">
        <button class="paper-big right ${q.wrong === 'right' ? 'on' : ''}" data-wrong="right">做对</button>
        <button class="paper-big wrong ${q.wrong === 'wrong' ? 'on' : ''}" data-wrong="wrong">做错</button>
      </div>
    </div>`;
  host.querySelectorAll('.paper-big').forEach(b => {
    b.onclick = () => markPaperQuestion(q.id, b.dataset.wrong);
  });
  host.querySelectorAll('.paper-reveal').forEach(b => {
    b.onclick = () => { paperState.revealed.add(b.dataset.reveal); renderPaperView(); };
  });
}

/* ===================== 试卷编辑页（独立入口，可改题）===================== */
const paperEditState = { paperId: null };

function openPaperEdit(id) {
  paperEditState.paperId = id;
  renderPaperEdit();
  document.getElementById('paperEdit').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closePaperEdit() {
  document.getElementById('paperEdit').classList.remove('open');
  document.body.style.overflow = '';
  paperEditState.paperId = null;
  renderPapers();       // 刷新卡片标题/错数统计
}

function renderPaperEdit() {
  const p = paperOf(paperEditState.paperId);
  if (!p) { closePaperEdit(); return; }
  const host = document.getElementById('paperEditBody');
  host.innerHTML = `
    <div class="paperedit-head">
      <input id="paperEditTitle" value="${esc(p.title)}" placeholder="试卷名">
      <input id="paperEditDate" type="date" value="${esc(p.date)}">
    </div>
    <div class="paperedit-qs">
      ${p.questions.map(q => `
        <div class="paperedit-q" data-qid="${q.id}">
          <div class="paper-q-head">
            <span class="section-label">第 ${q.no} 题</span>
            <span class="spacer"></span>
            <button class="link" data-act="editq" data-qid="${q.id}">编辑</button>
            <button class="link" data-act="delq" data-qid="${q.id}">删除</button>
          </div>
          <div class="paper-q-stem">${renderMath(q.stem) || '（无题干）'}</div>
          ${imgStrip(q)}
          ${q.answer ? `<div class="body">${renderMath(q.answer)}</div>` : ''}
        </div>`).join('') || '<div class="empty">这张试卷还没有题目。</div>'}
    </div>`;
  hydrateImages(host);
  document.getElementById('paperEditTitle').onchange = e => {
    p.title = e.target.value.trim() || '未命名试卷';
    p.updatedAt = Date.now();
    savePapers();
  };
  document.getElementById('paperEditDate').onchange = e => {
    p.date = e.target.value;
    p.updatedAt = Date.now();
    savePapers();
  };
  host.querySelectorAll('[data-act="editq"]').forEach(b => {
    b.onclick = () => openPaperQ(paperEditState.paperId, b.dataset.qid);
  });
  host.querySelectorAll('[data-act="delq"]').forEach(b => {
    b.onclick = () => {
      if (!confirm('删除这道题？（若已加入错题本，错题条目会保留）')) return;
      p.questions = p.questions.filter(x => x.id !== b.dataset.qid);
      p.updatedAt = Date.now();
      savePapers();
      renderPaperEdit();
    };
  });
}

document.getElementById('paperEditBack').onclick = closePaperEdit;

function markPaperQuestion(qid, wrong) {
  setPaperQ(qid, { wrong });
  renderPaperView();
}

// 点击题号方块 → 更新高亮并滚动定位（专注模式在 Task 6 处理）
function goToPaperQuestion(qid) {
  paperState.curId = qid;
  const p = curPaper();
  if (!p) return;
  if (paperState.focus) { renderPaperView(); return; }
  renderPaperNav(p, paperVisibleQuestions(p));
  const el = document.getElementById('paperQs').querySelector(`.paper-q[data-qid="${qid}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// 上/下一题：列表模式滚动定位，专注模式切换题（专注分支在 Task 6 补齐）
function paperStep(delta) {
  const p = curPaper();
  if (!p) return;
  const qs = paperVisibleQuestions(p);
  if (!qs.length) return;
  let i = qs.findIndex(q => q.id === paperState.curId);
  if (i < 0) i = 0;
  const ni = Math.max(0, Math.min(qs.length - 1, i + delta));
  paperState.curId = qs[ni].id;
  if (paperState.focus) renderPaperView();
  else goToPaperQuestion(paperState.curId);
}

// 底部「跳到下一道未标」：从当前题之后找，回绕；找不到则提示
function jumpToNextUnmarked() {
  const p = curPaper();
  if (!p) return;
  const next = nextUnmarked(p.questions, paperState.curId);
  if (!next) { paperToast('已无未标'); return; }
  if (paperState.wrongOnly) paperState.wrongOnly = false;   // 目标题未标，先取消「仅看错题」以便可见
  paperState.curId = next.id;
  renderPaperView();
  const el = document.getElementById('paperQs').querySelector(`.paper-q[data-qid="${next.id}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function isPaperViewOpen() {
  return document.getElementById('paperView').classList.contains('open');
}
// 试卷页快捷键：仅当焦点不在 input/textarea/select 时生效
function handlePaperKey(e) {
  const t = e.target;
  const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (e.key === '1') { if (paperState.curId) markPaperQuestion(paperState.curId, 'right'); e.preventDefault(); return true; }
  if (e.key === '2') { if (paperState.curId) markPaperQuestion(paperState.curId, 'wrong'); e.preventDefault(); return true; }
  if (e.key === '0') { if (paperState.curId) markPaperQuestion(paperState.curId, 'unset'); e.preventDefault(); return true; }
  if (e.key === 'ArrowUp' || e.key === 'p' || e.key === 'P') { paperStep(-1); e.preventDefault(); return true; }
  if (e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') { paperStep(1); e.preventDefault(); return true; }
  if (e.key === 'Escape') { closePaperView(); return true; }
  return false;
}

document.getElementById('paperBack').onclick = closePaperView;
document.getElementById('paperFocusBtn').onclick = () => { paperState.focus = !paperState.focus; renderPaperView(); };
document.getElementById('paperWrongOnlyBtn').onclick = () => { paperState.wrongOnly = !paperState.wrongOnly; renderPaperView(); };
document.getElementById('paperAnsBtn').onclick = () => {
  paperState.showAnswers = !paperState.showAnswers;
  if (!paperState.showAnswers) paperState.revealed = new Set();   // 隐藏时把逐题揭示也复位
  renderPaperView();
};
document.getElementById('paperToWrongBtn').onclick = addPaperWrongToBook;
document.getElementById('paperModeSec').querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    paperState.mode = b.dataset.mode;
    paperState.showAnswers = false;
    paperState.revealed = new Set();
    renderPaperView();
  };
});


/* 题目编辑小弹层：仅供编辑页调用 */
let pqImgs = [];        // 配图草稿
let pqOrig = null;      // 打开弹层时的原始配图集合
function openPaperQ(paperId, qid) {
  const p = paperOf(paperId);
  const q = p && p.questions.find(x => x.id === qid);
  if (!q) return;
  pqEditing = { paperId, questionId: qid };
  document.getElementById('pqNo').value = q.no;
  document.getElementById('pqStem').value = q.stem;
  document.getElementById('pqAnswer').value = q.answer;
  // 配图走草稿：弹层里的增删只改草稿，保存才落盘，取消则丢弃本次新增
  pqOrig = new Set(q.images || []);
  pqImgs = (q.images || []).slice();
  document.getElementById('pqImgMsg').textContent = '';
  renderPqThumbs();
  document.getElementById('paperQModal').classList.add('open');
}
function renderPqThumbs() {
  renderThumbs(document.getElementById('pqThumbs'), pqImgs, id => {
    pqImgs = pqImgs.filter(x => x !== id);
    renderPqThumbs();
  });
}
document.getElementById('pqImgBtn').onclick = () => document.getElementById('pqImgInput').click();
document.getElementById('pqImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !pqOrig) return;
  const holder = { images: [] };
  const n = await attachImages(holder, files);
  pqImgs = pqImgs.concat(holder.images);
  document.getElementById('pqImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderPqThumbs();
};
function closePaperQ() {
  if (pqOrig) pqImgs.filter(id => !pqOrig.has(id)).forEach(dropImage);  // 丢弃未保存的新增图片
  pqImgs = []; pqOrig = null; pqEditing = null;
  document.getElementById('paperQModal').classList.remove('open');
}
document.getElementById('pqCancel').onclick = closePaperQ;
document.getElementById('pqSave').onclick = () => {
  if (pqEditing) {
    const p = paperOf(pqEditing.paperId);
    const q = p && p.questions.find(x => x.id === pqEditing.questionId);
    if (q) {
      const no = parseInt(document.getElementById('pqNo').value, 10);
      q.no = Number.isFinite(no) ? no : q.no;
      q.stem = document.getElementById('pqStem').value;
      q.answer = document.getElementById('pqAnswer').value;
      // 提交草稿，并删除被移除的 blob
      if (pqOrig) [...pqOrig].filter(id => !pqImgs.includes(id)).forEach(dropImage);
      q.images = pqImgs.slice();
      p.updatedAt = Date.now();
      savePapers();
    }
    pqImgs = []; pqOrig = null;
    pqEditing = null;
    document.getElementById('paperQModal').classList.remove('open');
    renderPaperEdit();
  }
};

function savePapers() { return persist(K_P, stores.p.items); }

function renderPapers() {
  const list = stores.p.items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  countEl.textContent = `共 ${stores.p.items.length} 张试卷`;
  listEl.innerHTML = '';
  document.getElementById('loadMoreRow').style.display = 'none';
  if (!list.length) {
    listEl.innerHTML = '<div class="empty">还没有试卷。点右上角「+ 新增试卷」粘贴整卷试试。</div>';
    return;
  }
  const box = document.createElement('div');
  box.className = 'paper-list';
  list.forEach(p => {
    const wrongN = p.questions.filter(q => q.wrong === 'wrong').length;
    const card = document.createElement('div');
    card.className = 'card paper-card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="stem"><b>${esc(p.title)}</b></div>
      <div class="meta">
        <span class="tag">${p.questions.length} 题</span>
        <span class="tag${wrongN ? ' ' : ''}">错 ${wrongN}</span>
        ${p.date ? `<span class="tag">${esc(p.date)}</span>` : ''}
        <div class="cardacts">
          <button class="link" data-act="open">打开</button>
          <button class="link" data-act="edit">编辑</button>
          <button class="link" data-act="rename">改名</button>
          <button class="link" data-act="delete">删除</button>
        </div>
      </div>`;
    box.appendChild(card);
  });
  listEl.appendChild(box);
  // 事件委托：一次绑定，避免逐卡绑定
  box.querySelectorAll('.paper-card').forEach(card => {
    card.onclick = e => {
      const act = e.target.dataset && e.target.dataset.act;
      const paper = stores.p.items.find(x => x.id === card.dataset.id);
      if (!paper) return;
      if (act === 'edit') { openPaperEdit(paper.id); return; }
      if (act === 'delete') {
        if (confirm(`删除试卷「${paper.title}」？已加入错题本的题会保留。`)) {
          stores.p.items = stores.p.items.filter(x => x.id !== paper.id);
          savePapers();
          renderPapers();
        }
        return;
      }
      if (act === 'rename') {
        const name = prompt('试卷名：', paper.title);
        if (name != null && name.trim()) {
          paper.title = name.trim();
          paper.updatedAt = Date.now();
          savePapers();
          renderPapers();
        }
        return;
      }
      openPaper(paper.id);
    };
  });
}

function render() {
  renderColTree();
  if (active === 'p') return renderPapers();
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

/* ===================== 合集（文件夹式，每库一棵可嵌套的树） ===================== */
const colTreeEl = document.getElementById('colTree');
const colBackdrop = document.getElementById('colBackdrop');
const colCollapsed = new Set();   // 被折叠的合集 id（默认展开）

const colKind = () => active === 'k' ? 'k' : 'q';

// 「侧栏收起为竖条」的偏好：全局（错题 / 知识点共用），存于 mq_settings.rail（'on' | 'off'）
const colRailOn = () => settings.rail === 'on';
function setColRail(on) {
  settings.rail = on ? 'on' : 'off';
  saveSettings();
  applySettings();
}
const colList = kind => (colStores[kind] || []);
function collectionById(kind, id) { return colList(kind).find(c => c.id === id); }
function collectionName(kind, id) { const c = collectionById(kind, id); return c ? c.name : '未分类'; }

// 生成「所属合集」下拉的选项：未分类 + 缩进树 + 新建入口
function collectionOptionsHtml(kind, selectedId) {
  const opts = [`<option value=""${selectedId == null ? ' selected' : ''}>未分类</option>`];
  for (const c of flattenCollections(colList(kind))) {
    const ind = c.depth ? '　'.repeat(c.depth) + '└ ' : '';
    opts.push(`<option value="${esc(c.id)}"${selectedId === c.id ? ' selected' : ''}>${ind}${esc(c.name)}</option>`);
  }
  opts.push(`<option value="__new__">＋ 新建合集…</option>`);
  return opts.join('');
}

// 新建合集：加在指定父节点下（同名同级拒绝）
function addCollectionQuick(kind, parentId, name) {
  const nm = String(name == null ? '' : name).trim();
  if (!nm) return null;
  const pid = parentId || null;
  if (collectionChildren(colList(kind), pid).some(c => c.name === nm)) {
    alert(`同级下已存在同名合集「${nm}」。`);
    return null;
  }
  const r = addCollection(colList(kind), nm, pid, Date.now());
  colStores[kind] = r.cols;
  if (pid) colCollapsed.delete(pid);      // 展开父节点，让新建的子合集可见
  saveCols(kind);
  return r.node.id;
}

if (colBackdrop) colBackdrop.onclick = () => closeColDrawer();
function openColDrawer() { colTreeEl.classList.add('open'); colBackdrop.classList.add('show'); }
function closeColDrawer() { colTreeEl.classList.remove('open'); colBackdrop.classList.remove('show'); }
function closeColDrawerIfNarrow() { if (window.innerWidth < 1024) closeColDrawer(); }
document.getElementById('colToggle').onclick = () => {
  // 宽屏：一键在「完整侧栏 ⇄ 窄竖条」之间切换；窄屏：开合抽屉（行为不变）
  if (window.innerWidth >= 1024) { setColRail(!colRailOn()); return; }
  colTreeEl.classList.contains('open') ? closeColDrawer() : openColDrawer();
};

function renderColTree() {
  if (!colTreeEl) return;
  if (active !== 'q' && active !== 'k') { colTreeEl.innerHTML = ''; return; }
  const kind = colKind();
  const v = cur();
  const cols = colList(kind);
  const { subtree, unassigned } = collectionCounts(curItems(), cols);
  const sel = v.collectionFilter;
  const st = colTreeEl.scrollTop;

  // 宽屏 + 已收起 → 渲染窄竖条（平铺所有合集）；否则保持现有完整树
  if (colRailOn() && window.innerWidth >= 1024) {
    renderColRail(kind, cols, subtree, unassigned, sel);
    return;
  }

  const nodeRow = o => {
    const pad = 6 + o.depth * 14;
    const twist = o.hasKids
      ? `<span class="twist" data-twist="${esc(o.id)}">${o.collapsed ? '▸' : '▾'}</span>`
      : '<span class="twist"></span>';
    const acts = o.virtual ? '' : `
      <span class="cacts">
        <button data-cnew="${esc(o.id)}" title="新建子合集">＋</button>
        <button data-cedit="${esc(o.id)}" title="重命名">✎</button>
        <button data-cdel="${esc(o.id)}" class="del" title="删除">🗑</button>
      </span>`;
    return `<div class="colrow${o.active ? ' active' : ''}" data-crow="${esc(o.id)}" style="padding-left:${pad}px">
      ${twist}<span class="cname">${esc(o.name)}</span><span class="ccount">${o.count}</span>${acts}
    </div>`;
  };

  let html = `<div class="coltree-head"><span class="t">合集</span><button class="railbtn" id="colCollapse" title="收起侧栏">«</button><button class="cls" id="colClose" title="关闭">✕</button></div>`;
  html += nodeRow({ id: COL_ALL, name: '全部', count: curItems().length, active: sel === COL_ALL, depth: 0, virtual: true });
  html += nodeRow({ id: NONE_ID, name: '未分类', count: unassigned, active: sel == null, depth: 0, virtual: true });

  const walk = (parentId, depth) => {
    let s = '';
    for (const c of collectionChildren(cols, parentId)) {
      const kids = collectionChildren(cols, c.id);
      const collapsed = colCollapsed.has(c.id);
      s += nodeRow({ id: c.id, name: c.name, count: subtree.get(c.id) || 0, active: sel === c.id, depth, hasKids: !!kids.length, collapsed });
      if (kids.length && !collapsed) s += walk(c.id, depth + 1);
    }
    return s;
  };
  const tree = walk(null, 0);
  html += tree || '<div class="col-empty">还没有合集。点下面「＋ 新建合集」开始，或先把几条内容归进去。</div>';
  html += `<button class="coltree-new" id="colNew">＋ 新建合集</button>`;
  colTreeEl.innerHTML = html;
  colTreeEl.scrollTop = st;

  colTreeEl.querySelectorAll('[data-crow]').forEach(el => {
    el.onclick = e => {
      if (e.target.closest('[data-cnew],[data-cedit],[data-cdel],[data-twist]')) return;
      const raw = el.dataset.crow;
      v.collectionFilter = raw === NONE_ID ? null : raw;   // COL_ALL 原样保留
      applyFilters();
      closeColDrawerIfNarrow();
    };
  });
  colTreeEl.querySelectorAll('[data-twist]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const id = el.dataset.twist;
      colCollapsed.has(id) ? colCollapsed.delete(id) : colCollapsed.add(id);
      renderColTree();
    };
  });
  colTreeEl.querySelectorAll('[data-cnew]').forEach(b => b.onclick = e => { e.stopPropagation(); createCollection(b.dataset.cnew); });
  colTreeEl.querySelectorAll('[data-cedit]').forEach(b => b.onclick = e => { e.stopPropagation(); renameCollectionPrompt(b.dataset.cedit); });
  colTreeEl.querySelectorAll('[data-cdel]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteCollectionPrompt(b.dataset.cdel); });
  const nb = colTreeEl.querySelector('#colNew');
  if (nb) nb.onclick = () => createCollection(null);
  const cb = colTreeEl.querySelector('#colClose');
  if (cb) cb.onclick = () => closeColDrawer();
  const cc = colTreeEl.querySelector('#colCollapse');
  if (cc) cc.onclick = () => setColRail(true);
}

// 首字（竖条方块上显示一个字符；对代理对/emoji 安全）
const firstChar = s => { const t = String(s == null ? '' : s).trim(); return t ? [...t][0] : '?'; };

// 窄竖条：平铺「全部」「未分类」+ 所有合集（含子合集，不体现缩进），复用同一份 collectionFilter 选中态
function renderColRail(kind, cols, subtree, unassigned, sel) {
  const v = cur();
  // 保留竖条内部滚动位置
  const prev = colTreeEl.querySelector('.colrail-items');
  const st = prev ? prev.scrollTop : 0;

  const item = (id, name, active, tip) =>
    `<button class="colrail-item${active ? ' active' : ''}" data-rrow="${esc(id)}" title="${esc(tip)}">${esc(firstChar(name))}</button>`;

  let items = '';
  items += item(COL_ALL, '全部', sel === COL_ALL, `全部 · ${curItems().length} 条`);
  items += item(NONE_ID, '未分类', sel == null, `未分类 · ${unassigned} 条`);
  for (const c of flattenCollections(cols)) {
    const path = collectionPath(cols, c.id).map(x => x.name).join(' / ');
    items += item(c.id, c.name, sel === c.id, `${path} · ${subtree.get(c.id) || 0} 条`);
  }

  colTreeEl.innerHTML = '<div class="colrail">'
    + '<button class="colrail-btn" id="colRailExpand" title="展开合集侧栏">»</button>'
    + `<div class="colrail-items">${items}</div>`
    + '<button class="colrail-btn" id="colRailNew" title="新建合集">＋</button>'
    + '</div>';

  const itemsEl = colTreeEl.querySelector('.colrail-items');
  if (itemsEl) itemsEl.scrollTop = st;

  colTreeEl.querySelectorAll('[data-rrow]').forEach(el => {
    el.onclick = () => {
      const raw = el.dataset.rrow;
      v.collectionFilter = raw === NONE_ID ? null : raw;   // COL_ALL 原样保留
      applyFilters();                                       // 重渲染 → 竖条高亮与列表同步更新
    };
  });
  const ex = colTreeEl.querySelector('#colRailExpand');
  if (ex) ex.onclick = () => setColRail(false);
  const nw = colTreeEl.querySelector('#colRailNew');
  if (nw) nw.onclick = () => createCollection(null);
}

const NONE_ID = '__none__';   // 侧栏「未分类」虚拟行的 id

function createCollection(parentId) {
  const kind = colKind();
  const name = prompt(parentId ? '新建子合集名称：' : '新建合集名称：');
  if (name == null) return;
  if (addCollectionQuick(kind, parentId, name)) { renderColTree(); applyFilters(); }
}

function renameCollectionPrompt(id) {
  const kind = colKind();
  const c = collectionById(kind, id);
  if (!c) return;
  const name = prompt('重命名合集：', c.name);
  if (name == null) return;
  const nm = name.trim();
  if (!nm || nm === c.name) return;
  if (collectionChildren(colList(kind), c.parentId || null).filter(x => x.id !== id).some(x => x.name === nm)) {
    alert(`同级下已存在同名合集「${nm}」。`);
    return;
  }
  colStores[kind] = renameCollection(colList(kind), id, nm, Date.now());
  saveCols(kind);
  renderColTree();
  applyFilters();
}

function deleteCollectionPrompt(id) {
  const kind = colKind();
  const cols = colList(kind);
  const c = collectionById(kind, id);
  if (!c) return;
  const ids = collectionSubtreeIds(cols, id);
  const extra = ids.size - 1;
  const n = (collectionCounts(curItems(), cols).subtree.get(id)) || 0;
  const msg = `删除合集「${c.name}」？`
    + (extra ? `其下 ${extra} 个子合集会一并删除。` : '')
    + (n ? `\n其中 ${n} 条内容会回到「未分类」。` : '')
    + '\n此操作不可撤销。';
  if (!confirm(msg)) return;
  colStores[kind] = deleteCollection(cols, id).cols;
  let changed = false;
  for (const it of curItems()) {
    if (it.collectionId && ids.has(it.collectionId)) { it.collectionId = null; changed = true; }
  }
  saveCols(kind);
  if (changed) saveActive();
  const v = cur();
  if (v.collectionFilter && ids.has(v.collectionFilter)) v.collectionFilter = COL_ALL;
  render();
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
  const isPaper = v === 'p';
  // 试卷栏目不需要错题/知识点那套筛选控件
  ['search', 'statusFilter'].forEach(id => { document.getElementById(id).style.display = isPaper ? 'none' : ''; });
  const tagPick = document.querySelector('.tagpick');
  if (tagPick) tagPick.style.display = isPaper ? 'none' : '';
  ['selectBtn', 'groupBtn', 'starBtn', 'dueBtn', 'randomBtn', 'cramBtn', 'aiBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isPaper ? 'none' : '';
  });
  addBtn.textContent = isPaper ? '+ 新增试卷' : DEF[v].addLabel;
  // 试卷视图不涉及合集，侧栏与入口一并隐藏
  if (colTreeEl) colTreeEl.style.display = isPaper ? 'none' : '';
  const colTgl = document.getElementById('colToggle');
  if (colTgl) colTgl.style.display = isPaper ? 'none' : '';
  if (isPaper) {
    closeColDrawer();
    document.getElementById('toolbar').style.display = 'none';
    document.getElementById('loadMoreRow').style.display = 'none';
    refreshTagPicker();
    pendingAnim = true;
    render();
    return;
  }
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

/* ---------- 拖拽手动排序 ----------
   仅「列表视图 + 未搜索 + 无标签/状态/收藏/待复习筛选 + 未分组 + 合集为全部 + 未背题 + 未随机复习」时可用。
   指针事件实现（pointerdown/move/up），桌面与触屏通用，不依赖 HTML5 DnD；长按多选不受影响。 */
let dragState = null;

function dragAllowed() {
  if (active === 'p') return false;
  const v = cur();
  return !v.search && !v.status && !v.starOnly && !v.dueOnly
    && v.activeTags.size === 0 && !v.groupMode && v.collectionFilter === COL_ALL
    && !cram.open && !randomModal.classList.contains('open');
}

function dragPointerDown(e) {
  if (e.button != null && e.button !== 0) return;      // 仅左键 / 触摸
  const handle = e.currentTarget;
  const card = handle.closest && handle.closest('.card');
  if (!card) return;
  e.preventDefault();
  dragState = {
    id: card.dataset.id,
    el: card,
    startY: e.clientY,
    fromIndex: [...listEl.querySelectorAll('.card')].indexOf(card),
    moved: false,
    pointerId: e.pointerId,
  };
  try { handle.setPointerCapture(e.pointerId); } catch (_) {}
}

function dragPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  if (!dragState.moved && Math.abs(e.clientY - dragState.startY) < 4) return;
  dragState.moved = true;
  dragState.el.classList.add('dragging');
  const x = e.clientX, y = e.clientY;
  // 命中指针所在的其它卡片，按指针在其上半/下半决定插入到前/后
  let over = null;
  for (const c of listEl.querySelectorAll('.card')) {
    if (c === dragState.el) continue;
    const r = c.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { over = c; break; }
  }
  if (over) {
    const r = over.getBoundingClientRect();
    if (y < r.top + r.height / 2) over.parentNode.insertBefore(dragState.el, over);
    else over.parentNode.insertBefore(dragState.el, over.nextSibling);
    return;
  }
  // 指针已落到所有卡片下方：移到末尾
  const rest = [...listEl.querySelectorAll('.card')].filter(c => c !== dragState.el);
  const last = rest[rest.length - 1];
  if (last) {
    const r = last.getBoundingClientRect();
    if (y > r.bottom) last.parentNode.appendChild(dragState.el);
  }
}

function dragPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const st = dragState;
  dragState = null;
  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  st.el.classList.remove('dragging');
  if (!st.moved) { render(); return; }                 // 只是点了下手柄：恢复
  const targetIndex = [...listEl.querySelectorAll('.card')].findIndex(c => c.dataset.id === st.id);
  if (targetIndex < 0 || targetIndex === st.fromIndex) { render(); return; }  // 拖回原位：不写盘
  const mode = (settings.sortMode && settings.sortMode[active]) || 'auto';
  let items;
  if (mode !== 'manual') {                             // 首次拖拽：整库固化为手动
    items = materializeOrder(sortItems(curItems(), 'auto'));
    settings.sortMode[active] = 'manual';
    saveSettings();
  } else {
    items = sortItems(curItems(), 'manual');
  }
  stores[active].items = reorderItems(items, st.id, targetIndex);
  saveActive();
  applySettings();
  render();
}

function bindDragHandle(handle) {
  handle.addEventListener('pointerdown', dragPointerDown);
  handle.addEventListener('pointermove', dragPointerMove);
  handle.addEventListener('pointerup', dragPointerUp);
  handle.addEventListener('pointercancel', dragPointerUp);
}
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
/* 批量移动到合集 */
const moveModal = document.getElementById('moveModal');
const moveSelect = document.getElementById('moveSelect');
document.getElementById('batchMove').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  // 默认选当前正在筛选的合集，省一步
  const def = (v.collectionFilter && v.collectionFilter !== COL_ALL) ? v.collectionFilter : null;
  moveSelect.innerHTML = collectionOptionsHtml(active, def);
  moveModal.classList.add('open');
};
document.getElementById('moveCancel').onclick = () => moveModal.classList.remove('open');
moveModal.onclick = e => { if (e.target === moveModal) moveModal.classList.remove('open'); };
moveSelect.onchange = () => {
  if (moveSelect.value !== '__new__') return;
  const name = prompt('新建合集名称：');
  const id = name == null ? null : addCollectionQuick(active, null, name);
  moveSelect.innerHTML = collectionOptionsHtml(active, id);
};
document.getElementById('moveConfirm').onclick = () => {
  const v = cur();
  let target = moveSelect.value;
  if (target === '__new__') {
    const name = prompt('新建合集名称：');
    target = name == null ? null : addCollectionQuick(active, null, name);
  }
  if (target === '__new__') return;
  target = target || null;
  curItems().forEach(it => {
    if (v.selected.has(it.id)) { it.collectionId = target; it.updatedAt = Date.now(); }
  });
  saveActive();
  moveModal.classList.remove('open');
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
// 新增/粘贴导入时的「所属合集」选择（null = 未分类）
let addCollectionId = null;
const addColSel = document.getElementById('addCollection');
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

let pendingPaper = null;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openPaperAdd() {
  pendingPaper = null;
  const modal = document.getElementById('paperAddModal');
  document.getElementById('paperNameInput').value = '';
  document.getElementById('paperAddDate').value = todayStr();
  document.getElementById('paperRawInput').value = '';
  document.getElementById('paperPreview').innerHTML = '';
  document.getElementById('paperParseMsg').textContent = '';
  document.getElementById('paperImportRow').style.display = 'none';
  modal.classList.add('open');
  document.getElementById('paperRawInput').focus();
}

document.getElementById('paperAddClose').onclick = () => document.getElementById('paperAddModal').classList.remove('open');
document.getElementById('paperAddModal').onclick = e => {
  if (e.target === document.getElementById('paperAddModal')) document.getElementById('paperAddModal').classList.remove('open');
};

document.getElementById('paperParseBtn').onclick = () => {
  pendingPaper = parsePaper(document.getElementById('paperRawInput').value, Date.now());
  const msg = document.getElementById('paperParseMsg');
  const preview = document.getElementById('paperPreview');
  const importRow = document.getElementById('paperImportRow');
  if (!pendingPaper.questions.length) {
    preview.innerHTML = '';
    importRow.style.display = 'none';
    msg.textContent = '没解析到内容，检查一下格式（每题要有【题目】，题间用 === 分隔）。';
    return;
  }
  msg.textContent = `解析到 ${pendingPaper.questions.length} 题。`;
  importRow.style.display = 'flex';
  preview.innerHTML = pendingPaper.questions.map((q, i) => `
    <div class="pvi">
      <div class="row" style="margin:0 0 8px"><span class="section-label">第 ${i + 1} 题</span>
        <span class="badge-note">答案 ${q.answer ? '✓' : '✗'}</span></div>
      <div class="stem">${renderMath(q.stem)}</div>
    </div>
  `).join('');
};

document.getElementById('paperImportBtn').onclick = () => {
  if (!pendingPaper || !pendingPaper.questions.length) return;
  const name = document.getElementById('paperNameInput').value.trim();
  const date = document.getElementById('paperAddDate').value;
  const paper = normalizePaper(Object.assign({}, pendingPaper, {
    id: uid(), title: name || '未命名试卷', date, createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const dup = stores.p.items.some(p => p.title === paper.title);
  if (dup && !confirm(`已存在同名试卷「${paper.title}」，仍要导入吗？`)) return;
  stores.p.items.push(paper);
  savePapers();
  pendingPaper = null;
  document.getElementById('paperAddModal').classList.remove('open');
  renderPapers();
};

// 新增弹窗「所属合集」下拉：与侧栏共用同一棵合集树
function refreshAddCollection() {
  addColSel.innerHTML = collectionOptionsHtml(active, addCollectionId);
}
function newCollectionFromAdd() {
  const name = prompt('新建合集名称：');
  const id = name == null ? null : addCollectionQuick(active, null, name);
  if (id != null) addCollectionId = id;
  refreshAddCollection();
}
addColSel.onchange = () => {
  if (addColSel.value === '__new__') newCollectionFromAdd();
  else addCollectionId = addColSel.value || null;
};
document.getElementById('addColNew').onclick = newCollectionFromAdd;

addBtn.onclick = () => {
  if (active === 'p') { openPaperAdd(); return; }
  const d = DEF[active];
  pending = [];
  resetPendingImgs();
  addCollectionId = null;
  refreshAddCollection();
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
  for (const i of checked) {
    const obj = norm(pending[i]);
    obj.collectionId = addCollectionId;
    stores[active].items.push(obj);
  }
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
    <label>所属合集</label>
    <select id="ef_collection" class="field-input">${collectionOptionsHtml(active, it.collectionId)}</select>
  `;
  for (const key of Object.keys(d.fieldLabels)) document.getElementById('ef_' + key).value = it[key];
  document.getElementById('ef_tags').value = it.tags.join(', ');
  const colSel = document.getElementById('ef_collection');
  colSel.onchange = () => {
    if (colSel.value !== '__new__') return;
    const name = prompt('新建合集名称：');
    const id = name == null ? null : addCollectionQuick(active, null, name);
    colSel.innerHTML = collectionOptionsHtml(active, id != null ? id : it.collectionId);
  };
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
  const colVal = document.getElementById('ef_collection').value;
  it.collectionId = (colVal && colVal !== '__new__') ? colVal : null;
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
  const payload = { version: 4, questions: stores.q.items, knowledge: stores.k.items, collections: { q: colStores.q, k: colStores.k } };
  downloadBlob(`数学复习本-${dateStamp()}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

// 完整备份：把配图以 base64 一并写入，换设备后可完整还原
document.getElementById('exportFullBtn').onclick = async () => {
  settingsDrawer.classList.remove('open');
  const payload = { version: 4, questions: stores.q.items, knowledge: stores.k.items, papers: stores.p.items, collections: { q: colStores.q, k: colStores.k }, images: {} };
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

    let qs = null, ks = null, ps = null, imgs = null, cols = null;
    if (Array.isArray(data)) {
      qs = data; // 兼容旧版：数组即错题列表
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.questions)) qs = data.questions;
      if (Array.isArray(data.knowledge)) ks = data.knowledge;
      if (Array.isArray(data.papers)) ps = data.papers;
      if (data.images && typeof data.images === 'object') imgs = data.images;
      if (data.collections && typeof data.collections === 'object') cols = data.collections;
    }
    if (qs === null && ks === null && ps === null) { alert('文件结构不符合要求，未做任何修改。'); return; }
    if (qs && !qs.every(x => x && typeof x === 'object')) { alert('questions 结构非法，未做任何修改。'); return; }
    if (ks && !ks.every(x => x && typeof x === 'object')) { alert('knowledge 结构非法，未做任何修改。'); return; }
    if (ps && !ps.every(x => x && typeof x === 'object')) { alert('papers 结构非法，未做任何修改。'); return; }

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
    if (ps) { const inc = ps.map(normalizePaper); stores.p.items = mode ? inc : stores.p.items.concat(inc); savePapers(); }

    // 合集树：替换模式整体替换（文件不含合集则清空）；追加模式并入现有树，再修正非法引用
    for (const kind of ['q', 'k']) {
      const incoming = (cols && Array.isArray(cols[kind])) ? cols[kind] : null;
      if (incoming) colStores[kind] = settleCollections(mode ? incoming : colStores[kind].concat(incoming));
      else if (mode) colStores[kind] = [];
      saveCols(kind);
      if (sanitizeItemCollections(stores[kind].items, colStores[kind])) saveStore(stores[kind].key, stores[kind].items);
    }

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
    alert(`导入完成：错题 ${stores.q.items.length} 道，知识点 ${stores.k.items.length} 个` +
      (ps ? `，试卷 ${stores.p.items.length} 张` : '') + '。' +
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
  const paperImgs = stores.p.items.reduce((n, p) =>
    n + (p.questions || []).reduce((m, pq) => m + ((pq.images && pq.images.length) || 0), 0), 0);
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
      <div class="stat-line"><span>配图数量</span><b>${imgN(q) + imgN(k) + paperImgs}</b></div>
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
  const items = sortItems(curItems(), (settings.sortMode && settings.sortMode[active]) || 'auto');
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
  const items = sortItems(curItems(), (settings.sortMode && settings.sortMode[active]) || 'auto');
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
  if (isPaperViewOpen() && handlePaperKey(e)) return;
  if (e.key === 'Escape' && settingsDrawer.classList.contains('open')) settingsDrawer.classList.remove('open');
});

/* ---------- 设置抽屉 ---------- */
const settingsDrawer = document.getElementById('settingsDrawer');
document.getElementById('settingsBtn').onclick = () => { applySettings(); settingsDrawer.classList.add('open'); };
document.getElementById('settingsClose').onclick = () => settingsDrawer.classList.remove('open');
settingsDrawer.onclick = e => { if (e.target === settingsDrawer) settingsDrawer.classList.remove('open'); };
settingsDrawer.querySelectorAll('.seg button').forEach(btn => {
  btn.onclick = () => {
    const seg = btn.closest('.seg');
    if (seg.id === 'setSort') {                 // 排序：按当前库写入 sortMode
      if (active === 'p') return;
      settings.sortMode[active] = btn.dataset.sort;
      saveSettings();
      applySettings();
      render();
      return;
    }
    const key = seg.id.slice(3).toLowerCase();  // setCols→cols 等
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
    '2. 公式一律使用 LaTeX 且必须带定界符：行内公式用 $...$，独立公式用 $$...$$；',
    '   注意：矩阵、方程组、分段函数、多行推导等会跨行的公式必须用 $$...$$ 包裹，$...$ 不能跨行；',
    '   绝不允许输出没有任何 $ 包裹的裸公式：例如 y\'\' = \\frac{dp}{dx} 这种写法是错的，必须写成 $$y\'\' = \\frac{dp}{dx}$$；',
    '   只要出现 \\frac、\\sqrt、\\int、\\sum、^、_ 这类数学写法，它就是一个公式，必须加 $...$ 或 $$...$$；',
    `3. 图中若有多道${n}，它们之间用单独一行 === 分隔；`,
    '4. 若图中没有可识别的内容，就只回答：未识别到内容。',
  ].join('\n');
}

/* 两条主提示词（内置调用 / 复制给免费 AI）共用同一份「输出要求」，
   避免两处各写一份、以后改一处忘一处。 */
function aiOutputRules() {
  const base = [
    '1. 只输出固定格式的内容，不要输出任何解释、寒暄或标题；',
    '2. 不要用 ``` 代码块把整体包裹起来；',
    '3. 公式一律使用 LaTeX 且必须带定界符：行内公式用 $...$，独立公式用 $$...$$；矩阵、方程组、分段函数、多行推导等会跨行的公式必须用 $$...$$ 包裹（$...$ 不能跨行）；矩阵换行用 \\\\，列用 &，例如 $$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$；',
    '   · 最常犯的错：直接输出没有任何 $ 包裹的裸公式。像 y\'\' = \\frac{dp}{dx} = \\frac{dp}{dy} \\cdot \\frac{dy}{dx} = p \\frac{dp}{dy} 这样写是错的，必须写成 $$y\'\' = \\frac{dp}{dx} = \\frac{dp}{dy} \\cdot \\frac{dy}{dx} = p \\frac{dp}{dy}$$；',
    '   · 判断标准：只要一段文字里出现 \\frac、\\sqrt、\\int、\\sum、\\lim、^、_、{ 这类数学写法，它就是公式，必须加 $...$ 或 $$...$$，一个都不能漏；',
    '   · 所有公式都要逐个检查一遍：凡是出现在【题目】【解析】【知识点】【讲解】里的公式，都必须被 $ 或 $$ 包住。',
    '4. 不要使用 Markdown 语法：不要 **加粗**、不要 # 标题、不要 - 或 * 列表、不要 | 表格；需要分步就用行首「第 1 步：」这类前缀，每一步单独成行；',
  ];
  const steps = active === 'q' ? [
    '5. 【解析】必须逐步详解，不要一步抛出答案：',
    '   · 每一步都写清三件事：这一步在做什么、依据是什么（用到的定理/公式/性质，写成 LaTeX）、这一步得到的结果；',
    '   · 不要跳步：配方、约分、通分、代入、换元、求导、解方程等关键变形的中间式都要写出来，必要时用 $$...$$ 展示推导；',
    '   · 每一步单独成行，行首用「第 1 步：」「第 2 步：」这样的前缀；',
    '6. 【知识点】写清「定义 + 为什么成立 + 怎么用 + 易错点」，公式同样用 LaTeX，必要时用 $$...$$ 展示推导；',
    '7. 原文里若含多项（以 === 分隔），输出的每一项与之一一对应；',
    '8. 不要改动原文的题目内容，只在其基础上补充解答与整理；',
    '9. 【我的错误答案】是留给用户自己填的，请保持为空、不要输出该段内容。',
  ] : [
    '5. 【讲解】必须逐步讲透，不要只给结论：',
    '   · 先给定义（写成 LaTeX），再说明为什么成立、几何或代数含义、适用条件；',
    '   · 再给标准用法和一个示范，示范同样逐步写清在做什么、依据是什么、得到什么；',
    '   · 最后写易错点；每一步单独成行，行首用「第 1 步：」「第 2 步：」这样的前缀；',
    '6. 原文里若含多项（以 === 分隔），输出的每一项与之一一对应；',
    '7. 不要改动原文的内容，只在其基础上补充讲解与整理。',
  ];
  return base.concat(steps);
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
  ].concat(aiOutputRules(), ['', '格式示例：', d.importExample]).join('\n');
}

// 「复制给我用的提示词」：让用户拿去任意对话式 AI 里预处理，再把结果粘回本应用
function aiPromptText() {
  const d = DEF[active];
  const what = active === 'q' ? '一道数学题' : '一个数学知识点（含讲解）';
  return [
    `请扮演数学助教。下面我会把${what}发给你（可以直接发图片），`,
    '请你把它整理成可直接导入我复习本的固定格式。',
    '',
    '输出要求：',
  ].concat(aiOutputRules(), [
    '',
    '固定格式如下（这就是我需要的输出格式；注意示例里每一处公式都被 $ 或 $$ 包住，请照此输出）：',
    d.importExample,
    '',
    '特别提醒：不要把公式写成没有 $ 的裸写法，例如 y\'\' = \\frac{dp}{dx} 是错的，正确写法是 $$y\'\' = \\frac{dp}{dx}$$。',
    '',
    '现在请等我发送内容。',
  ]).join('\n');
}

/* ---------- AI 整理：提示词与分批调用 ----------
   dims: { tags:bool, collection:bool, knowledge:bool } */
const AI_ORG_BATCH = 30;          // 每次请求最多处理的错题数

function aiOrgJsonRules(dims) {
  const fields = [];
  if (dims.tags) fields.push('"tags": 字符串数组，2~4 个短标签（章节名 / 知识点 / 题型，不要整句话）');
  if (dims.collection) fields.push('"collectionPath": 字符串，形如 "高等数学/极限"（最多两级，末级是考点名）');
  if (dims.knowledge) fields.push('"knowledge": 字符串，一句话写清「考点 + 易错点」，公式用 $...$');
  return [
    '你是数学错题整理助手。下面会给你一个 JSON 数组，元素形如 {"id":"...","stem":"题目原文（可能含 $LaTeX$）"}。',
    '请为每一项给出整理建议，并**严格只输出一个 JSON 数组**，不要输出任何解释、标题或 ``` 围栏。',
    '每个元素形如：',
    '{',
    '  "id": "与输入完全相同的 id",',
    fields.join(',\n  '),
    '}',
    '要求：',
    '1. 输出数组的元素个数、顺序与输入完全一致，id 必须原样照抄；',
    '2. 不要改动题目原文；',
    '3. 标签要短、要能复用，同一考点在不同题里必须用同一个词，不要输出同义写法；',
    '4. 若某项无法判断，对应字段给空数组或空字符串，不要瞎猜。',
  ].join('\n');
}

function aiOrgUserText(items) {
  return JSON.stringify(items.map(it => ({
    id: it.id,
    stem: String(it.stem || '').replace(/\s+/g, ' ').slice(0, 400),
  })));
}

// 分类树建议：只让 AI 输出叶子路径列表
function aiTreePrompt() {
  return [
    '你是数学课程分类专家。下面给你一批数学错题原文（JSON 数组）。',
    '请按中国考研数学 / 高中数学的知识体系，给出**一套通用的两层分类**（一级为学科大块，二级为考点）。',
    '严格只输出 JSON 对象：{"paths":["高等数学/极限","高等数学/中值定理","线性代数/行列式","概率论/随机变量"]}',
    '要求：',
    '1. 一级分类控制在 2~5 个（如 高等数学 / 线性代数 / 概率论与数理统计）；',
    '2. 二级分类 8~20 个，覆盖这批错题里出现的考点；',
    '3. 用 / 分隔两级，不要出现第三级，不要有重复项，不要输出除该 JSON 以外的任何内容。',
  ].join('\n');
}

// 薄弱诊断：喂本地统计，让 AI 写一段点评
function aiDiagnosePrompt(tableText) {
  return [
    '你是数学学习规划助手。下面是学生错题本按考点分组的统计（每行：考点 | 题数 | 待复习 | 未复习 | 复习中 | 已掌握）。',
    tableText,
    '请用中文输出一段不超过 200 字的诊断：',
    '1. 指出最薄弱的 2~3 个考点（依据是题数多且未掌握占比高）；',
    '2. 给出本周的复习优先级建议；',
    '3. 不要复述整张表，不要输出 Markdown 标题或加粗，只输出纯文本段落。',
  ].join('\n');
}

// 免 Key：把「提示词 + 数据」拼成一段，用户复制到任意 AI，再把输出粘回来
function aiOrgPromptText(items, dims) {
  return [
    aiOrgJsonRules(dims),
    '',
    '下面是需要整理的错题（JSON）：',
    aiOrgUserText(items),
    '',
    '请只输出那个 JSON 数组。',
  ].join('\n');
}

// 分批请求，合并结果 → { plan, failed, errors, ok }
async function aiOrganizeRun(items, dims, onProgress) {
  const list = Array.isArray(items) ? items : [];
  const plan = [], failed = [], errors = [];
  const total = list.length;
  for (let i = 0; i < total; i += AI_ORG_BATCH) {
    const chunk = list.slice(i, i + AI_ORG_BATCH);
    if (typeof onProgress === 'function') onProgress(Math.min(i + AI_ORG_BATCH, total), total);
    const text = await aiCall({ system: aiOrgJsonRules(dims), ask: aiOrgUserText(chunk) });
    const arr = parseAiJson(text);
    if (!Array.isArray(arr)) {
      errors.push(`第 ${i / AI_ORG_BATCH + 1} 批返回的不是 JSON 数组`);
      chunk.forEach(c => failed.push(c.id));
      continue;
    }
    const byId = new Map();
    for (const e of arr) if (e && typeof e.id === 'string') byId.set(e.id, e);
    for (const c of chunk) {
      const e = byId.get(c.id);
      if (!e) { failed.push(c.id); continue; }
      const row = { id: c.id };
      if (dims.tags && Array.isArray(e.tags)) row.tags = e.tags.filter(t => typeof t === 'string' && t.trim());
      if (dims.collection && typeof e.collectionPath === 'string') row.collectionPath = e.collectionPath;
      if (dims.knowledge && typeof e.knowledge === 'string') row.knowledge = e.knowledge;
      plan.push(row);
    }
  }
  if (failed.length) errors.push(`${failed.length} 道题未被模型返回（可重试）`);
  return { plan, failed, errors, ok: plan.length };
}

// 免 Key 路径：解析用户粘回来的文本
function aiOrganizeParsePasted(text, items, dims) {
  const arr = parseAiJson(text);
  if (!Array.isArray(arr)) return { plan: [], failed: items.map(i => i.id), errors: ['粘贴内容不是 JSON 数组'], ok: 0 };
  const valid = new Set(items.map(i => i.id));
  const plan = [], failed = [];
  const seen = new Set();
  for (const e of arr) {
    if (!e || typeof e.id !== 'string' || !valid.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    const row = { id: e.id };
    if (dims.tags && Array.isArray(e.tags)) row.tags = e.tags.filter(t => typeof t === 'string' && t.trim());
    if (dims.collection && typeof e.collectionPath === 'string') row.collectionPath = e.collectionPath;
    if (dims.knowledge && typeof e.knowledge === 'string') row.knowledge = e.knowledge;
    plan.push(row);
  }
  for (const it of items) if (!seen.has(it.id)) failed.push(it.id);
  return { plan, failed, errors: failed.length ? [`${failed.length} 道题未出现在粘贴内容里`] : [], ok: plan.length };
}

/* ---------- 剪贴板（复制提示词用，失败时回退到 execCommand） ---------- */
function copyText(text) {
  const s = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(s).then(() => true, () => legacyCopy(s));
  }
  return Promise.resolve(legacyCopy(s));
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
aiEl('aiPromptBtn').onclick = async () => {
  const ok = await copyText(aiPromptText());
  aiEl('aiMsg').textContent = ok ? '提示词已复制，去任意 AI 粘贴即可' : '复制失败，请手动复制';
};

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

/* ===================== AI 整理弹层 ===================== */
const orgEl = id => document.getElementById(id);
const orgModal = orgEl('aiOrgModal');
let orgState = null;              // { items, dims, plan, rows, undo }

function orgDims() {
  return {
    tags: orgEl('aiOrgDimTags').checked,
    collection: orgEl('aiOrgDimCol').checked,
    knowledge: orgEl('aiOrgDimKp').checked,
  };
}
function orgPickItems() {
  const scope = orgEl('aiOrgScope').value;
  const all = stores.q.items;
  if (scope === 'filtered') return currentFiltered();
  if (scope === 'qualified') return all.filter(it => !it.collectionId || !it.tags.length || !it.knowledge);
  return all.slice();
}
function orgShowStep(name) {
  ['aiOrgSetup', 'aiOrgPasteWrap', 'aiOrgTreeWrap', 'aiOrgReviewWrap'].forEach(id => {
    orgEl(id).style.display = (id === name) ? '' : 'none';
  });
}
function openAiOrg() {
  if (active !== 'q') { alert('AI 整理目前只针对错题库。'); return; }
  if (!stores.q.items.length) { alert('错题库还是空的，先添加几道错题吧。'); return; }
  orgShowStep('aiOrgSetup');
  orgEl('aiOrgMsg').textContent = '';
  orgEl('aiOrgReview').innerHTML = '';
  orgEl('aiOrgUndo').style.display = 'none';
  const tags = allTags();
  orgEl('aiOrgVocabNote').textContent = tags.length
    ? `已有标签 ${tags.length} 个，AI 会优先复用这些标签（避免同义标签泛滥）。`
    : '目前还没有标签，AI 会新建一套。';
  orgModal.classList.add('open');
}
orgEl('aiOrgCancel').onclick = () => orgModal.classList.remove('open');
orgEl('aiOrgClose').onclick = () => orgModal.classList.remove('open');
orgModal.onclick = e => { if (e.target === orgModal) orgModal.classList.remove('open'); };

// 开始整理：分批调用 → 进入审阅
orgEl('aiOrgRun').onclick = async () => {
  const dims = orgDims();
  if (!dims.tags && !dims.collection && !dims.knowledge) { orgEl('aiOrgMsg').textContent = '至少选一个整理维度。'; return; }
  if (!aiReady()) {
    orgEl('aiOrgMsg').textContent = '';
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里填好 Base URL、模型名与 API Key；或改用「复制提示词（免 Key）」。');
    return;
  }
  const items = orgPickItems();
  if (!items.length) { orgEl('aiOrgMsg').textContent = '这个范围里没有错题。'; return; }
  orgEl('aiOrgRun').disabled = true;
  showAiBusy('AI 正在整理，请稍候…');
  try {
    const r = await aiOrganizeRun(items, dims, (done, total) => showAiBusy(`AI 正在整理 ${done}/${total}…`));
    hideAiBusy();
    orgState = { items, dims, plan: r.plan, undo: null };
    orgEl('aiOrgMsg').textContent = r.errors.join('；');
    renderAiOrgReview();
    orgShowStep('aiOrgReviewWrap');
  } catch (e) {
    hideAiBusy();
    orgEl('aiOrgMsg').textContent = (e && e.name === 'AbortError') ? '已取消。' : '整理失败：' + ((e && e.message) || e);
  } finally { orgEl('aiOrgRun').disabled = false; }
};

// 审阅表：每行 = 跳过勾选 + 题干摘要 + 标签开关 + 合集路径 + 考点
function renderAiOrgReview() {
  const st = orgState;
  const box = orgEl('aiOrgReview');
  if (!st) { box.innerHTML = ''; return; }
  const byId = new Map(st.items.map(it => [it.id, it]));
  const rows = st.plan.map(p => Object.assign({ skip: false }, p));
  st.rows = rows;

  box.innerHTML = rows.map((row, i) => {
    const it = byId.get(row.id) || {};
    const chips = (row.tags || []).map(t =>
      `<span class="aio-chip" data-chip-i="${i}" data-chip-t="${esc(t)}">${esc(t)}<b>×</b></span>`).join('');
    return `<div class="aio-row">
      <label class="aio-skip"><input type="checkbox" data-skip="${i}"${row.skip ? ' checked' : ''}></label>
      <div class="aio-stem">${renderMath(String(it.stem || '').slice(0, 160))}</div>
      <div class="aio-fields">
        ${st.dims.tags ? `<div class="aio-tags">${chips}<input class="aio-tagin" data-tagadd="${i}" placeholder="＋标签"></div>` : ''}
        ${st.dims.collection ? `<input class="aio-path" data-path="${i}" value="${esc(row.collectionPath || '')}" placeholder="如 高等数学/极限" list="aioCols">` : ''}
        ${st.dims.knowledge ? `<textarea class="aio-know" data-know="${i}" placeholder="考点 + 易错点">${esc(row.knowledge || '')}</textarea>` : ''}
      </div>
    </div>`;
  }).join('') + `<datalist id="aioCols">${
    flattenCollections(colStores.q).map(c => `<option value="${esc(collectionPath(colStores.q, c.id).map(x => x.name).join('/'))}"></option>`).join('')
  }</datalist>`;

  box.querySelectorAll('[data-skip]').forEach(cb => { cb.onchange = () => { rows[+cb.dataset.skip].skip = cb.checked; }; });
  box.querySelectorAll('[data-chip-i]').forEach(el => {
    el.onclick = () => {
      const row = rows[+el.dataset.chipI];
      row.tags = (row.tags || []).filter(x => x !== el.dataset.chipT);
      renderAiOrgReview();
    };
  });
  box.querySelectorAll('[data-tagadd]').forEach(inp => {
    inp.onchange = () => {
      const row = rows[+inp.dataset.tagadd];
      const v = inp.value.trim();
      if (!v) return;
      row.tags = mergeSuggestTags(row.tags || [], [v], [], 99);
      renderAiOrgReview();
    };
  });
  box.querySelectorAll('[data-path]').forEach(inp => { inp.onchange = () => { rows[+inp.dataset.path].collectionPath = inp.value.trim(); }; });
  box.querySelectorAll('[data-know]').forEach(ta => { ta.onchange = () => { rows[+ta.dataset.know].knowledge = ta.value; }; });
  orgEl('aiOrgReviewMsg').textContent = `共 ${rows.length} 条建议（AI 未返回的 ${Math.max(0, st.items.length - rows.length)} 道已跳过）。`;
}

orgEl('aiOrgAll').onclick = () => { if (orgState) { orgState.rows.forEach(r => { r.skip = false; }); renderAiOrgReview(); } };
orgEl('aiOrgNone').onclick = () => { if (orgState) { orgState.rows.forEach(r => { r.skip = true; }); renderAiOrgReview(); } };

// 应用：快照 + 写回 + 可撤销
orgEl('aiOrgApply').onclick = async () => {
  const st = orgState;
  if (!st) return;
  const picked = st.rows.filter(r => !r.skip);
  if (!picked.length) { alert('没有选中任何一条建议。'); return; }
  st.undo = stores.q.items.map(it => ({
    id: it.id, tags: it.tags.slice(), collectionId: it.collectionId, knowledge: it.knowledge, kpId: it.kpId,
  }));
  const matchKp = title => {
    const hit = stores.k.items.find(k => (k.title || '').trim() === title);
    return hit ? hit.id : null;
  };
  const r = applyOrganizePlan(stores.q.items, picked, { cols: colStores.q, vocab: allTags(), matchKp });
  stores.q.items = r.items;
  colStores.q = r.cols;
  await saveCols('q');
  await saveStore(stores.q.key, stores.q.items);
  render();
  refreshTagPicker();
  orgEl('aiOrgUndo').style.display = '';
  orgEl('aiOrgMsg').textContent = `已应用 ${r.changed} 条改动。`;
};

function undoAiOrg() {
  const st = orgState;
  if (!st || !st.undo) return;
  const byId = new Map(st.undo.map(x => [x.id, x]));
  stores.q.items = stores.q.items.map(it => {
    const u = byId.get(it.id);
    return u ? Object.assign({}, it, { tags: u.tags.slice(), collectionId: u.collectionId, knowledge: u.knowledge, kpId: u.kpId }) : it;
  });
  saveStore(stores.q.key, stores.q.items);
  render();
  refreshTagPicker();
  orgEl('aiOrgMsg').textContent = '已撤销。';
  st.undo = null;
  orgEl('aiOrgUndo').style.display = 'none';
}
orgEl('aiOrgUndo').onclick = () => undoAiOrg();

// 分类树建议 → 可编辑 → 一键建合集
orgEl('aiOrgTree').onclick = async () => {
  if (!aiReady()) {
    orgEl('aiOrgTreeText').value = '';
    orgShowStep('aiOrgTreeWrap');
    orgEl('aiOrgMsg').textContent = '未配置 AI：可以在下面手动写「一级/二级」路径。';
    return;
  }
  showAiBusy('AI 正在建议分类体系…');
  try {
    const text = await aiCall({ system: aiTreePrompt(), ask: aiOrgUserText(orgPickItems().slice(0, AI_ORG_BATCH)) });
    const o = parseAiJson(text);
    const paths = (o && Array.isArray(o.paths)) ? o.paths.filter(p => typeof p === 'string' && p.trim()) : [];
    hideAiBusy();
    orgEl('aiOrgTreeText').value = paths.join('\n');
    orgEl('aiOrgMsg').textContent = paths.length ? '' : 'AI 没有给出可用路径，请在下面手动写。';
    orgShowStep('aiOrgTreeWrap');
  } catch (e) {
    hideAiBusy();
    orgEl('aiOrgMsg').textContent = (e && e.name === 'AbortError') ? '已取消。' : '建议失败：' + ((e && e.message) || e);
  }
};
orgEl('aiOrgTreeBack').onclick = () => orgShowStep('aiOrgSetup');
orgEl('aiOrgTreeCreate').onclick = async () => {
  const paths = orgEl('aiOrgTreeText').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!paths.length) { alert('没有可用的路径。'); return; }
  let cols = colStores.q;
  for (const p of paths) cols = resolveCollectionPath(cols, p, Date.now()).cols;
  colStores.q = cols;
  await saveCols('q');
  renderColTree();
  orgEl('aiOrgMsg').textContent = `已按 ${paths.length} 条路径建好合集。`;
  orgShowStep('aiOrgSetup');
};

// 免 Key 路径：复制提示词 → 粘回输出 → 审阅
orgEl('aiOrgCopy').onclick = async () => {
  const dims = orgDims();
  if (!dims.tags && !dims.collection && !dims.knowledge) { orgEl('aiOrgMsg').textContent = '至少选一个整理维度。'; return; }
  const items = orgPickItems();
  if (!items.length) { orgEl('aiOrgMsg').textContent = '这个范围里没有错题。'; return; }
  const ok = await copyText(aiOrgPromptText(items, dims));
  if (!ok) { orgEl('aiOrgMsg').textContent = '复制失败，请手动复制。'; return; }
  orgState = { items, dims, plan: [], undo: null };
  orgEl('aiOrgPaste').value = '';
  orgShowStep('aiOrgPasteWrap');
  orgEl('aiOrgMsg').textContent = '提示词已复制，去任意 AI 粘贴即可。';
};
orgEl('aiOrgPasteBack').onclick = () => orgShowStep('aiOrgSetup');
orgEl('aiOrgPasteGo').onclick = () => {
  if (!orgState) return;
  const r = aiOrganizeParsePasted(orgEl('aiOrgPaste').value, orgState.items, orgState.dims);
  orgState.plan = r.plan;
  orgEl('aiOrgMsg').textContent = r.errors.join('；');
  renderAiOrgReview();
  orgShowStep('aiOrgReviewWrap');
};

document.getElementById('aiOrgBtn').onclick = openAiOrg;

/* ===================== 整理工具（相似题 / 薄弱诊断） ===================== */
const toolsModal = orgEl('aiToolsModal');
let toolsLastTable = '';

orgEl('aiToolsBtn').onclick = () => {
  toolsModal.classList.add('open');
  orgEl('aiToolsBody').innerHTML = '';
  orgEl('aiToolsMsg').textContent = '';
  orgEl('aiToolsAiRow').style.display = 'none';
};
orgEl('aiToolsClose').onclick = () => toolsModal.classList.remove('open');
toolsModal.onclick = e => { if (e.target === toolsModal) toolsModal.classList.remove('open'); };

orgEl('aiToolDup').onclick = () => {
  if (active !== 'q') { alert('只针对错题库。'); return; }
  orgEl('aiToolsAiRow').style.display = 'none';
  const clusters = clusterBySimilarity(stores.q.items, 0.82, it => it.stem);
  const body = orgEl('aiToolsBody');
  if (!clusters.length) { body.innerHTML = '<div class="empty">没有发现高度相似的错题。</div>'; return; }
  body.innerHTML = clusters.map((g, gi) => `
    <div class="aio-group">
      <div class="aio-group-h">第 ${gi + 1} 组 · ${g.length} 道相似</div>
      ${g.map(it => `<div class="aio-group-row">
        <span class="aio-stem">${renderMath(String(it.stem || '').slice(0, 120))}</span>
        <button class="ghost" data-gopen="${esc(it.id)}">打开</button>
        <button class="danger" data-gdel="${esc(it.id)}">删除</button>
      </div>`).join('')}
    </div>`).join('');
  body.querySelectorAll('[data-gopen]').forEach(b => {
    b.onclick = () => { const it = stores.q.items.find(x => x.id === b.dataset.gopen); if (it) openEdit(it); };
  });
  body.querySelectorAll('[data-gdel]').forEach(b => {
    b.onclick = () => {
      const it = stores.q.items.find(x => x.id === b.dataset.gdel);
      if (!it) return;
      if (!confirm(`删除这道错题？\n${String(it.stem || '').slice(0, 40)}…\n（会进回收站，30 天内可恢复）`)) return;
      toTrash('q', it);
      stores.q.items = stores.q.items.filter(x => x.id !== it.id);
      saveStore(stores.q.key, stores.q.items);
      refreshTagPicker();
      render();
      const row = b.closest('.aio-group-row');
      if (row) row.remove();
    };
  });
};

orgEl('aiToolWeak').onclick = () => {
  if (active !== 'q') { alert('只针对错题库。'); return; }
  const gs = groupStats(stores.q.items, it => it.tags, Date.now());
  const body = orgEl('aiToolsBody');
  if (!gs.length) {
    body.innerHTML = '<div class="empty">还没有标签，先做一次「AI 整理 → 打标签」。</div>';
    orgEl('aiToolsAiRow').style.display = 'none';
    return;
  }
  orgEl('aiToolsAiRow').style.display = 'flex';
  const rows = gs.slice(0, 30);
  body.innerHTML = `<table class="aio-tbl"><thead><tr><th>考点/标签</th><th>题数</th><th>待复习</th><th>未复习</th><th>复习中</th><th>已掌握</th></tr></thead><tbody>${
    rows.map(g => `<tr><td>${esc(g.key)}</td><td>${g.count}</td><td>${g.due}</td><td>${g.newc}</td><td>${g.reviewing}</td><td>${g.mastered}</td></tr>`).join('')
  }</tbody></table>`;
  toolsLastTable = rows.map(g => `${g.key} | ${g.count} | ${g.due} | ${g.newc} | ${g.reviewing} | ${g.mastered}`).join('\n');
};

orgEl('aiToolsAiBtn').onclick = async () => {
  if (!aiReady()) { alert('需要先在「设置 → AI 识题」里配置 AI。'); return; }
  if (!toolsLastTable) return;
  showAiBusy('AI 正在诊断…');
  try {
    const text = await aiCall({ system: aiDiagnosePrompt(toolsLastTable), ask: '请给出诊断。' });
    hideAiBusy();
    const box = document.createElement('div');
    box.className = 'aio-diagnose';
    box.textContent = text || '（模型没有返回内容）';
    orgEl('aiToolsBody').appendChild(box);
  } catch (e) {
    hideAiBusy();
    orgEl('aiToolsMsg').textContent = (e && e.name === 'AbortError') ? '已取消。' : '诊断失败：' + ((e && e.message) || e);
  }
};
