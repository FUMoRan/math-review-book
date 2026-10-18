# 试卷栏目（整卷上传）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在数学复习本中新增「试卷」栏目：可粘贴导入一整张卷子，按题号顺序展示整卷题目，逐题标记对/错，并把标为错题的题一键加入现有错题本。

**Architecture:** 新增第三个本地存储 `mq_papers`（与 `mq_items`/`mq_kps` 并列）。纯逻辑（归一化、整卷解析、错题转换）放 `lib.js`，用 Node 单测覆盖；界面（栏目、列表、详情弹层、导入弹层）放 `app.js`，复用现有 `renderMath`/`persist`/`kvGet` 等基础设施。试卷题目默认独立于错题本，只有被标为错题并显式加入后才进入 `mq_items` 参与 SRS。

**Tech Stack:** 原生 JS（无框架、无构建）、IndexedDB 存储、KaTeX 渲染、Node 内置 test runner（`node --test`）。

**依据规格:** `docs/superpowers/specs/2026-10-17-paper-upload-design.md`

---

## 文件结构

| 文件 | 责任 | 本次改动 |
| --- | --- | --- |
| `lib.js` | 纯逻辑（浏览器 + 单测共用） | 新增 `normalizePaperQuestion` / `normalizePaper` / `parsePaper` / `paperWrongToQuestion`；`normalizeQuestion` 增补 `fromPaper`；导出新函数 |
| `app.js` | 界面与存储 | 新增 `K_P`、`stores.p`、`views.p`、`DEF.p`；`render`/`switchView`/`addBtn` 增加试卷分支；试卷列表、新增弹层、详情弹层、加入错题本 |
| `index.html` | 页面骨架 | 新增「试卷」tab、试卷新增弹层 `#paperAddModal`、试卷详情弹层 `#paperModal`、题目编辑弹层 `#paperQModal` |
| `styles.css` | 样式 | 试卷卡片、详情题目块、弹层内容样式 |
| `sw.js` | 离线缓存 | 缓存版本号 `math-review-v5` → `v6` |
| `test/lib.test.js` | 单测 | 新增试卷相关用例 |

**约定（锁定，后续任务必须一致）：**

- 存储 key：`mq_papers`；错题 key 仍为 `mq_items`，知识点 `mq_kps`
- 试卷对象字段：`id, title, date, note, createdAt, updatedAt, questions[]`
- 题目字段：`id, no, stem, answer, wrong, tags[], linkedQid`
- `wrong` 取值：`'unset' | 'right' | 'wrong'`，默认 `'unset'`
- 错题来源字段：`fromPaper = { paperId, questionId }`
- DOM id：`paperAddModal` / `paperNameInput` / `paperAddDate` / `paperRawInput` / `paperParseBtn` / `paperParseMsg` / `paperPreview` / `paperImportBtn` / `paperAddClose` / `paperModal` / `paperModalTitle` / `paperBody` / `paperDetailClose` / `paperQModal` / `pqNo` / `pqStem` / `pqAnswer` / `pqSave` / `pqCancel`

---

## Task 1: 试卷题目与试卷的归一化

**Files:**
- Modify: `lib.js`（在 `normalizeKp` 之后、`parseBlockGeneric` 之前插入）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 顶部解构（`const { ... } = MQ;` 那一段）里补上 `normalizePaperQuestion, normalizePaper,`，然后在文件「数据结构归一化」区块末尾（`normalizeQuestion / normalizeKp 对非对象入参安全` 测试之后）追加：

