# 试卷「打开后」重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把试卷「打开」从拥挤的小弹窗改为全屏试卷页（判分 / 重做 + 可选专注模式 + 右侧题号导航），并把「编辑题目」拆成独立的编辑页入口。

**Architecture:** 新增两个全屏容器 `#paperView`（做题/判分）与 `#paperEdit`（改题），用固定定位的 CSS Grid 布局承载工具栏 / 题号导航条 / 题区 / 底栏。所有渲染与状态集中在 app.js 的一个新「试卷」代码块里（`paperState` 对象 + 一组 `renderPaper*` 函数）；不依赖 DOM 的决策（`nextUnmarked` / `paperProgress`）抽到 lib.js 并做单测。`papers` 数据结构与导入导出格式完全不变。

**Tech Stack:** 纯前端（vanilla JS + CSS，IndexedDB/localStorage，Node 内置 test runner）

---

## 文件结构

| 文件 | 职责 | 改动 |
| --- | --- | --- |
| `lib.js` | 纯逻辑（无 DOM）。新增并导出 `nextUnmarked(questions, fromId)` 与 `paperProgress(questions)` | 修改（在试卷段之后追加函数 + 导出表） |
| `test/lib.test.js` | lib.js 单测。新增上述两个函数的用例 | 修改（解构列表 + 试卷段追加用例） |
| `index.html` | 新增全屏 `#paperView`、`#paperEdit` 的 DOM；删除旧的小弹窗 `#paperModal`（`#paperQModal` 保留，供编辑页复用） | 修改 |
| `app.js` | 新增「试卷」代码块：`paperState`、`openPaper`/`closePaperView`、`renderPaperView`、`renderPaperNav`、`renderPaperList`、`renderPaperFocus`、`renderPaperEdit`、键盘处理、`addPaperWrongToBook` 重写、卡片「编辑」按钮 | 修改（替换旧 `renderPaperDetail` 段） |
| `styles.css` | 新增 `.paperview*` / `.paper-nav*` / `.paper-focus*` / `.paperedit*` / `.paper-toast` 样式与窄屏适配 | 修改（追加到「试卷栏目」段附近） |
| `README.md` | 不改 | — |
| `papers-data.json` / `sw.js` / 导入导出 | 不改（YAGNI） | — |

---

### Task 1: lib.js 新增 `nextUnmarked`（纯函数 + 单测）

**Files:**
- Modify: `lib.js:264`（在 `paperWrongToQuestion` 之后插入）
- Modify: `lib.js:588`（导出表）
- Test: `test/lib.test.js:13`（解构）+ `test/lib.test.js:274`（用例）

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 第 13 行的解构里追加 `nextUnmarked`（把原行改为）：

```js
  normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers, paperWrongToQuestion, nextUnmarked,
```

在 `test/lib.test.js` 第 274 行（`paperWrongToQuestion 无错题时返回空数组` 用例之后）追加：

