/* =========================================================
   数学复习本 · app.js
   两个视图：q=错题 / k=知识点，数据分开存，共用一套标签
   ========================================================= */

/* ===================== storage ===================== */
const K_Q = 'mq_items';
const K_K = 'mq_kps';
const STATUS = { new: '未复习', reviewing: '复习中', mastered: '已掌握' };
const STATUS_NEXT = { new: 'reviewing', reviewing: 'mastered', mastered: 'new' };

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
  q: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), search: '', status: '' },
  k: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), search: '', status: '' },
};
let active = 'q';
let editingId = null;
let pending = [];

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
    if (v.activeTags.size && !it.tags.some(t => v.activeTags.has(t))) return false;
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
    <div class="meta">
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
  card.querySelector('[data-act="edit"]').onclick = () => openEdit(it);
  card.querySelector('[data-act="delete"]').onclick = () => {
    if (confirm('确定删除？')) {
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

  loadMoreRow.style.display = filtered.length > shown.length ? 'flex' : 'none';
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
  menu.innerHTML = clearRow + (tags.length
    ? tags.map(t => `<label class="tagopt"><input type="checkbox" value="${esc(t)}" ${v.activeTags.has(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')
    : '<div class="tagopt" style="color:#7a8194">暂无标签</div>');
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
  render();
}

function syncHeader() {
  const v = cur();
  searchEl.value = v.search;
  statusEl.value = v.status;
  document.getElementById('selectBtn').classList.toggle('primary', v.selectMode);
  document.getElementById('groupBtn').classList.toggle('primary', v.groupMode);
}

function switchView(v) {
  active = v;
  tabEls.forEach(t => t.classList.toggle('active', t.dataset.view === v));
  addBtn.textContent = DEF[v].addLabel;
  randomBtn.textContent = DEF[v].randomLabel;
  syncHeader();
  refreshTagPicker();
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
  if (!confirm(`确定删除选中的 ${v.selected.size} 项？`)) return;
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

addBtn.onclick = () => {
  const d = DEF[active];
  pending = [];
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
  const norm = stores[active].norm;
  for (const i of checked) stores[active].items.push(norm(pending[i]));
  saveActive();
  refreshTagPicker();
  modal.classList.remove('open');
  applyFilters();
};

/* ---------- 编辑弹窗 ---------- */
const editModal = document.getElementById('editModal');

function openEdit(it) {
  editingId = it.id;
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
    <div class="meta">
      ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      <span class="spacer"></span>
      <span class="status ${it.status}">● ${STATUS[it.status]}</span>
    </div>
    ${d.details(it).map(x => `<details><summary>${x.label}</summary><div class="body">${renderMath(x.text) || '<span class="section-label">（暂无）</span>'}</div></details>`).join('')}
  `;
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
    if (qs) { const inc = qs.map(normalizeQuestion); stores.q.items = mode ? inc : stores.q.items.concat(inc); saveStore(K_Q, stores.q.items); }
    if (ks) { const inc = ks.map(normalizeKp); stores.k.items = mode ? inc : stores.k.items.concat(inc); saveStore(K_K, stores.k.items); }
    refreshTagPicker();
    applyFilters();
    alert(`导入完成：错题 ${stores.q.items.length} 道，知识点 ${stores.k.items.length} 个。`);
  };
  reader.readAsText(file);
};

/* ---------- 初始化 ---------- */
refreshTagPicker();
render();