```js
test('normalizePaperQuestion 补全字段并容错', () => {
  const q = normalizePaperQuestion({ stem: 'x', tags: ['a', '', 1, 'b'], wrong: '不存在', no: '3' });
  assert.ok(q.id);
  assert.equal(q.stem, 'x');
  assert.equal(q.answer, '');
  assert.equal(q.wrong, 'unset');
  assert.equal(q.no, 3);
  assert.deepEqual(q.tags, ['a', 'b']);
  assert.equal(q.linkedQid, null);
});

test('normalizePaperQuestion 保留合法三态与已加入错题', () => {
  const q = normalizePaperQuestion({ wrong: 'wrong', linkedQid: 'q1', answer: 'A' });
  assert.equal(q.wrong, 'wrong');
  assert.equal(q.linkedQid, 'q1');
  assert.equal(q.answer, 'A');
});

test('normalizePaper 补全试卷字段并逐题归一化', () => {
  const p = normalizePaper({ title: '  ', questions: [{ stem: 'a' }, null] });
  assert.ok(p.id);
  assert.equal(p.title, '未命名试卷');
  assert.equal(p.note, '');
  assert.equal(p.questions.length, 2);
  assert.equal(p.questions[0].no, 0);
  assert.equal(p.questions[1].stem, '');
  assert.ok(p.createdAt > 0 && p.updatedAt > 0);
});

test('normalizePaper 对非对象入参安全', () => {
  assert.equal(normalizePaper(null).title, '未命名试卷');
  assert.deepEqual(normalizePaper(undefined).questions, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: FAIL，报 `normalizePaperQuestion is not a function`

- [ ] **Step 3: 实现**

在 `lib.js` 的 `normalizeKp` 函数之后插入：

```js
  /* ---------- 试卷（paper） ---------- */
  const WRONG_STATES = ['unset', 'right', 'wrong'];

  function normalizePaperQuestion(o) {
    const p = o && typeof o === 'object' ? o : {};
    let no = p.no;
    if (typeof no === 'string') no = parseInt(no, 10);
    if (!Number.isFinite(no)) no = 0;
    return {
      id: p.id || uid(),
      no,
      stem: typeof p.stem === 'string' ? p.stem : '',
      answer: typeof p.answer === 'string' ? p.answer : '',
      wrong: WRONG_STATES.includes(p.wrong) ? p.wrong : 'unset',
      tags: Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string' && t.trim()) : [],
      linkedQid: typeof p.linkedQid === 'string' && p.linkedQid ? p.linkedQid : null,
    };
  }

  function normalizePaper(o) {
    const p = o && typeof o === 'object' ? o : {};
    return {
      id: p.id || uid(),
      title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '未命名试卷',
      date: typeof p.date === 'string' ? p.date : '',
      note: typeof p.note === 'string' ? p.note : '',
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
      questions: Array.isArray(p.questions) ? p.questions.map(normalizePaperQuestion) : [],
    };
  }
```

并在文件末尾的 `return { ... }` 导出对象里加入 `normalizePaperQuestion, normalizePaper,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: PASS（原有用例仍全绿）

- [ ] **Step 5: 提交**

```bash
cd /workspace
git add lib.js test/lib.test.js
git commit -m "feat: 试卷数据模型归一化（normalizePaper/PaperQuestion）"
```

---

## Task 2: 整卷文本解析 parsePaper

**Files:**
- Modify: `lib.js`（`parseText` 之后插入）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

在顶部解构补 `parsePaper,`，然后追加：

```js
test('parsePaper 按 === 拆分整卷并顺次编号', () => {
  const text = [
    '【题目】', '第1题 $x=1$', '【答案】', '$x=1$',
    '===',
    '【题目】', '第2题 $y=2$', '【解析】', '$y=2$',
  ].join('\n');
  const p = parsePaper(text, 1000);
  assert.equal(p.questions.length, 2);
  assert.deepEqual(p.questions.map(q => q.no), [1, 2]);
  assert.equal(p.questions[0].stem, '第1题 $x=1$');
  assert.equal(p.questions[0].answer, '$x=1$');
  assert.equal(p.questions[1].stem, '第2题 $y=2$');
  assert.equal(p.questions[1].answer, '$y=2$');   // 【解析】也写入 answer
  assert.equal(p.createdAt, 1000);
});

test('parsePaper 缺答案仍可解析', () => {
  const p = parsePaper('【题目】\n只有题干', 2000);
  assert.equal(p.questions.length, 1);
  assert.equal(p.questions[0].answer, '');
});

test('parsePaper 空输入与无题目块返回空试卷', () => {
  assert.equal(parsePaper('', 0).questions.length, 0);
  assert.equal(parsePaper('【答案】\n$1$', 0).questions.length, 0);   // 没有【题目】的块跳过
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: FAIL，报 `parsePaper is not a function`

- [ ] **Step 3: 实现**

在 `lib.js` 的 `parseText` 之后插入：

```js
  /* ---------- 整卷文本解析：=== 分隔每题，【答案】/【解析】都记为 answer ---------- */
  const PAPER_FIELD_MAP = { 题目: 'stem', 答案: 'answer', 解析: 'answer', 标签: 'tags' };

  function parsePaper(text, now) {
    const t = now || Date.now();
    const questions = [];
    String(text == null ? '' : text)
      .split(/^[ \t]*={3,}[ \t]*$/m)
      .forEach(block => {
        const o = parseBlockGeneric(block, PAPER_FIELD_MAP, '题目');
        if (!o.stem) return;                       // 无题干的块（含前导空块）跳过
        questions.push(normalizePaperQuestion({
          id: uid(),
          no: questions.length + 1,
          stem: o.stem,
          answer: o.answer,
          tags: o.tags,
        }));
      });
    return normalizePaper({ id: uid(), createdAt: t, updatedAt: t, questions });
  }