```js
test('nextUnmarked 从 fromId 之后返回第一个未标题', () => {
  const qs = [
    { id: 'a', wrong: 'right' },
    { id: 'b', wrong: 'unset' },
    { id: 'c', wrong: 'unset' },
  ];
  assert.equal(nextUnmarked(qs, 'a').id, 'b');
  assert.equal(nextUnmarked(qs, 'b').id, 'c');
});

test('nextUnmarked 到末尾后回绕到开头', () => {
  const qs = [
    { id: 'a', wrong: 'unset' },
    { id: 'b', wrong: 'right' },
    { id: 'c', wrong: 'right' },
  ];
  assert.equal(nextUnmarked(qs, 'c').id, 'a');       // 末尾回绕
});

test('nextUnmarked 不含当前题本身，唯一未标题回绕到自身', () => {
  const qs = [
    { id: 'a', wrong: 'unset' },
    { id: 'b', wrong: 'unset' },
  ];
  assert.equal(nextUnmarked(qs, 'a').id, 'b');       // 跳过自身
  assert.equal(nextUnmarked([{ id: 'only', wrong: 'unset' }], 'only').id, 'only');  // 回绕到自身
});

test('nextUnmarked 全部已标返回 null，fromId 不存在时从开头找', () => {
  const all = [
    { id: 'a', wrong: 'right' },
    { id: 'b', wrong: 'wrong' },
  ];
  assert.equal(nextUnmarked(all, 'a'), null);
  assert.equal(nextUnmarked([], 'x'), null);
  const qs = [
    { id: 'a', wrong: 'unset' },
    { id: 'b', wrong: 'right' },
  ];
  assert.equal(nextUnmarked(qs, 'nope').id, 'a');    // fromId 不存在 → 从头找
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: FAIL —— 出现 `TypeError: nextUnmarked is not a function`（新用例报错），其余 77 条通过。

- [ ] **Step 3: 最小实现**

在 `lib.js` 第 264 行之后（`paperWrongToQuestion` 的 `}` 之后、`/* ---------- 搜索语法` 注释之前）插入：

```js
  /* 从 fromId 之后向后找第一个 wrong==='unset' 的题；到末尾回绕到开头；
     fromId 不存在时从开头找；全部已标则返回 null。 */
  function nextUnmarked(questions, fromId) {
    const qs = Array.isArray(questions) ? questions : [];
    const n = qs.length;
    if (!n) return null;
    const start = qs.findIndex(q => q.id === fromId);
    const base = start < 0 ? -1 : start;              // 不存在时 base=-1，从索引 0 开始
    for (let k = 1; k <= n; k++) {
      const i = (base + k + n) % n;
      if (qs[i] && qs[i].wrong === 'unset') return qs[i];
    }
    return null;
  }
```

在 `lib.js` 第 588 行（导出表里 `paperWrongToQuestion,` 之后）追加一行：

```js
    nextUnmarked,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: PASS —— `ℹ tests 81`、`ℹ pass 81`、`ℹ fail 0`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): add nextUnmarked for jumping to next unmarked paper question"
```

---

### Task 2: lib.js 新增 `paperProgress`（纯函数 + 单测）

**Files:**
- Modify: `lib.js`（追加函数 + 导出）
- Test: `test/lib.test.js`（解构 + 用例）

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 解构列表里（Task 1 追加的那一行之后）追加 `paperProgress,`，即新增一行：

```js
  paperProgress,
```

在 `test/lib.test.js` 的试卷段（`nextUnmarked` 用例之后）追加：

```js
test('paperProgress 统计对/错/未标与已标数', () => {
  const qs = [
    { wrong: 'right' }, { wrong: 'right' }, { wrong: 'wrong' }, { wrong: 'unset' },
  ];
  const pr = paperProgress(qs);
  assert.equal(pr.total, 4);
  assert.equal(pr.right, 2);
  assert.equal(pr.wrong, 1);
  assert.equal(pr.unset, 1);
  assert.equal(pr.marked, 3);
});

