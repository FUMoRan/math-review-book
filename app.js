/* =========================================================
   数学复习本 · app.js
   两个视图：q=错题 / k=知识点，数据分开存，共用一套标签
   ========================================================= */

/* ===================== storage ===================== */
const K_Q = 'mq_items';
const K_K = 'mq_kps';
const STATUS = { new: '未复习', reviewing: '复习中', mastered: '已掌握' };
const STATUS_NEXT = { new: 'reviewing', reviewing: 'mastered', mastered: 'new' };

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


/* ===================== 图片（存 IndexedDB，文本仍存 localStorage） ===================== */
const K_TRASH = 'mq_trash';
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((res, rej) => {
      const rq = indexedDB.open('mqimg', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('imgs', { keyPath: 'id' }); };
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

// 压缩：最长边 1600，JPEG 0.85；小图或压缩后反而更大则保留原图
function compressImage(file) {
  return new Promise(resolve => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, 1600 / Math.max(w, h));
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
      cv.toBlob(b => resolve(b && b.size < file.size ? b : file), 'image/jpeg', 0.85);
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
let trash = (() => {
  try { const v = JSON.parse(localStorage.getItem(K_TRASH)); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
})();
function saveTrash() { try { localStorage.setItem(K_TRASH, JSON.stringify(trash)); } catch (e) {} }
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

/* ---------- 重复检测 ---------- */
function normText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[，。、；：！？“”‘’（）()【】\[\]$]/g, '');
}
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
function simScore(a, b) {
  const A = bigrams(normText(a)), B = bigrams(normText(b));
  if (!A.length || !B.length) return 0;
  const m = new Map();
  A.forEach(g => m.set(g, (m.get(g) || 0) + 1));
  let hit = 0;
  for (const g of B) { const c = m.get(g); if (c > 0) { hit++; m.set(g, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}
function findDup(kind, obj) {
  const key = kind === 'k' ? 'title' : 'stem';
  const val = obj[key];
  if (!normText(val)) return null;
  let best = null;
  for (const it of stores[kind].items) {
    const s = simScore(val, it[key]);
    if (s >= 0.85 && (!best || s > best.score)) best = { score: s, item: it };
  }
  return best;
}

// 统计一批待导入项里，有多少与现有条目高度相似
function countDups(kind, incoming) {
  const key = kind === 'k' ? 'title' : 'stem';
  let n = 0;
  for (const o of incoming) {
    const val = o && o[key];
    if (!normText(val)) continue;
    if (stores[kind].items.some(it => simScore(val, it[key]) >= 0.85)) n++;
  }
  return n;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeQuestion(it) {
  const o = it && typeof it === 'object' ? it : {};
  return {
    id: o.id || uid(),
    stem: typeof o.stem === 'string' ? o.stem : '',
    analysis: typeof o.analysis === 'string' ? o.analysis : '',
    knowledge: typeof o.knowledge === 'string' ? o.knowledge : '',
    tags: Array.isArray(o.tags) ? o.tags.filter(t => typeof t === 'string' && t.trim()) : [],
    status: STATUS[o.status] ? o.status : 'new',
    star: !!o.star,
    images: Array.isArray(o.images) ? o.images.filter(s => typeof s === 'string' && s) : [],
    createdAt: o.createdAt || Date.now(),
    updatedAt: o.updatedAt || Date.now(),
  };
}

function normalizeKp(it) {
  const o = it && typeof it === 'object' ? it : {};
  return {
    id: o.id || uid(),
    title: typeof o.title === 'string' ? o.title : '',
    content: typeof o.content === 'string' ? o.content : '',
    tags: Array.isArray(o.tags) ? o.tags.filter(t => typeof t === 'string' && t.trim()) : [],
    status: STATUS[o.status] ? o.status : 'new',
    star: !!o.star,
    images: Array.isArray(o.images) ? o.images.filter(s => typeof s === 'string' && s) : [],
    createdAt: o.createdAt || Date.now(),
    updatedAt: o.updatedAt || Date.now(),
  };
}

function loadStore(key, norm) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(raw)) return null;
    return raw.map(norm);
  } catch (e) {
    return null;
  }
}

function saveStore(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch (e) {
    alert('本地存储写入失败（可能是隐私模式或空间不足），建议先「导出」备份。');
    return false;
  }
}

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
  q: { key: K_Q, norm: normalizeQuestion, items: loadStore(K_Q, normalizeQuestion) },
  k: { key: K_K, norm: normalizeKp, items: loadStore(K_K, normalizeKp) },
};
if (stores.q.items === null) { stores.q.items = seedQuestions(); saveStore(K_Q, stores.q.items); }
if (stores.k.items === null) { stores.k.items = seedKps(); saveStore(K_K, stores.k.items); }

/* ===================== 视图定义 ===================== */
const DEF = {
  q: {
    noun: '道错题',
    addLabel: '+ 新增错题',
    randomLabel: '随机一题',
    overviewTitle: '随机一题 · 先自己想，再展开',
    fieldLabels: { stem: '题目（公式用 $...$）', analysis: '解析', knowledge: '知识点讲解' },
    importFieldMap: { 题目: 'stem', 解析: 'analysis', 知识点: 'knowledge', 标签: 'tags' },
    importRequired: '题目',
    importExample: '【题目】\n求函数 $f(x)=x^2-2x+1$ 的最小值。\n【解析】\n配方得 $f(x)=(x-1)^2$，故最小值为 $0$，在 $x=1$ 处取得。\n【知识点】\n二次函数顶点式 $y=a(x-h)^2+k$，顶点为 $(h,k)$。\n【标签】\n二次函数, 最值\n\n多题之间用单独一行 === 分隔',
    main: it => `<div class="stem">${renderMath(it.stem)}</div>`,
    details: it => [
      { label: '查看解析', text: it.analysis },
      { label: '查看知识点讲解', text: it.knowledge },
    ],
    hay: it => [it.stem, it.analysis, it.knowledge, it.tags.join(' ')].join(' '),
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
  q: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), search: '', status: '', starOnly: false },
  k: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), search: '', status: '', starOnly: false },
};
let active = 'q';
let editingId = null;
let pending = [];
let pendingAnim = false;