```

并在导出对象里加入 `parsePaper,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /workspace
git add lib.js test/lib.test.js
git commit -m "feat: 整卷文本解析 parsePaper"
```

---

## Task 3: 错题转换 paperWrongToQuestion + normalizeQuestion.fromPaper

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

顶部解构补 `paperWrongToQuestion,`，追加：

```js
test('normalizeQuestion 保留 fromPaper 来源', () => {
  const a = normalizeQuestion({ stem: 'x' });
  assert.equal(a.fromPaper, null);
  const b = normalizeQuestion({ stem: 'x', fromPaper: { paperId: 'p1', questionId: 'q1' } });
  assert.deepEqual(b.fromPaper, { paperId: 'p1', questionId: 'q1' });
  const c = normalizeQuestion({ stem: 'x', fromPaper: 'nonsense' });
  assert.equal(c.fromPaper, null);
});

test('paperWrongToQuestion 只挑标错且未加入的题', () => {
  const paper = normalizePaper({
    id: 'p1',
    questions: [
      { stem: 'a', wrong: 'wrong' },
      { stem: 'b', wrong: 'right' },
      { stem: 'c', wrong: 'unset' },
      { stem: 'd', wrong: 'wrong', linkedQid: 'q9' },
    ],
  });
  const out = paperWrongToQuestion(paper, 5000);
  assert.equal(out.length, 1);
  assert.equal(out[0].stem, 'a');
  assert.equal(out[0].analysis, '');
  assert.deepEqual(out[0].tags, []);
  assert.equal(out[0].status, 'new');
  assert.deepEqual(out[0].fromPaper, { paperId: 'p1', questionId: paper.questions[0].id });
  assert.equal(out[0].createdAt, 5000);
});