test('paperProgress 空与非法入参安全，缺字段按未标计', () => {
  assert.deepEqual(paperProgress([]), { total: 0, right: 0, wrong: 0, unset: 0, marked: 0 });
  assert.deepEqual(paperProgress(null), { total: 0, right: 0, wrong: 0, unset: 0, marked: 0 });
  assert.equal(paperProgress([{ id: 'a' }]).unset, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: FAIL —— 出现 `TypeError: paperProgress is not a function`。

- [ ] **Step 3: 最小实现**

在 `lib.js` 的 `nextUnmarked` 函数之后（Task 1 插入的代码块下方）追加：

```js
  /* 统计整卷三态：total 题数、right/wrong/unset 各计数、marked = right + wrong */
  function paperProgress(questions) {
    const qs = Array.isArray(questions) ? questions : [];
    let right = 0, wrong = 0, unset = 0;
    for (const q of qs) {
      if (q && q.wrong === 'right') right++;
      else if (q && q.wrong === 'wrong') wrong++;
      else unset++;
    }
    return { total: qs.length, right, wrong, unset, marked: right + wrong };
  }
```

在 `lib.js` 导出表里 `nextUnmarked,` 之后追加一行：

```js
    paperProgress,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: PASS —— `ℹ tests 83`、`ℹ pass 83`、`ℹ fail 0`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): add paperProgress for paper three-state summary"
```

---

### Task 3: index.html 新增全屏 `#paperView` 与 `#paperEdit` 容器

**Files:**
- Modify: `index.html:178-187`（在旧 `#paperModal` 之前插入新容器；本任务**先保留** `#paperModal`，Task 4 一并删除）

- [ ] **Step 1: 插入全屏试卷页容器**

在 `index.html` 第 178 行的注释 `<!-- 试卷详情 -->` 之前插入：

```html
<!-- 全屏试卷页（打开后：判分 / 重做，可叠加专注模式） -->
<div class="paperview" id="paperView">
  <div class="paperview-bar">
    <button class="ghost" id="paperBack">‹ 返回</button>
    <span class="paperview-title" id="paperViewTitle"></span>
    <span class="spacer"></span>
    <div class="seg" id="paperModeSec">
      <button data-mode="grade">判分</button>
      <button data-mode="redo">重做</button>
    </div>
    <button id="paperFocusBtn" title="一题一屏">专注</button>
    <button id="paperWrongOnlyBtn">仅看错题</button>
    <button id="paperAnsBtn">显示答案</button>
    <button class="primary" id="paperToWrongBtn">加入错题本</button>
  </div>
  <div class="paperview-nav" id="paperNav"></div>
  <div class="paperview-body">
    <div class="paperview-qs" id="paperQs"></div>
    <div class="paperview-focus" id="paperFocus"></div>
  </div>
  <div class="paperview-foot" id="paperFoot"></div>
</div>

<!-- 试卷编辑页（从卡片「编辑」进入；做题/判分界面不提供改题能力） -->
<div class="paperedit" id="paperEdit">
  <div class="paperedit-bar">
    <button class="ghost" id="paperEditBack">‹ 返回</button>
    <span class="section-label">编辑试卷</span>
  </div>
  <div class="paperedit-body" id="paperEditBody"></div>
</div>
```

- [ ] **Step 2: 浏览器自检（不报错）**

Run: `python3 -m http.server 8080`（工作目录 `/workspace`，非阻塞），浏览器打开 `http://localhost:8080`。
Expected: 页面正常加载；打开 DevTools Console 无报错（新容器默认 `display:none`，不可见）。切到「试卷」tab 仍能显示旧弹窗，功能未受影响。

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "feat(paper): add fullscreen paper view and edit page containers"
```

---

### Task 4: app.js 试卷核心（状态、打开/关闭、工具栏、判分/重做列表、题号导航、跳题；并删除旧弹窗）

**Files:**
- Modify: `app.js:15-25`（解构导入追加 `nextUnmarked, paperProgress`）
- Modify: `app.js:823-954`（用整块新代码替换：`let curPaperId = null;` 到 `#paperModal` 的 `onclick` 处理器结尾）
- Modify: `app.js:982`（`pqSave` 里删掉对已移除的 `renderPaperDetail()` 的调用）
- Modify: `index.html:178-187`（删除旧的 `#paperModal` 块）

> 说明：`renderPaperView` 在本任务只渲染「一览整卷」；`#paperFocusBtn` 暂不接线、专注分支留到 Task 6。`#paperEdit` 相关留到 Task 7。

- [ ] **Step 1: 追加纯函数导入**

把 `app.js` 第 20 行改为（在其后追加两个名字）：

```js
  normalizePaper, parsePaper, paperWrongToQuestion, mergeSeedPapers,
  nextUnmarked, paperProgress,
```

- [ ] **Step 2: 整体替换旧试卷详情代码块**

用下面这一整块，替换 `app.js` 从第 823 行 `let curPaperId = null;` 到第 954 行（`#paperModal` 的 `onclick` 处理器结束的 `};`）的全部内容：

```js
/* ===================== 试卷：全屏试卷页（打开后）===================== */

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
  renderPaperList(p, qs, document.getElementById('paperQs'));

  const footEl = document.getElementById('paperFoot');
  footEl.innerHTML = '<span class="spacer"></span><button class="primary" id="paperNextUnmarked">跳到下一道未标</button>';
  footEl.querySelector('#paperNextUnmarked').onclick = jumpToNextUnmarked;

  const body2 = document.querySelector('.paperview-body');
  if (body2) body2.scrollTop = keepTop;
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
  added.forEach(it => stores.q.items.push(it));
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
}

document.getElementById('paperBack').onclick = closePaperView;
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
```

- [ ] **Step 3: 处理 `pqSave` 对已移除函数的调用**

在 `app.js`（原第 982 行）`pqSave` 里，删掉结尾这一行：

```js
  renderPaperDetail();
```

即让 `document.getElementById('paperQModal').classList.remove('open');` 之后直接结束（编辑页重渲染在 Task 7 补上）。

- [ ] **Step 4: 删除旧的小弹窗 DOM**

删除 `index.html` 第 178–187 行的整块：

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

保留紧随其后的 `#paperQModal`（第 189 行起）。

- [ ] **Step 5: 浏览器自检（判分 + 导航 + 跳题 + 仅看错题）**

Run: `python3 -m http.server 8080`（工作目录 `/workspace`），浏览器打开 `http://localhost:8080` → 点「试卷」tab → 任一试卷卡片点「打开」。
Expected:
- 出现全屏试卷页，「判分」高亮；有答案的题**直接显示答案块**。
- 点某题「对」→ 该题三态切到「对」，右侧题号方块变蓝，导航条顶部 `已标` 计数 +1。
- 点某题「错」→ 方块变橙，顶部「错 m」+1。
- 点右侧题号方块 → 页面滚动定位到该题（该方块高亮）。
- 点底部「跳到下一道未标」→ 跳到下一个「未标」题；当无未标题时弹出提示「已无未标」。
- 点工具栏「仅看错题」→ 题目区与题号只保留错题；再点恢复。
- DevTools Console 无报错；`#paperModal` 已不存在。

- [ ] **Step 6: 提交**

```bash
git add app.js index.html
git commit -m "feat(paper): fullscreen paper view with grading toggles, nav bar and jump-to-unmarked"
```

---

### Task 5: app.js 键盘快捷键（试卷页打开且焦点不在输入框时生效）

**Files:**
- Modify: `app.js:2198-2207`（全局 `keydown` 处理器）

- [ ] **Step 1: 新增试卷键盘处理函数**

在 `app.js` 的 `addPaperWrongToBook` 之后（即 Task 4 代码块末尾、`document.getElementById('paperBack').onclick` 之前）插入：

```js
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
```

- [ ] **Step 2: 接入全局 keydown**

把 `app.js` 第 2198–2207 行的处理器改为（在 cram 分支之后、设置抽屉分支之前插入试卷分支）：

```js
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
```

- [ ] **Step 3: 浏览器自检（快捷键）**

Run: `python3 -m http.server 8080`，打开 `http://localhost:8080` → 试卷 tab → 卡片「打开」。
Expected:
- 焦点在页面空白处：按 `1` → 当前题标对；`2` → 标错；`0` → 未标；方块颜色随之变化。
- 按 `↓` 或 `n` → 跳到下一题（方块高亮 + 滚动）；按 `↑` 或 `p` → 上一题。
- 聚焦某题的输入控件（例如打开编辑页的输入框后再打开试卷页不现实，可改为在页面里点进任意 `input` 后按键）时按键**不**触发标对错——验证焦点在 `input` 时不生效。
- 按 `Esc` → 关闭试卷页回到列表。
- 关闭试卷页后按 `1/2/0` → 不产生任何效果（试卷页未打开）。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat(paper): keyboard shortcuts for grading and navigation"
```

---

### Task 6: app.js 专注模式（一题一屏）

**Files:**
- Modify: `app.js`（新增 `renderPaperFocus`；改 `renderPaperView` 的题区/底栏分支；接线 `#paperFocusBtn`）

- [ ] **Step 1: 新增专注模式渲染函数**

在 `app.js` 的 `paperRenderAnswer` 函数之后插入：

```js
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
```

- [ ] **Step 2: 改 `renderPaperView` 的题区与底栏分支**

把 Task 4 中 `renderPaperView` 里这两段：

```js
  renderPaperNav(p, qs);
  renderPaperList(p, qs, document.getElementById('paperQs'));

  const footEl = document.getElementById('paperFoot');
  footEl.innerHTML = '<span class="spacer"></span><button class="primary" id="paperNextUnmarked">跳到下一道未标</button>';
  footEl.querySelector('#paperNextUnmarked').onclick = jumpToNextUnmarked;
```

替换为：

```js
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
```

- [ ] **Step 3: 接线专注开关**

在 Task 4 代码块里 `document.getElementById('paperBack').onclick = closePaperView;` 之后追加：

```js
document.getElementById('paperFocusBtn').onclick = () => { paperState.focus = !paperState.focus; renderPaperView(); };
```

- [ ] **Step 4: 浏览器自检（专注模式）**

Run: `python3 -m http.server 8080`，打开 `http://localhost:8080` → 试卷 tab → 卡片「打开」→ 点「专注」。
Expected:
- 题目区切为一题一屏：顶部进度条 + `第 N 题` + `x / n`；题干（答案按当前模式处理）；两个大按钮「做对 / 做错」。
- 点「做对」→ 该题标对，题号方块变蓝；点「下一题」→ 切到下一题，进度条增长、`x / n` 递增；点「上一题」→ 返回。
- 专注页**没有**「编辑 / 删除」题目入口。
- 专注模式叠加「仅看错题」→ 仅展示错题，导航只在错题间移动。
- 专注模式叠加「重做」→ 答案仍默认遮住，「显示答案」可用。
- 再点「专注」→ 回到一览整卷。

- [ ] **Step 5: 提交**

```bash
git add app.js
git commit -m "feat(paper): focus mode (one question per screen) with big grade/redo buttons"
```

---

### Task 7: app.js 编辑页（改题入口，做题界面不再可改题）

**Files:**
- Modify: `app.js`（新增 `paperEditState` / `openPaperEdit` / `closePaperEdit` / `renderPaperEdit`；接线 `#paperEditBack`；重写 `openPaperQ` 与 `pqSave`）

- [ ] **Step 1: 新增编辑页渲染与开关**

在 `app.js` 的 `renderPaperFocus` 之后插入：

```js
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
          ${q.answer ? `<div class="body">${renderMath(q.answer)}</div>` : ''}
        </div>`).join('') || '<div class="empty">这张试卷还没有题目。</div>'}
    </div>`;
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
```

- [ ] **Step 2: 重写单题编辑弹层（`openPaperQ` 与 `pqSave`）**

把 `app.js` 第 957–983 行改为：

```js
/* 题目编辑小弹层：仅供编辑页调用 */
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
  if (pqEditing) {
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
    renderPaperEdit();
  }
};
```

- [ ] **Step 3: 浏览器自检（编辑页）**

> 本任务尚未在卡片上加「编辑」按钮（Task 8 加）。为验证本任务，先在 Console 执行 `openPaperEdit(stores.p.items[0].id)`（需先切到试卷 tab，任选一张）。

Run: `python3 -m http.server 8080`，打开 `http://localhost:8080` → 试卷 tab。
Expected:
- 执行 `openPaperEdit(stores.p.items[0].id)` 后出现全屏编辑页：标题/日期输入 + 逐题「编辑 / 删除」。
- 改标题后失焦 → 关闭（返回）→ 列表卡片标题已更新。
- 点某题「编辑」→ 弹出单题编辑弹层 → 改题干/答案/题号 → 保存 → 编辑页刷新显示新内容。
- 点某题「删除」→ 确认后该题从编辑页消失。
- 打开同一张试卷的「打开」全屏页，确认**没有**任何改题入口。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat(paper): standalone paper edit page reusing the question editor"
```

---

### Task 8: app.js 卡片新增「编辑」按钮

**Files:**
- Modify: `app.js:1009-1013`（卡片 `cardacts` HTML）
- Modify: `app.js:1020-1043`（卡片事件委托）

- [ ] **Step 1: 卡片 HTML 加「编辑」按钮**

把 `renderPapers` 里卡片的 `cardacts` 段（`app.js` 约 1009–1013 行）改为：

```js
        <div class="cardacts">
          <button class="link" data-act="open">打开</button>
          <button class="link" data-act="edit">编辑</button>
          <button class="link" data-act="rename">改名</button>
          <button class="link" data-act="delete">删除</button>
        </div>
```

- [ ] **Step 2: 事件委托加 `edit` 分支**

在 `renderPapers` 的 `card.onclick` 处理里，`if (act === 'delete') { ... }` 之前插入：

```js
      if (act === 'edit') { openPaperEdit(paper.id); return; }
```

（`open` 与默认分支仍走 `openPaper(paper.id)`，保持 `act === 'open'` 与无 `act` 两种点击都进入全屏试卷页。）

- [ ] **Step 3: 浏览器自检（卡片入口）**

Run: `python3 -m http.server 8080`，打开 `http://localhost:8080` → 试卷 tab。
Expected:
- 每张卡片操作行显示：`打开 编辑 改名 删除`。
- 点「打开」→ 进入全屏试卷页（判分模式）。
- 点「编辑」→ 进入编辑页，可改题。
- 点「改名」→ 弹出改名输入，确认后卡片标题更新。
- 点「删除」→ 确认后卡片消失。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat(paper): add 编辑 button to paper cards"
```

---

### Task 9: styles.css 全屏试卷页 / 导航条 / 专注模式 / 编辑页样式

**Files:**
- Modify: `styles.css:432`（在「试卷栏目」段 `.modal .panel.wide` 之后追加）

- [ ] **Step 1: 追加样式**

在 `styles.css` 第 432 行之后追加：

```css
/* ---------- 全屏试卷页 ---------- */
.paperview{
  position:fixed; inset:0; z-index:65; background:var(--bg);
  display:none; grid-template-columns:1fr;
  grid-template-rows:auto auto 1fr auto;
  grid-template-areas:"bar" "nav" "body" "foot";
}
.paperview.open{display:grid;}
.paperview-bar{
  grid-area:bar; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  padding:10px 16px; border-bottom:1px solid var(--line); background:var(--header-bg);
}
.paperview-title{
  font-size:15px; font-weight:700; max-width:40vw;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.paperview-nav{grid-area:nav; padding:8px 16px; border-bottom:1px solid var(--line); background:var(--card);}
.paper-nav-head{display:flex; align-items:center; gap:10px; margin-bottom:6px;}
.paper-nav-grid{display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:2px;}
.paper-nav-sq{
  flex:none; width:30px; height:30px; padding:0; font-size:12px; border-radius:8px;
  border:1px solid var(--line); background:var(--sunken); color:var(--text);
}
.paper-nav-sq.right{background:var(--brand-soft); border-color:var(--brand); color:var(--brand);}
.paper-nav-sq.wrong{background:var(--warn-bg); border-color:var(--warn); color:var(--warn);}
.paper-nav-sq.unset{color:var(--muted);}
.paper-nav-sq.cur{outline:2px solid var(--brand); outline-offset:1px;}
.paperview-body{grid-area:body; overflow:auto; padding:18px 16px; touch-action:pan-y;}
.paperview-qs{max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:12px;}
.paperview-foot{
  grid-area:foot; display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding:12px 16px; border-top:1px solid var(--line); background:var(--card);
}
.paperview-foot .primary{flex:1; min-width:160px;}
.paper-q-answer{margin:8px 0; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--card-2);}
.paper-q-answer .section-label{display:block; margin-bottom:4px;}
.paper-reveal{
  display:block; width:100%; margin:8px 0; padding:10px;
  border:1px dashed var(--line); border-radius:10px; background:var(--card-2);
  color:var(--brand); font-weight:600; font-size:13px; text-align:center;
}
.paper-tri{display:inline-flex; background:var(--sunken); border-radius:10px; padding:3px; gap:3px;}
.paper-tri button{border:none; background:transparent; padding:6px 14px; border-radius:8px; font-size:13px; color:var(--muted);}
.paper-tri button.on.right{background:var(--brand); color:#fff;}
.paper-tri button.on.wrong{background:var(--warn); color:#fff;}
.paper-tri button.on.unset{background:var(--card); color:var(--text-2); box-shadow:var(--seg-shadow);}

.paper-toast{
  position:absolute; left:50%; bottom:80px; transform:translateX(-50%) translateY(8px);
  background:var(--card); border:1px solid var(--line); border-radius:20px;
  padding:8px 18px; font-size:13px; color:var(--text); box-shadow:var(--shadow-lg);
  opacity:0; pointer-events:none; transition:.2s;
}
.paper-toast.show{opacity:1; transform:translateX(-50%);}

/* ---------- 专注模式 ---------- */
.paper-focus-progress{height:6px; background:var(--sunken); border-radius:3px; overflow:hidden; max-width:860px; margin:0 auto 16px;}
.paper-focus-bar{height:100%; background:var(--brand); transition:width .2s;}
.paper-focus-card{max-width:760px; margin:0 auto;}
.paper-focus-head{display:flex; align-items:center; gap:8px; margin-bottom:10px;}
.paper-focus-card .paper-q-stem{font-size:calc(var(--stem-size) + 3px); line-height:1.8;}
.paper-focus-acts{display:flex; gap:12px; margin-top:20px;}
.paper-big{flex:1; padding:18px; font-size:16px; font-weight:700; border-radius:14px;}
.paper-big.right.on{background:var(--brand); color:#fff; border-color:var(--brand);}
.paper-big.wrong.on{background:var(--warn); color:#fff; border-color:var(--warn);}

/* 宽屏：题号导航条常驻右侧；窄屏：收为顶部横条 */
@media (min-width: 1024px){
  .paperview{
    grid-template-columns:1fr auto;
    grid-template-rows:auto 1fr auto;
    grid-template-areas:"bar bar" "body nav" "foot foot";
  }
  .paperview-nav{width:210px; border-bottom:none; border-left:1px solid var(--line);}
  .paper-nav-grid{flex-wrap:wrap; overflow:visible;}
}

/* ---------- 试卷编辑页 ---------- */
.paperedit{
  position:fixed; inset:0; z-index:66; background:var(--bg);
  display:none; grid-template-rows:auto 1fr;
}
.paperedit.open{display:grid;}
.paperedit-bar{
  display:flex; align-items:center; gap:10px; padding:10px 16px;
  border-bottom:1px solid var(--line); background:var(--header-bg);
}
.paperedit-body{overflow:auto; padding:18px 16px;}
.paperedit-head{display:flex; gap:8px; flex-wrap:wrap; max-width:860px; margin:0 auto 14px;}
.paperedit-head input{flex:1; min-width:140px;}
.paperedit-qs{max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:12px;}
.paperedit-q{border:1px solid var(--line); border-radius:10px; padding:10px 12px;}
```

- [ ] **Step 2: 浏览器自检（版式）**

Run: `python3 -m http.server 8080`，打开 `http://localhost:8080`。
Expected:
- 宽屏（≥1024px）：打开试卷页后题号导航条在**右侧**常驻；工具栏一行排布。
- 把窗口缩到 <1024px：题号导航条变为**顶部横条**（可横向滚动）；工具栏允许换行。
- 打开专注模式：顶部进度条可见，大按钮「做对/做错」并排、占满宽度。
- 点「跳到下一道未标」而无未标题时，底部出现圆角提示条「已无未标」并在约 1.6 秒后淡出。

- [ ] **Step 3: 提交**

```bash
git add styles.css
git commit -m "style(paper): fullscreen paper view, nav bar, focus mode and edit page"
```

---

### Task 10: 浏览器验收（四条路径）

**Files:** 无（仅人工验证；不改代码）

- [ ] **Step 1: 启动本地静态服务器**

Run: `python3 -m http.server 8080`（工作目录 `/workspace`；仓库无 `package.json`，故用 Python 内置静态服务器；端口 8080）
Expected: 输出 `Serving HTTP on 0.0.0.0 port 8080 ...`，浏览器可打开 `http://localhost:8080`。

- [ ] **Step 2: 判分路径**

「试卷」tab → 卡片「打开」→
Expected: 默认「判分」高亮、答案可见；点「对 / 错」更新方块颜色与 `已标 x / 共 n`、`错 m`；按 `1/2/0`、`↑/↓`（或 `n/p`）生效（焦点不在输入框时）；点题号方块滚动定位；点「跳到下一道未标」跳题、无未标时提示「已无未标」。

- [ ] **Step 3: 重做路径**

试卷页点「重做」→
Expected: 答案默认遮住，每题出现「👁 显示答案」；点单题「显示答案」只显示该题答案；点工具栏「显示答案」整卷显示（按钮变「隐藏答案」）；再点「隐藏答案」整卷复位。

- [ ] **Step 4: 专注路径**

试卷页点「专注」→
Expected: 一题一屏；顶部进度条 + `x / n`；大按钮「做对 / 做错」；底部「上一题 / 下一题」；叠加「仅看错题」时导航只在错题间移动；专注页无改题入口；再点「专注」回到一览整卷。

- [ ] **Step 5: 编辑路径**

试卷列表卡片点「编辑」→
Expected: 编辑页可改标题/日期、逐题「编辑」（改题干/答案/题号）与「删除」；返回后卡片标题与「错 n」统计更新；打开试卷的做题/判分界面**不提供**任何改题能力。

- [ ] **Step 6: 提交（若验收中发现并修复了问题）**

```bash
git add app.js index.html styles.css lib.js test/lib.test.js
git commit -m "fix(paper): address issues found in browser acceptance"
```

---

## Self-Review 记录

- **Spec coverage：** 卡片保留改名/删除 + 新增编辑（Task 8）、打开进全屏判分（Task 4）；顶部工具栏六项 + 只读标题（Task 3/4）；题号导航条含对/错/未标配色、当前高亮、点击跳题、`已标 x / 共 n` 与 `错 m`（Task 4/9）；判分三态 + 快捷键 + 跳下一道未标（Task 4/5）；重做遮答案 + 单题/整卷显隐（Task 4）；专注模式一题一屏 + 上下题 + 大按钮 + 进度条 + 不叠加编辑（Task 6）；编辑页可改标题/日期/逐题/删题（Task 7）；数据结构与导入导出不变（仅改 `wrong` 字段，未动其它）；移除旧 `#paperModal`（Task 4）；lib.js 新增导出 `nextUnmarked`/`paperProgress` + 单测（Task 1/2）；窄屏导航收为横条（Task 9）。
- **Placeholder scan：** 无 TBD/TODO/“类似上面的”；每个测试步骤均给出可运行断言；每个代码步骤均给出完整代码。
- **Type consistency：** 状态字段 `paperState.{paperId,mode,focus,wrongOnly,showAnswers,revealed,curId}`；函数名 `paperOf/curPaper/paperVisibleQuestions/paperAnswerVisible/setPaperQ/openPaper/closePaperView/paperToast/renderPaperView/renderPaperNav/renderPaperList/paperRenderAnswer/markPaperQuestion/goToPaperQuestion/paperStep/jumpToNextUnmarked/renderPaperFocus/openPaperEdit/closePaperEdit/renderPaperEdit/isPaperViewOpen/handlePaperKey` 全文一致；`nextUnmarked`/`paperProgress` 的签名在 app.js 调用处与 lib.js 导出处一致。