const cur = () => views[active];
const curItems = () => stores[active].items;
const saveActive = () => saveStore(stores[active].key, curItems());

/* ===================== parser（通用） ===================== */
function parseBlockGeneric(block, map, requiredLabel) {
  const labels = Object.keys(map);
  const re = new RegExp('^\\s*【(' + labels.join('|') + ')】\\s*(.*)$');
  const obj = { errors: [], preText: '' };
  for (const key of Object.values(map)) obj[key] = key === 'tags' ? [] : '';

  let curField = null;
  let buf = [];
  let seen = false;
  const flush = () => {
    if (!curField) return;
    const val = buf.join('\n').trim();
    if (curField === 'tags') obj.tags = val.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    else obj[curField] = val;
    buf = [];
  };

  for (const line of block.split('\n')) {
    const m = line.match(re);
    if (m) {
      flush();
      seen = true;
      curField = map[m[1]];
      if (m[2]) buf.push(m[2]);
    } else if (!seen) {
      if (line.trim()) obj.preText += line + '\n';
    } else {
      buf.push(line);
    }
  }
  flush();

  if (obj.preText.trim()) obj.errors.push('标记前有多余文本（已忽略）');
  if (!obj[map[requiredLabel]]) obj.errors.push('缺少【' + requiredLabel + '】');
  return obj;
}

function parseText(text, map, requiredLabel) {
  return text
    .split(/^[ \t]*={3,}[ \t]*$/m)
    .map(b => parseBlockGeneric(b, map, requiredLabel))
    .filter(o => Object.values(map).some(k => (k === 'tags' ? o.tags.length : o[k])) || o.preText.trim());
}

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