test('paperWrongToQuestion 无错题时返回空数组', () => {
  const paper = normalizePaper({ questions: [{ stem: 'a', wrong: 'right' }] });
  assert.deepEqual(paperWrongToQuestion(paper, 0), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: FAIL（`fromPaper` 断言失败 / `paperWrongToQuestion is not a function`）

- [ ] **Step 3: 实现**

3a. 修改 `lib.js` 的 `normalizeQuestion`，在 `return { ... }` 中 `updatedAt` 之前插入一行：

```js
      fromPaper: (o.fromPaper && typeof o.fromPaper === 'object' && o.fromPaper.paperId)
        ? { paperId: o.fromPaper.paperId, questionId: o.fromPaper.questionId || null } : null,
```

3b. 在 `parsePaper` 之后插入：

```js
  /* ---------- 把试卷里「标为错题」且尚未加入的题转成错题本条目（纯函数，不改原对象） ---------- */
  function paperWrongToQuestion(paper, now) {
    const t = now || Date.now();
    const qs = (paper && paper.questions) || [];
    return qs
      .filter(q => q.wrong === 'wrong' && !q.linkedQid)
      .map(q => ({
        id: uid(),
        stem: q.stem,
        analysis: '',
        knowledge: '',
        myAnswer: '',
        tags: Array.isArray(q.tags) ? q.tags.slice() : [],
        status: 'new',
        star: false,
        images: [],
        srs: normalizeSrs(undefined),
        createdAt: t,
        updatedAt: t,
        fromPaper: { paperId: paper.id, questionId: q.id },
      }));
  }
```

并在导出对象里加入 `paperWrongToQuestion,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /workspace && node --test test/lib.test.js`
Expected: PASS（含原有 51 条，全绿）

- [ ] **Step 5: 提交**

```bash
cd /workspace
git add lib.js test/lib.test.js
git commit -m "feat: 错题转换 paperWrongToQuestion 与 fromPaper 来源字段"
```

---

## Task 4: 页面骨架（tab + 三个弹层）

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 加「试卷」tab**

在 `index.html` 头部 tabs 里，`<button class="tab" data-view="k">知识点</button>` 之后加一行：

```html
    <button class="tab" data-view="p">试卷</button>
```

- [ ] **Step 2: 加试卷新增弹层**

在 `<!-- 编辑 -->` 那个 `#editModal` 结束标签之后插入：

```html
<!-- 新增试卷（粘贴整卷） -->
<div class="modal" id="paperAddModal">
  <div class="panel">
    <h2>新增试卷（粘贴整卷）</h2>
    <p class="hint">把整卷粘进来：每题用 <b>【题目】</b> 与 <b>【答案】</b>（或【解析】）标记，题与题之间用单独一行 <b>===</b> 分隔。</p>
    <div class="row">
      <input id="paperNameInput" placeholder="试卷名（可留空，默认「未命名试卷」）" style="flex:1">
      <input id="paperAddDate" type="date">
    </div>
    <textarea id="paperRawInput" placeholder="【题目】&#10;…&#10;【答案】&#10;…&#10;===&#10;【题目】&#10;…"></textarea>
    <div class="row">
      <button class="primary" id="paperParseBtn">拆分预览</button>
      <button class="ghost" id="paperAddClose">关闭</button>
      <span class="spacer"></span>
      <span id="paperParseMsg" class="badge-note"></span>
    </div>
    <div class="preview" id="paperPreview"></div>
    <div class="row" style="display:none" id="paperImportRow">
      <button class="primary" id="paperImportBtn">导入本卷</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: 加试卷详情弹层**

紧接上一步插入：

```html
<!-- 试卷详情 -->
<div class="modal" id="paperModal">
  <div class="panel wide">
    <h2 id="paperModalTitle">试卷</h2>
    <div id="paperBody"></div>
    <div class="row">
      <button class="ghost" id="paperDetailClose">关闭</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: 加题目编辑弹层**

紧接上一步插入：

```html
<!-- 试卷题目编辑 -->
<div class="modal" id="paperQModal">
  <div class="panel">
    <h2>编辑题目</h2>
    <div class="row">
      <label style="min-width:56px">题号</label>
      <input id="pqNo" type="number" min="0" step="1">
    </div>
    <label class="section-label">题干（公式用 $...$）</label>
    <textarea id="pqStem"></textarea>
    <label class="section-label">答案（可选）</label>
    <textarea id="pqAnswer"></textarea>
    <div class="row">
      <button class="primary" id="pqSave">保存</button>
      <button class="ghost" id="pqCancel">取消</button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: 手工验证骨架不影响原界面**

Run: 在 `/workspace` 启动本地服务 `python3 -m http.server 8080`
Expected: 打开 `http://localhost:8080/index.html`，头部出现「试卷」tab；点它时不报错（此时尚未接线，视图区可能不变或空白，属预期）。

- [ ] **Step 6: 提交**

```bash
cd /workspace
git add index.html
git commit -m "feat: 试卷栏目页面骨架（tab 与三个弹层）"
```

---

## Task 5: 接入第三个 store / view / DEF 与视图切换

**Files:**
- Modify: `app.js`

- [ ] **Step 1: 加存储 key、引入纯函数**

1a. 在 `const K_K = 'mq_kps';` 下一行加：

```js
const K_P = 'mq_papers';
```

1b. 在顶部 `const { ... } = MQ;` 解构里补 `normalizePaper, parsePaper, paperWrongToQuestion,`。

- [ ] **Step 2: 注册 store 与 loadInitial**

2a. 把 `stores` 定义改为：

```js
const stores = {
  q: { key: K_Q, norm: normalizeQuestion, items: [] },
  k: { key: K_K, norm: normalizeKp, items: [] },
  p: { key: K_P, norm: normalizePaper, items: [] },
};
```

2b. 把 `loadInitial` 里的 `for (const kind of ['q', 'k'])` 改为 `for (const kind of ['q', 'k', 'p'])`，并删除该循环末尾那句 `await persist(key, stores[kind].items);` 之外的种子逻辑依赖——改为：

```js
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
  let t = await kvGet(K_TRASH);
  if (!Array.isArray(t)) t = lsRead(K_TRASH);
  trash = Array.isArray(t) ? t : [];
}
```

- [ ] **Step 3: 加 views.p 与 DEF.p**

3a. 在 `const views = { q: {...}, k: {...} };` 里追加：

```js
  p: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false },
```

3b. 在 `const DEF = { q: {...}, k: {...} };` 里追加：

```js
  p: { noun: '张试卷', addLabel: '+ 新增试卷', randomLabel: '随机一题' },
```

- [ ] **Step 4: render 增加试卷分支**

在 `function render() {` 的函数体第一行插入：

```js
  if (active === 'p') return renderPapers();
```

（`renderPapers` 在 Task 6 实现；本步先临时加一个占位实现，避免报错，Task 6 再替换。）

临时占位（放在 `function render() {` 之前）：

```js
function renderPapers() {
  countEl.textContent = `共 ${stores.p.items.length} 张试卷`;
  listEl.innerHTML = '';
}
```

- [ ] **Step 5: switchView 增加试卷分支**

把 `function switchView(v) { ... }` 整体替换为：

```js
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
  if (isPaper) {
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
```

- [ ] **Step 6: addBtn 增加试卷分支**

把 `addBtn.onclick = () => {` 函数体第一行插入：

```js
  if (active === 'p') { openPaperAdd(); return; }
```

（`openPaperAdd` 在 Task 7 实现；本步先加占位 `function openPaperAdd() {}`，Task 7 替换。）

- [ ] **Step 7: 手工验证**

Run: `cd /workspace && python3 -m http.server 8080`，浏览器打开
Expected:
1. 三个 tab 可切换，切到「试卷」时搜索框/状态筛选/标签/多选/分组/收藏/待复习/随机/背题/AI 按钮都隐藏，只剩「+ 新增试卷」「导出」「导入」「设置」。
2. 切回「错题」「知识点」时原控件恢复，列表正常。
3. 控制台无报错。

- [ ] **Step 8: 提交**

```bash
cd /workspace
git add app.js
git commit -m "feat: 接入试卷 store/view/DEF 与视图切换"
```

---

## Task 6: 试卷列表渲染

**Files:**
- Modify: `app.js`（替换 Task 5 的 `renderPapers` 占位实现）

- [ ] **Step 1: 实现 renderPapers**

把占位 `renderPapers` 替换为：

```js
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
```

（`openPaper` 在 Task 8 实现；本步先在 `renderPapers` 上方加占位 `function openPaper() {}`，Task 8 替换。）

- [ ] **Step 2: 手工验证**

需要一个临时数据：在浏览器控制台执行
```js
localStorage.setItem('mq_papers', JSON.stringify([{ id:'t1', title:'2026秋 月考1', date:'2026-10-10', createdAt:1, updatedAt:2, questions:[{ id:'q1', no:1, stem:'求 $x$', answer:'$x=1$', wrong:'wrong', tags:[], linkedQid:null }] }]));
```
然后刷新页面 → 切到「试卷」
Expected: 出现一张卡片「2026秋 月考1」，显示「1 题」「错 1」「2026-10-10」；点改名/删除可用；删除需确认。

- [ ] **Step 3: 提交**

```bash
cd /workspace
git add app.js
git commit -m "feat: 试卷列表渲染"
```

---

## Task 7: 试卷新增（粘贴整卷导入）

**Files:**
- Modify: `app.js`（替换 Task 5 的 `openPaperAdd` 占位）

- [ ] **Step 1: 实现新增弹层逻辑**

把占位 `function openPaperAdd() {}` 替换为：

```js
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
```

- [ ] **Step 2: 手工验证**

Run: 浏览器打开页面 → 「试卷」→「+ 新增试卷」→ 粘贴：

```
【题目】
求 $x^2=4$ 的解。
【答案】
$x=\pm 2$
===
【题目】
$1+1=$？
【答案】
$2$
```

Expected: 点「拆分预览」显示「解析到 2 题」+ 两题预览；点「导入本卷」后列表出现新试卷（默认名「未命名试卷」或你填的名字），题数 2。

- [ ] **Step 3: 提交**

```bash
cd /workspace
git add app.js
git commit -m "feat: 试卷新增（粘贴整卷导入）"
```

---

## Task 8: 试卷详情（展示 + 三态标记 + 改题/删题）

**Files:**
- Modify: `app.js`（替换 Task 6 的 `openPaper` 占位）

- [ ] **Step 1: 实现详情渲染与交互**

把占位 `function openPaper() {}` 替换为：

```js
let curPaperId = null;
let paperWrongOnly = false;
let pqEditing = null;   // { paperId, questionId }

function paperOf(id) { return stores.p.items.find(p => p.id === id); }

function openPaper(id) {
  curPaperId = id;
  paperWrongOnly = false;
  renderPaperDetail();
  document.getElementById('paperModal').classList.add('open');
}

function renderPaperDetail() {
  const p = paperOf(curPaperId);
  const modal = document.getElementById('paperModal');
  if (!p) { modal.classList.remove('open'); return; }
  document.getElementById('paperModalTitle').textContent = p.title;
  const qs = p.questions.filter(q => !paperWrongOnly || q.wrong === 'wrong');
  const body = document.getElementById('paperBody');
  const wrongN = p.questions.filter(q => q.wrong === 'wrong').length;
  body.innerHTML = `
    <div class="paper-head">
      <input id="paperTitleInput" value="${esc(p.title)}" placeholder="试卷名">
      <input id="paperDateInput" type="date" value="${esc(p.date)}">
    </div>
    <div class="badge-note">共 ${p.questions.length} 题 · 已标错 ${wrongN}${paperWrongOnly ? ' · 仅看错题' : ''}</div>
    <div class="paper-qs">
      ${qs.map(q => `
        <div class="paper-q" data-qid="${q.id}">
          <div class="paper-q-head"><span class="section-label">第 ${q.no} 题</span>
            ${q.linkedQid ? '<span class="badge-note">已在错题本</span>' : ''}</div>
          <div class="paper-q-stem">${renderMath(q.stem) || '（无题干）'}</div>
          ${q.answer ? `<details><summary>查看答案</summary><div class="body">${renderMath(q.answer)}</div></details>` : ''}
          <div class="paper-q-acts">
            <select data-act="wrong" data-qid="${q.id}">
              <option value="unset"${q.wrong === 'unset' ? ' selected' : ''}>未标</option>
              <option value="right"${q.wrong === 'right' ? ' selected' : ''}>做对</option>
              <option value="wrong"${q.wrong === 'wrong' ? ' selected' : ''}>错题</option>
            </select>
            <button class="link" data-act="editq" data-qid="${q.id}">编辑</button>
            <button class="link" data-act="delq" data-qid="${q.id}">删除</button>
          </div>
        </div>`).join('') || '<div class="empty">没有可显示的题。</div>'}
    </div>
    <div class="row paper-foot">
      <button id="paperAllWrong">全部标错</button>
      <button id="paperAllRight">全部标对</button>
      <button id="paperWrongOnly">${paperWrongOnly ? '显示全部' : '仅看错题'}</button>
      <span class="spacer"></span>
      <button class="primary" id="paperToWrong">把已标错题加入错题本</button>
    </div>`;

  const setQ = (qid, patch) => {
    const q = p.questions.find(x => x.id === qid);
    if (!q) return;
    Object.assign(q, patch);
    p.updatedAt = Date.now();
    savePapers();
  };

  document.getElementById('paperTitleInput').onchange = e => {
    p.title = e.target.value.trim() || '未命名试卷';
    p.updatedAt = Date.now();
    savePapers();
    document.getElementById('paperModalTitle').textContent = p.title;
  };
  document.getElementById('paperDateInput').onchange = e => {
    p.date = e.target.value;
    p.updatedAt = Date.now();
    savePapers();
  };
  body.querySelectorAll('select[data-act="wrong"]').forEach(sel => {
    sel.onchange = () => { setQ(sel.dataset.qid, { wrong: sel.value }); renderPaperDetail(); };
  });
  body.querySelectorAll('[data-act="delq"]').forEach(btn => {
    btn.onclick = () => {
      if (!confirm('删除这道题？（若已加入错题本，错题条目会保留）')) return;
      p.questions = p.questions.filter(x => x.id !== btn.dataset.qid);
      p.updatedAt = Date.now();
      savePapers();
      renderPaperDetail();
    };
  });
  body.querySelectorAll('[data-act="editq"]').forEach(btn => {
    btn.onclick = () => openPaperQ(p.id, btn.dataset.qid);
  });
  document.getElementById('paperAllWrong').onclick = () => {
    p.questions.forEach(q => { q.wrong = 'wrong'; });
    p.updatedAt = Date.now(); savePapers(); renderPaperDetail();
  };
  document.getElementById('paperAllRight').onclick = () => {
    p.questions.forEach(q => { q.wrong = 'right'; });
    p.updatedAt = Date.now(); savePapers(); renderPaperDetail();
  };
  document.getElementById('paperWrongOnly').onclick = () => { paperWrongOnly = !paperWrongOnly; renderPaperDetail(); };
  document.getElementById('paperToWrong').onclick = addPaperWrongToBook;
}

document.getElementById('paperDetailClose').onclick = () => {
  document.getElementById('paperModal').classList.remove('open');
  renderPapers();
};
document.getElementById('paperModal').onclick = e => {
  if (e.target === document.getElementById('paperModal')) { document.getElementById('paperModal').classList.remove('open'); renderPapers(); }
};

/* 题目编辑小弹层 */
function openPaperQ(paperId, qid) {
  const p = paperOf(paperId);
  const q = p && p.questions.find(x => x.id === qid);
  if (!q) return;
  pqEditing = { paperId, questionId: qid };
  document.getElementById('pqNo').value = q.no;
  document.getElementById('pqStem').value = q.stem;
  document.getElementById('pqAnswer').value = q.answer;
  document.getElementById('paperQModal').classList.add('open');
}
document.getElementById('pqCancel').onclick = () => document.getElementById('paperQModal').classList.remove('open');
document.getElementById('pqSave').onclick = () => {
  if (!pqEditing) return;
  const p = paperOf(pqEditing.paperId);
  const q = p && p.questions.find(x => x.id === pqEditing.questionId);
  if (q) {
    const no = parseInt(document.getElementById('pqNo').value, 10);
    q.no = Number.isFinite(no) ? no : q.no;
    q.stem = document.getElementById('pqStem').value;
    q.answer = document.getElementById('pqAnswer').value;
    p.updatedAt = Date.now();
    savePapers();
  }
  pqEditing = null;
  document.getElementById('paperQModal').classList.remove('open');
  renderPaperDetail();
};
```

（`addPaperWrongToBook` 在 Task 9 实现；本步先在 `openPaper` 之前加占位 `function addPaperWrongToBook() {}`，Task 9 替换。）

- [ ] **Step 2: 手工验证**

浏览器打开刚导入的试卷 → 「打开」
Expected:
1. 题号 + 题干按顺序显示，答案可折叠展开。
2. 每题的「未标/做对/错题」下拉可切换，关闭再打开状态保持。
3. 「全部标错」「仅看错题」生效；「编辑」「删除」可用；删除后题号不重排（保持原 no）。
4. 顶部试卷名与日期可改并即时保存。

- [ ] **Step 3: 提交**

```bash
cd /workspace
git add app.js
git commit -m "feat: 试卷详情展示与逐题标记"
```

---

## Task 9: 把已标错题加入错题本

**Files:**
- Modify: `app.js`（替换 Task 8 的 `addPaperWrongToBook` 占位）

- [ ] **Step 1: 实现**

把占位 `function addPaperWrongToBook() {}` 替换为：

```js
function addPaperWrongToBook() {
  const p = paperOf(curPaperId);
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
  renderPaperDetail();
  alert(`已加入错题本 ${added.length} 道（解析留空，可在错题本里用「复制提示词」让 AI 补解析）。`);
}
```

- [ ] **Step 2: 错题卡片显示来源并可回跳原卷**

修改 `app.js` 的 `makeCard`：在 `const due = ...` 之后加一行

```js
  const src = it.fromPaper
    ? `<span class="relchip" data-frompaper="1" title="来自试卷，点击查看原卷">来自试卷</span>` : '';
```

并把插值那一行 `${tags}${rel}` 改为 `${tags}${rel}${src}`。

再在同函数中 `const relEl = card.querySelector('[data-rel]');` 那段绑定之后加：

```js
  const srcEl = card.querySelector('[data-frompaper]');
  if (srcEl) srcEl.onclick = () => {
    if (it.fromPaper && paperOf(it.fromPaper.paperId)) openPaper(it.fromPaper.paperId);
    else alert('原试卷已删除。');
  };
```

（复用现有 `.relchip` 样式，无需新增 CSS。）

- [ ] **Step 3: 手工验证**

浏览器打开试卷 → 标 2 题为「错题」→ 点「把已标错题加入错题本」
Expected:
1. 提示「已加入错题本 2 道」。
2. 切到「错题」栏目，出现这 2 道题（题干为原题，无解析）；卡片上有「来自试卷」标签。
3. 点「来自试卷」标签 → 直接打开原试卷详情。
4. 再次点「加入错题本」提示「没有可加入的题」。
5. 试卷里这两题显示「已在错题本」。

- [ ] **Step 4: 提交**

```bash
cd /workspace
git add app.js
git commit -m "feat: 试卷错题一键加入错题本"
```

---

## Task 10: 样式与离线缓存版本

**Files:**
- Modify: `styles.css`
- Modify: `sw.js`

- [ ] **Step 1: 加样式**

在 `styles.css` 末尾追加：

```css
/* ---------- 试卷栏目 ---------- */
.paper-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.paper-card { cursor: pointer; }
.paper-head { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.paper-head input { flex: 1; min-width: 140px; }
.paper-qs { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.paper-q { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.paper-q-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.paper-q-stem { margin-bottom: 8px; }
.paper-q-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.paper-foot { flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.modal .panel.wide { max-width: 860px; width: 92vw; max-height: 88vh; overflow: auto; }
```

（`.modal`、`.panel`、`--line` 变量均为现有样式，无需新增。）

- [ ] **Step 2: 升缓存版本**

把 `sw.js` 第 3 行改为：

```js
const CACHE = 'math-review-v6';
```

- [ ] **Step 3: 手工验证样式**

浏览器强刷（Ctrl+F5）后打开试卷列表与详情
Expected: 试卷卡片栅格排版正常；详情弹层更宽、可滚动；移动端（窄屏）不溢出。

- [ ] **Step 4: 提交**

```bash
cd /workspace
git add styles.css sw.js
git commit -m "style: 试卷栏目样式与离线缓存版本升级"
```

---

## Task 11: 全量回归与端到端验证

**Files:**
- 无新增改动（仅验证）

- [ ] **Step 1: 跑单测**

Run: `cd /workspace && node --test test/*.test.js`
Expected: PASS，总数 = 原 51 + 新增（约 10 条），`fail 0`

- [ ] **Step 2: 浏览器端到端手测清单**

Run: `cd /workspace && python3 -m http.server 8080`，浏览器打开 `http://localhost:8080/index.html`

逐项确认：
1. 三 tab 切换正常，试卷栏目隐藏无关控件
2. 粘贴整卷 → 预览题数正确 → 导入 → 列表出现试卷
3. 打开试卷 → 题干/答案渲染正常（含 `$$...$$` 跨行矩阵、`$...$` 行内、裸公式）
4. 逐题标记 / 全部标错 / 仅看错题 / 编辑 / 删除
5. 加入错题本 → 错题栏目出现对应条目，回链正确；重复加入被拦截
6. 删除试卷后，已加入的错题条目仍在
7. 刷新页面后试卷与其标记状态保持（IndexedDB 持久化生效）
8. 控制台无报错

- [ ] **Step 3: 提交（若有手测中产生的小修）并推送**

```bash
cd /workspace
git add -A
git commit -m "test: 试卷栏目端到端验证通过" || echo "无改动"
git push origin HEAD:trae/agent-85oW5K
git push origin HEAD:main
```

---

## 自查（spec 对照）

| 规格条目 | 对应任务 |
| --- | --- |
| 新增 `mq_papers` 存储与数据模型 | Task 1、Task 5 |
| 第三个「试卷」栏目 | Task 4、Task 5 |
| 整卷粘贴导入（`===` 分隔，题干+答案） | Task 2、Task 7 |
| 试卷列表（题数/错题数/日期） | Task 6 |
| 详情展示（题干 + 可折叠答案） | Task 8 |
| 三态标记（未标/对/错）+ 批量按钮 | Task 8 |
| 一键把错题加入错题本（解析留空、回链、判重） | Task 3、Task 9 |
| 错题卡片显示来源并可回跳原卷 | Task 9 |
| `fromPaper` 来源字段与向后兼容 | Task 3 |
| 边界：缺答案 / 无题块 / 空输入 / 同名提示 / 删卷保留错题 | Task 2、Task 7、Task 6、Task 8、Task 9 |
| 测试计划（纯函数单测） | Task 1–3、Task 11 |

**YAGNI（不在本计划内）**：PDF 解析、图片裁剪、试卷题目自动 SRS、跨试卷统计、在线 AI 直连整卷、试卷导出/打印（规格 §12 暂不做）；「整卷识别」提示词按钮与试卷内搜索筛选（规格 §10 阶段 2）。