function currentFiltered() {
  const v = cur();
  const q = v.search.trim().toLowerCase();
  const out = curItems().filter(it => {
    if (v.status && it.status !== v.status) return false;
    if (v.starOnly && !it.star) return false;
    // 多标签：选多个时取交集（必须同时含有全部所选标签）
    if (v.activeTags.size && ![...v.activeTags].every(t => it.tags.includes(t))) return false;
    if (q && !DEF[active].hay(it).toLowerCase().includes(q)) return false;
    return true;
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function bindLazy(detailsEl, text, emptyLabel) {
  const body = detailsEl.querySelector('.body');
  detailsEl.addEventListener('toggle', () => {
    if (detailsEl.open && body.dataset.done !== '1') {
      body.innerHTML = text || `<span class="section-label">${emptyLabel}</span>`;
      if (text) body.innerHTML = renderMath(text);
      body.dataset.done = '1';
    }
  });
}

function relatedCount(kp) {
  if (!kp.tags.length) return 0;
  return stores.q.items.filter(q => q.tags.some(t => kp.tags.includes(t))).length;
}

function makeCard(it) {
  const d = DEF[active];
  const v = cur();
  const card = document.createElement('div');
  card.className = 'card';
  const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const rel = active === 'k' && relatedCount(it)
    ? `<span class="relchip" data-rel="1">相关错题 ${relatedCount(it)} 道</span>` : '';
  const dets = d.details(it);
  card.innerHTML = `
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <button class="star ${it.star ? 'on' : ''}" data-act="star" title="${it.star ? '取消收藏' : '收藏'}">${it.star ? '★' : '☆'}</button>
      ${tags}${rel}
      <span class="spacer"></span>
      <span class="status ${it.status}" data-act="status">● ${STATUS[it.status]}</span>
      <button class="link" data-act="edit">编辑</button>
      <button class="link" data-act="delete">删除</button>
    </div>
    ${dets.map(x => `<details><summary>${x.label}</summary><div class="body"></div></details>`).join('')}
  `;
  card.querySelectorAll('details').forEach((el, i) => bindLazy(el, dets[i].text, '（暂无）'));

  card.querySelector('[data-act="status"]').onclick = () => {
    it.status = STATUS_NEXT[it.status];
    it.updatedAt = Date.now();
    saveActive();
    render();
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
    views.q.activeTags = new Set(it.tags);
    views.q.visibleCount = PAGE;
    views.q.search = '';
    views.q.status = '';
    switchView('q');
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
    ? `<div class="tagopt" style="color:var(--muted); font-size:12px; cursor:default">已选 ${v.activeTags.size} 个 · 需同时满足（交集）</div>`
    : '';
  menu.innerHTML = clearRow + note + (tags.length
    ? tags.map(t => `<label class="tagopt"><input type="checkbox" value="${esc(t)}" ${v.activeTags.has(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')
    : '<div class="tagopt" style="color:var(--muted)">暂无标签</div>');
  menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      cb.checked ? v.activeTags.add(cb.value) : v.activeTags.delete(cb.value);
      refreshTagPicker();
      applyFilters();
    };
  });
  const clear = menu.querySelector('.tagopt.clear');
  if (clear) clear.onclick = () => { v.activeTags.clear(); refreshTagPicker(); applyFilters(); };
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
    curItems().forEach(it => { if (v.selected.has(it.id)) { it.status = btn.dataset.batchStatus; it.updatedAt = Date.now(); } });
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

  // 去重：与已有内容高度相似时先提醒
  const dups = checked.filter(i => findDup(active, pending[i]));
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

/* ---------- 编辑弹窗 ---------- */
const editModal = document.getElementById('editModal');
let editingItem = null;

function renderEditThumbs() {
  renderThumbs(document.getElementById('editThumbs'), (editingItem && editingItem.images) || [], id => {
    editingItem.images = editingItem.images.filter(x => x !== id);
    dropImage(id);
    saveActive();
    renderEditThumbs();
  });
}
document.getElementById('editImgBtn').onclick = () => document.getElementById('editImgInput').click();
document.getElementById('editImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !editingItem) return;
  const n = await attachImages(editingItem, files);
  saveActive();
  document.getElementById('editImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderEditThumbs();
};

function openEdit(it) {
  editingId = it.id;
  editingItem = it;
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
document.getElementById('editCancel').onclick = () => editModal.classList.remove('open');
editModal.onclick = e => { if (e.target === editModal) editModal.classList.remove('open'); };
document.getElementById('editSave').onclick = () => {
  const it = curItems().find(x => x.id === editingId);
  if (!it) return;
  for (const key of Object.keys(DEF[active].fieldLabels)) it[key] = document.getElementById('ef_' + key).value.trim();
  it.tags = document.getElementById('ef_tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  it.updatedAt = Date.now();
  saveActive();
  refreshTagPicker();
  render();
  editModal.classList.remove('open');
};

/* ---------- 随机复习 ---------- */
const randomModal = document.getElementById('randomModal');
randomBtn.onclick = () => {
  const pool = currentFiltered();
  if (!pool.length) return alert('当前筛选下没有内容。');
  const it = pool[Math.floor(Math.random() * pool.length)];
  const d = DEF[active];
  document.getElementById('randomTitle').textContent = d.overviewTitle;
  document.getElementById('randomBody').innerHTML = `
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      <span class="spacer"></span>
      <span class="status ${it.status}">● ${STATUS[it.status]}</span>
    </div>
    ${d.details(it).map(x => `<details><summary>${x.label}</summary><div class="body">${renderMath(x.text) || '<span class="section-label">（暂无）</span>'}</div></details>`).join('')}
  `;
  hydrateImages(document.getElementById('randomBody'));
  randomModal.classList.add('open');
};
document.getElementById('randomClose').onclick = () => randomModal.classList.remove('open');
document.getElementById('randomNext').onclick = () => randomBtn.click();
randomModal.onclick = e => { if (e.target === randomModal) randomModal.classList.remove('open'); };

/* ---------- 导出 / 导入（两库一起） ---------- */
document.getElementById('exportBtn').onclick = () => {
  const payload = { version: 2, questions: stores.q.items, knowledge: stores.k.items };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `数学复习本-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

document.getElementById('importBtn2').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (err) { alert('文件不是合法的 JSON。'); return; }

    let qs = null, ks = null;
    if (Array.isArray(data)) {
      qs = data; // 兼容旧版：数组即错题列表
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.questions)) qs = data.questions;
      if (Array.isArray(data.knowledge)) ks = data.knowledge;
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
    refreshTagPicker();
    applyFilters();
    alert(`导入完成：错题 ${stores.q.items.length} 道，知识点 ${stores.k.items.length} 个。`);
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
      ? [['解析', it.analysis], ['知识点', it.knowledge]]
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
    it.status = STATUS_NEXT[it.status];
    it.updatedAt = Date.now();
    saveActive();
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

/* ---------- 初始化 ---------- */
applySettings();
purgeTrash();
updateTrashCount();
updateBackupBar();
refreshTagPicker();
render();
