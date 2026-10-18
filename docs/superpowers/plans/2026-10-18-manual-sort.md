# 错题/知识点 拖拽手动排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让错题库、知识点库支持「拖拽卡片手柄手动排序」，并把顺序作为每库全局偏好持久化、随导入导出携带，设置里可在「自动（创建时间）/ 手动（拖拽）」之间切换。

**Architecture:** 纯逻辑（`sortItems` / `materializeOrder` / `reorderItems` / 条目 `order` 字段归一化）放 `lib.js`，用 Node 单测覆盖；每库排序模式存进设置对象 `mq_settings.sortMode`（`{q,k}`），其中复用现有 `settings/SET_DEF/saveSettings/applySettings` 基础设施；`app.js` 仅在「列表视图 + 全部筛选关闭 + 合集为全部」时渲染 ⠿ 手柄，用指针事件（`pointerdown/pointermove/pointerup`）实现桌面与触屏通用的拖拽，松手后用 `reorderItems` 落盘。

**Tech Stack:** 纯前端（vanilla JS + CSS，IndexedDB/localStorage，Node 内置 test runner）

**依据规格:** `docs/superpowers/specs/2026-10-18-manual-sort-design.md`

---

## 文件结构

| 文件 | 责任 | 本次改动 |
| --- | --- | --- |
| `lib.js` | 纯逻辑（浏览器 + 单测共用） | `normalizeQuestion` / `normalizeKp` 增补 `order`（数字保留、非法归 `null`）；`paperWrongToQuestion` 生成错题 `order: null`；新增并导出 `sortItems` / `materializeOrder` / `reorderItems` |
| `app.js` | 界面与存储 | `SET_DEF` 增 `sortMode:{q:'auto',k:'auto'}` 并归一化；`applySettings` 同步「排序」段高亮与当前库名；`makeCard` 在可拖拽时渲染 ⠿ 手柄；新增 `dragAllowed` / `dragState` / `dragPointerDown/Move/Up` / `bindDragHandle`；Markdown、打印改用 `sortItems` |
| `index.html` | 页面骨架 | 设置抽屉新增「排序」小节：`#setSort`（`data-sort="auto"` / `data-sort="manual"`）与 `#sortLibName` |
| `styles.css` | 样式 | `.card` 加 `position:relative`；新增 `.card.has-drag`、`.drag-handle`、`.card.dragging` |
| `test/lib.test.js` | 单测 | 新增 `order` 归一化、`sortItems`、`materializeOrder`、`reorderItems` 用例 |

**约定（锁定，后续任务必须一致）：**

- 条目新字段：`order: number | null`，默认 `null`，随条目存储/导出/导入。
- 排序模式：`settings.sortMode = { q: 'auto' | 'manual', k: 'auto' | 'manual' }`，默认 `'auto'`，只影响当前库。
- 纯函数签名：
  - `sortItems(items, mode)` → 新数组（不改入参、不改 `order` 字段）。
  - `materializeOrder(items)` → 新数组，按**入参顺序**逐个赋 `order = 0..n-1`（浅拷贝对象）。
  - `reorderItems(items, movedId, targetIndex)` → 新数组，把 `movedId` 移到 `targetIndex` 后重编号 `order = 0..n-1`；`targetIndex` 越界钳制到 `[0, n-1]`。
- 拖拽 DOM 契约：手柄按钮 `data-act="drag"`；卡片 `class="card"` + `dataset.id`；拖动中的卡片加类 `dragging`；可拖拽的卡片加类 `has-drag`。
- DOM id：`setSort` / `sortLibName`。

**运行方式（无 `package.json`，纯静态站点）：**

- 单测：`node --test test/lib.test.js`（期望全部 `pass`，无 `fail`）。
- 本地起服务（UI 验收用）：在 `/workspace` 执行 `python3 -m http.server 8000`，浏览器打开 `http://localhost:8000/`。

---

## Task 1: `lib.js` 条目 `order` 字段归一化

**Files:**
- Modify: `lib.js`（`normalizeQuestion` 内 `srs` 与 `createdAt` 之间；`normalizeKp` 内 `srs` 与 `createdAt` 之间；`paperWrongToQuestion` 的映射对象内）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 末尾追加：

```js
test('normalizeQuestion / normalizeKp 保留数字 order，非法值归 null', () => {
  assert.equal(normalizeQuestion({ order: 3 }).order, 3);
  assert.equal(normalizeQuestion({ order: 0 }).order, 0);
  assert.equal(normalizeQuestion({ order: '3' }).order, null);   // 字符串不是 number
  assert.equal(normalizeQuestion({ order: NaN }).order, null);   // NaN 是非法的 number
  assert.equal(normalizeQuestion({ order: Infinity }).order, null);
  assert.equal(normalizeQuestion({}).order, null);
  assert.equal(normalizeKp({ title: 't', order: 5 }).order, 5);
  assert.equal(normalizeKp({ title: 't', order: -2 }).order, -2);
  assert.equal(normalizeKp({ title: 't', order: null }).order, null);
});

test('paperWrongToQuestion 生成的错题默认 order=null', () => {
  const paper = normalizePaper({ id: 'p1', questions: [{ id: 'q1', stem: 'x', wrong: 'wrong' }] });
  const [converted] = paperWrongToQuestion(paper, 0);
  assert.equal(converted.order, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: 上述两条新用例 FAIL：`normalizeQuestion({order:3}).order` 得到 `undefined`（≠ 3），`converted.order` 得到 `undefined`（≠ null）。

- [ ] **Step 3: 最小实现**

在 `lib.js` 的 `normalizeQuestion` 里，把

```js
      srs: normalizeSrs(o.srs),
      createdAt: o.createdAt || Date.now(),
      fromPaper: (o.fromPaper && typeof o.fromPaper === 'object' && o.fromPaper.paperId)
```

改为

```js
      srs: normalizeSrs(o.srs),
      order: Number.isFinite(o.order) ? o.order : null,
      createdAt: o.createdAt || Date.now(),
      fromPaper: (o.fromPaper && typeof o.fromPaper === 'object' && o.fromPaper.paperId)
```

在 `normalizeKp` 里，把

```js
      srs: normalizeSrs(o.srs),
      createdAt: o.createdAt || Date.now(),
      updatedAt: o.updatedAt || Date.now(),
    };
  }

  /* ---------- 试卷（paper） ---------- */
```

改为

```js
      srs: normalizeSrs(o.srs),
      order: Number.isFinite(o.order) ? o.order : null,
      createdAt: o.createdAt || Date.now(),
      updatedAt: o.updatedAt || Date.now(),
    };
  }

  /* ---------- 试卷（paper） ---------- */
```

在 `paperWrongToQuestion` 的 `.map(q => ({ ... }))` 里，把

```js
        collectionId: null,
        srs: normalizeSrs(undefined),
        createdAt: t,
```

改为

```js
        collectionId: null,
        srs: normalizeSrs(undefined),
        order: null,
        createdAt: t,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: 全部用例 `pass`，0 `fail`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): 条目新增 order 字段归一化，错题默认 order=null"
```

---

## Task 2: `lib.js` 新增并导出 `sortItems`

**Files:**
- Modify: `lib.js`（在 `paperWrongToQuestion` 之后、`/* ---------- 搜索语法 ----------` 之前插入函数；在文件末尾 `return {}` 里追加导出）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

先把 `test/lib.test.js` 顶部解构块（`const { ... } = MQ;`）里补上新函数名 —— 把

```js
  normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers, paperWrongToQuestion,
```

改为

```js
  normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers, paperWrongToQuestion,
  sortItems,
```

然后在文件末尾追加：

```js
test('sortItems auto 按 createdAt 倒序', () => {
  const items = [
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 300 },
    { id: 'c', createdAt: 200 },
  ];
  assert.deepEqual(sortItems(items, 'auto').map(i => i.id), ['b', 'c', 'a']);
});

test('sortItems manual 按 order 升序，order=null 排最前并按 createdAt 倒序', () => {
  const items = [
    { id: 'a', order: 1, createdAt: 100 },
    { id: 'b', order: 0, createdAt: 100 },
    { id: 'new1', order: null, createdAt: 100 },
    { id: 'new2', order: null, createdAt: 200 },
    { id: 'c', order: 2, createdAt: 100 },
  ];
  assert.deepEqual(sortItems(items, 'manual').map(i => i.id), ['new2', 'new1', 'b', 'a', 'c']);
});

test('sortItems manual：order 相同用 createdAt 倒序兜底', () => {
  const items = [
    { id: 'a', order: 0, createdAt: 100 },
    { id: 'b', order: 0, createdAt: 300 },
    { id: 'c', order: 0, createdAt: 200 },
  ];
  assert.deepEqual(sortItems(items, 'manual').map(i => i.id), ['b', 'c', 'a']);
});

test('sortItems 不修改入参，且非法入参安全', () => {
  const items = [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }];
  const copy = items.slice();
  sortItems(items, 'auto');
  assert.deepEqual(items, copy);
  assert.deepEqual(sortItems(null, 'auto'), []);
  assert.deepEqual(sortItems(undefined, 'auto'), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: `sortItems` 相关 4 条用例 FAIL，报 `sortItems is not a function`（解构得到 `undefined`）。

- [ ] **Step 3: 最小实现**

在 `lib.js` 中 `paperWrongToQuestion` 函数结束之后、`/* ---------- 搜索语法 ----------` 注释行之前，插入：

```js

  /* ---------- 排序 ----------
     自动（auto）：创建时间倒序，新增的排最前，与现有行为一致。
     手动（manual）：order 升序；order===null 的（新加入、未参与拖拽）排最前，
     其内部按 createdAt 倒序；order 相同用 createdAt 倒序兜底。 */
  function sortItems(items, mode) {
    const arr = Array.isArray(items) ? items.slice() : [];
    if (mode === 'manual') {
      return arr.sort((a, b) => {
        const ao = (a && typeof a.order === 'number') ? a.order : null;
        const bo = (b && typeof b.order === 'number') ? b.order : null;
        if (ao === null && bo === null) return (b.createdAt || 0) - (a.createdAt || 0);
        if (ao === null) return -1;                      // 新条目排最前
        if (bo === null) return 1;
        if (ao !== bo) return ao - bo;                   // order 升序
        return (b.createdAt || 0) - (a.createdAt || 0);  // order 相同兜底
      });
    }
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
```

在文件末尾 `return {}` 对象里，把

```js
    paperWrongToQuestion,
```

改为

```js
    paperWrongToQuestion,
    sortItems,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: 全部用例 `pass`，0 `fail`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): 新增并导出 sortItems 纯函数"
```

---

## Task 3: `lib.js` 新增并导出 `materializeOrder`

**Files:**
- Modify: `lib.js`（紧跟 `sortItems` 之后插入；末行 `return {}` 追加导出）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

把顶部解构块里的

```js
  sortItems,
```

改为

```js
  sortItems, materializeOrder,
```

然后在文件末尾追加：

```js
test('materializeOrder 按输入顺序产出 order 0..n-1，且不改入参', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = materializeOrder(items);
  assert.deepEqual(out.map(i => [i.id, i.order]), [['a', 0], ['b', 1], ['c', 2]]);
  assert.deepEqual(items.map(i => i.order), [undefined, undefined, undefined]);
  assert.deepEqual(out.map(i => i.id), ['a', 'b', 'c']);   // 顺序与输入一致
});

test('materializeOrder 非法入参安全', () => {
  assert.deepEqual(materializeOrder(null), []);
  assert.deepEqual(materializeOrder(undefined), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: `materializeOrder` 相关 2 条用例 FAIL，报 `materializeOrder is not a function`。

- [ ] **Step 3: 最小实现**

在 `lib.js` 的 `sortItems` 函数之后插入：

```js

  /* 把当前顺序固化为显式 order（0..n-1）。
     入参应按「当前显示顺序」传入（进入手动模式时传 sortItems(items,'auto') 的结果）。 */
  function materializeOrder(items) {
    return (Array.isArray(items) ? items : []).map((it, i) => Object.assign({}, it, { order: i }));
  }
```

并把末行

```js
    sortItems,
```

改为

```js
    sortItems,
    materializeOrder,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: 全部用例 `pass`，0 `fail`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): 新增并导出 materializeOrder 纯函数"
```

---

## Task 4: `lib.js` 新增并导出 `reorderItems`

**Files:**
- Modify: `lib.js`（紧跟 `materializeOrder` 之后插入；末行 `return {}` 追加导出）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

把顶部解构块里的

```js
  sortItems, materializeOrder,
```

改为

```js
  sortItems, materializeOrder, reorderItems,
```

然后在文件末尾追加：

```js
test('reorderItems 移到首/末并重编 order 0..n-1', () => {
  const items = [
    { id: 'a', order: 0, createdAt: 1 },
    { id: 'b', order: 1, createdAt: 1 },
    { id: 'c', order: 2, createdAt: 1 },
  ];
  const toFirst = reorderItems(items, 'c', 0);
  assert.deepEqual(toFirst.map(i => i.id), ['c', 'a', 'b']);
  assert.deepEqual(toFirst.map(i => i.order), [0, 1, 2]);
  const toLast = reorderItems(items, 'a', 2);
  assert.deepEqual(toLast.map(i => i.id), ['b', 'c', 'a']);
  assert.deepEqual(toLast.map(i => i.order), [0, 1, 2]);
});

test('reorderItems 移到自身与相邻交换', () => {
  const items = [
    { id: 'a', order: 0, createdAt: 1 },
    { id: 'b', order: 1, createdAt: 1 },
    { id: 'c', order: 2, createdAt: 1 },
  ];
  const same = reorderItems(items, 'b', 1);
  assert.deepEqual(same.map(i => i.id), ['a', 'b', 'c']);
  assert.deepEqual(same.map(i => i.order), [0, 1, 2]);
  const swap = reorderItems(items, 'b', 2);
  assert.deepEqual(swap.map(i => i.id), ['a', 'c', 'b']);
  assert.deepEqual(swap.map(i => i.order), [0, 1, 2]);
});

test('reorderItems 目标下标越界钳制，且返回新数组', () => {
  const items = [
    { id: 'a', order: 0, createdAt: 1 },
    { id: 'b', order: 1, createdAt: 1 },
    { id: 'c', order: 2, createdAt: 1 },
  ];
  assert.deepEqual(reorderItems(items, 'c', -5).map(i => i.id), ['c', 'a', 'b']);
  assert.deepEqual(reorderItems(items, 'a', 99).map(i => i.id), ['b', 'c', 'a']);
  assert.notEqual(reorderItems(items, 'a', 99), items);
});

test('reorderItems 未知 id 只做重编号', () => {
  const items = [{ id: 'a', order: 0, createdAt: 1 }, { id: 'b', order: 5, createdAt: 1 }];
  const out = reorderItems(items, 'zzz', 0);
  assert.deepEqual(out.map(i => [i.id, i.order]), [['a', 0], ['b', 1]]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/lib.test.js`
Expected: `reorderItems` 相关 4 条用例 FAIL，报 `reorderItems is not a function`。

- [ ] **Step 3: 最小实现**

在 `lib.js` 的 `materializeOrder` 函数之后插入：

```js

  /* 在整库顺序上把 movedId 移到 targetIndex，返回重编号（0..n-1）后的新数组。
     入参 items 应按「当前显示顺序」传入；targetIndex 越界钳制到 [0, n-1]。
     移动后顺序无变化时，输出与（已归一化的）输入值相等。 */
  function reorderItems(items, movedId, targetIndex) {
    const arr = Array.isArray(items) ? items.slice() : [];
    const from = arr.findIndex(it => it && it.id === movedId);
    if (from >= 0) {
      const to = Math.max(0, Math.min(arr.length - 1, Math.floor(targetIndex)));
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
    }
    return arr.map((it, i) => Object.assign({}, it, { order: i }));
  }
```

并把末行

```js
    materializeOrder,
```

改为

```js
    materializeOrder,
    reorderItems,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/lib.test.js`
Expected: 全部用例 `pass`，0 `fail`。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat(lib): 新增并导出 reorderItems 纯函数"
```

---

## Task 5: 排序模式设置（`sortMode` 存储 + 设置抽屉「排序」小节）

**Files:**
- Modify: `app.js`（`SET_DEF` 与 `const settings` 处；`applySettings`；设置抽屉段点击处理；`settingsBtn.onclick`）
- Modify: `index.html`（在「动效」`setrow` 与「回收站」`setrow` 之间插入）
- Test: 浏览器验收（本任务无单测）

- [ ] **Step 1: 在 `SET_DEF` 增加 `sortMode` 并在读取设置后补全默认值**

在 `app.js` 顶部把

```js
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on' };
```

改为

```js
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on', sortMode: { q: 'auto', k: 'auto' } };
```

紧接着把

```js
const settings = Object.assign({}, SET_DEF, readSettings());
```

改为

```js
const settings = Object.assign({}, SET_DEF, readSettings());
// sortMode 是嵌套对象，浅合并会整体覆盖，这里单独补全两库默认值
settings.sortMode = Object.assign({ q: 'auto', k: 'auto' }, settings.sortMode);
```

- [ ] **Step 2: `applySettings` 同步「排序」段高亮与当前库名**

在 `applySettings` 里，把

```js
  document.querySelectorAll('#setAnim button').forEach(b => b.classList.toggle('on', b.dataset.anim === settings.anim));
```

改为

```js
  document.querySelectorAll('#setAnim button').forEach(b => b.classList.toggle('on', b.dataset.anim === settings.anim));

  const sm = (settings.sortMode && settings.sortMode[active]) || 'auto';
  document.querySelectorAll('#setSort button').forEach(b => b.classList.toggle('on', b.dataset.sort === sm));
  const sortLib = document.getElementById('sortLibName');
  if (sortLib) sortLib.textContent = active === 'p' ? '试卷（不适用）' : (active === 'k' ? '知识点' : '错题');
```

- [ ] **Step 3: 设置抽屉新增「排序」小节（DOM）**

在 `index.html` 中，把

```html
    <div class="setrow">
      <span class="lbl">回收站</span>
```

改为

```html
    <div class="setrow">
      <span class="lbl">排序 · 当前库：<span id="sortLibName">错题</span></span>
      <div class="seg" id="setSort">
        <button data-sort="auto">自动（创建时间）</button>
        <button data-sort="manual">手动（拖拽调整）</button>
      </div>
      <p class="setnote" id="sortNote">手动模式：按住卡片右上角的 ⠿ 手柄拖动调整顺序。切换只影响当前库；切回自动不会清除已存的顺序。</p>
    </div>

    <div class="setrow">
      <span class="lbl">回收站</span>
```

- [ ] **Step 4: 设置抽屉段点击处理：`setSort` 单独写当前库的 `sortMode`**

在 `app.js` 中，把

```js
settingsDrawer.querySelectorAll('.seg button').forEach(btn => {
  btn.onclick = () => {
    const key = btn.closest('.seg').id.slice(3).toLowerCase(); // setCols→cols 等
    settings[key] = btn.dataset[key];
    saveSettings();
    applySettings();
  };
});
```

改为

```js
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
```

- [ ] **Step 5: 打开设置时刷新排序段高亮**

在 `app.js` 中，把

```js
document.getElementById('settingsBtn').onclick = () => settingsDrawer.classList.add('open');
```

改为

```js
document.getElementById('settingsBtn').onclick = () => { applySettings(); settingsDrawer.classList.add('open'); };
```

- [ ] **Step 6: 浏览器验收**

Run: `python3 -m http.server 8000`（在 `/workspace`），打开 `http://localhost:8000/`
操作与期望：
1. 进入「错题」→ 点右上角「⚙️ 设置」→ 抽屉出现「排序 · 当前库：错题」小节，默认高亮「自动（创建时间）」。
2. 点「手动（拖拽调整）」→ 该按钮高亮；关闭抽屉；切到「知识点」再打开设置 → 高亮回到「自动（创建时间）」（每库独立）。
3. 回到「错题」打开设置 → 高亮仍为「手动（拖拽调整）」；刷新页面后再次打开设置仍为「手动」（已持久化到 `mq_settings`）。

- [ ] **Step 7: 提交**

```bash
git add app.js index.html
git commit -m "feat(settings): 新增每库排序模式 sortMode 与设置抽屉「排序」小节"
```

---

## Task 6: 卡片拖拽手柄、拖拽交互与样式

**Files:**
- Modify: `app.js`（`makeCard` 顶部与 `innerHTML`、`return card` 前；新增拖拽逻辑段）
- Modify: `styles.css`（`.card` 与新增拖拽相关样式）
- Test: 浏览器验收（本任务无单测）

- [ ] **Step 1: 在 `app.js` 新增拖拽逻辑段（含 `dragAllowed` 与事件处理）**

在 `app.js` 中，把

```js
document.getElementById('exitSelect').onclick = () => {
  const v = cur();
  v.selectMode = false;
  v.selected.clear();
  document.getElementById('selectBtn').classList.remove('primary');
  render();
};
```

改为（在其后追加整段拖拽逻辑）：

```js
document.getElementById('exitSelect').onclick = () => {
  const v = cur();
  v.selectMode = false;
  v.selected.clear();
  document.getElementById('selectBtn').classList.remove('primary');
  render();
};

/* ---------- 拖拽手动排序 ----------
   仅「列表视图 + 未搜索 + 无标签/状态/收藏/待复习筛选 + 未分组 + 合集为全部 + 未背题」时可用。
   指针事件实现（pointerdown/move/up），桌面与触屏通用，不依赖 HTML5 DnD；长按多选不受影响。 */
let dragState = null;

function dragAllowed() {
  if (active === 'p') return false;
  const v = cur();
  return !v.search && !v.status && !v.starOnly && !v.dueOnly
    && v.activeTags.size === 0 && !v.groupMode && v.collectionFilter === COL_ALL
    && !cram.open;
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
```

- [ ] **Step 2: `makeCard` 渲染手柄并按需绑定**

在 `app.js` 的 `makeCard` 里，把

```js
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = it.id;
```

改为

```js
  const canDrag = dragAllowed();
  const card = document.createElement('div');
  card.className = 'card' + (canDrag ? ' has-drag' : '');
  card.dataset.id = it.id;
```

并在 `card.innerHTML` 模板首行复选框后插入手柄。把

```js
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${d.main(it)}
```

改为

```js
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${canDrag ? `<button type="button" class="drag-handle" data-act="drag" title="按住拖拽调整顺序" aria-label="拖拽排序">⠿</button>` : ''}
    ${d.main(it)}
```

再在 `makeCard` 的 `return card;` 之前插入绑定：

```js
  if (canDrag) {
    const handle = card.querySelector('[data-act="drag"]');
    if (handle) bindDragHandle(handle);
  }

  return card;
```

（即把末尾的

```js
  card.addEventListener('touchcancel', () => { moved = true; clearTimeout(pressT); });

  return card;
}
```

改为

```js
  card.addEventListener('touchcancel', () => { moved = true; clearTimeout(pressT); });

  if (canDrag) {
    const handle = card.querySelector('[data-act="drag"]');
    if (handle) bindDragHandle(handle);
  }

  return card;
}
```

- [ ] **Step 3: 样式增量（`styles.css`）**

把

```css
.card{
  background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
  padding:var(--card-pad); margin-bottom:0; box-shadow:var(--shadow);
  transition:border-color .15s ease, background-color .2s ease;
}
```

改为

```css
.card{
  position:relative;
  background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
  padding:var(--card-pad); margin-bottom:0; box-shadow:var(--shadow);
  transition:border-color .15s ease, background-color .2s ease;
}
.card.has-drag .stem{padding-right:26px;}   /* 给右上角手柄让出位置 */

/* ---------- 拖拽手柄 ---------- */
.drag-handle{
  position:absolute; top:6px; right:8px; width:24px; height:24px; padding:0;
  border:1px solid transparent; background:transparent; color:var(--muted);
  border-radius:8px; font-size:14px; line-height:1; cursor:grab;
  touch-action:none; user-select:none;
}
.drag-handle:hover{border-color:var(--line); color:var(--brand);}
.card.dragging{opacity:.72; border-color:var(--brand); box-shadow:var(--shadow-lg);}
.card.dragging .drag-handle{cursor:grabbing;}
```

- [ ] **Step 4: 浏览器验收**

Run: `python3 -m http.server 8000`（在 `/workspace`），打开 `http://localhost:8000/`
操作与期望：
1. 「错题」列表每张卡片右上角出现 ⠿ 手柄；按住手柄上下拖动 → 卡片实时移位；松手后顺序保持。
2. 刷新页面 → 顺序保持（已写入 `order` 字段）。
3. 顶部搜索框输入任意词 → 手柄消失；清空搜索 → 手柄恢复。
4. 依次点「分组」「只看收藏」「待复习」，或选任一标签、任一状态、左侧合集选「未分类」→ 手柄均消失。
5. 长按卡片空白区域仍进入多选（行为不变）；手柄拖动不影响。
6. 触点/触屏设备（或浏览器触摸模拟）按住手柄拖动同样生效，页面不滚动。

- [ ] **Step 5: 提交**

```bash
git add app.js styles.css
git commit -m "feat(list): 卡片 ⠿ 手柄拖拽手动排序（指针事件 + 落盘）"
```

---

## Task 7: 导出 Markdown / 打印跟随排序模式

**Files:**
- Modify: `app.js`（`toMarkdown` 与打印处理内的排序，约 1986、2032 行）
- Test: 浏览器验收（本任务无单测）

- [ ] **Step 1: `toMarkdown` 改用 `sortItems`**

在 `app.js` 的 `toMarkdown` 里，把

```js
  const items = curItems().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
```

改为

```js
  const items = sortItems(curItems(), (settings.sortMode && settings.sortMode[active]) || 'auto');
```

- [ ] **Step 2: 打印处理改用 `sortItems`**

在 `app.js` 的打印处理（`document.getElementById('printBtn').onclick`）里，把

```js
  const items = curItems().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
```

改为

```js
  const items = sortItems(curItems(), (settings.sortMode && settings.sortMode[active]) || 'auto');
```

> 注意：JSON「导出」按钮导出的是条目原样（`order` 字段已随条目存储），无需额外排序。

- [ ] **Step 3: 浏览器验收**

Run: `python3 -m http.server 8000`（在 `/workspace`），打开 `http://localhost:8000/`
操作与期望：
1. 手动模式下拖动错题得到自定义顺序；「设置 → 导出 Markdown」下载的 `.md` 中条目顺序 = 当前拖拽顺序。
2. 「设置 → 打印」打印预览条目顺序 = 当前拖拽顺序。
3. 在设置里切回「自动」→ 上述两处顺序恢复为创建时间倒序（新增的排最前）。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat(export): Markdown 与打印跟随当前库排序模式"
```

---

## Task 8: 端到端浏览器验收

**Files:**
- 仅验收，不改代码。

- [ ] **Step 1: 启动本地服务并构建数据**

Run: `python3 -m http.server 8000`（在 `/workspace`），打开 `http://localhost:8000/`
操作：在「错题」用「+ 新增错题」随意粘贴 3–5 条（或使用内置种子数据）；在「知识点」同样准备 ≥3 条。

- [ ] **Step 2: 手动拖拽 + 持久化**

操作与期望：
1. 错题页按住 ⠿ 手柄把第 1 张拖到最末 → 实时移位，松手后为第 1 张排到末尾。
2. 刷新页面 → 顺序保持。
3. 「设置」中错题库排序自动变为高亮「手动（拖拽调整）」（首次拖拽自动切换）。

- [ ] **Step 3: 新增条目排最前（order=null）**

操作与期望：
1. 手动模式下新增 1 条错题 → 它出现在列表**最前**。
2. 拖动该新条目到中间 → 松手后所有条目 `order` 被统一重编号（继续拖动任意卡片顺序表现正常）。

- [ ] **Step 4: 边界：拖回原位不写盘**

操作与期望：
1. 按住手柄轻微晃动后松手（落点仍在原下标）→ 列表顺序不变；`mq_items` 未被改写（可在 DevTools 观察，或断言刷新后顺序仍与拖动前一致）。
2. 手柄按住不移动直接松手 → 无任何变化，长按多选能力仍可用。

- [ ] **Step 5: 切回自动不丢顺序**

操作与期望：
1. 设置里把错题切回「自动（创建时间）」→ 列表恢复创建时间倒序。
2. 切回「手动」→ 恢复之前的拖拽顺序（已存 `order` 未被删除）。

- [ ] **Step 6: 筛选态与禁用态**

操作与期望：
1. 搜索 / 标签筛选 / 状态筛选 / 只看收藏 / 待复习 / 分组 / 非「全部」合集，任一开启 → 手柄全部消失，不可拖拽。
2. 切换到「试卷」栏目 → 无手柄（试卷列表不参与手动排序）。
3. 进入背题模式 → 手柄不可交互。

- [ ] **Step 7: 导入导出携带 order**

操作与期望：
1. 手动排序后「设置 → 导出」下载 JSON；打开该 JSON，条目含数字 `order`。
2. 「设置 → 导入」选择「确定（替换全部数据）」→ 导入后列表顺序与导出前一致。

- [ ] **Step 8: 回归单测**

Run: `node --test test/lib.test.js`
Expected: 全部用例 `pass`，0 `fail`。

- [ ] **Step 9: 提交（如验收中发现并修复了问题）**

```bash
git add app.js lib.js index.html styles.css test/lib.test.js
git commit -m "test: 手动排序端到端验收与回归修复"
```

---

## 自检（对照设计文档）

- 数据模型：`order: number | null` 默认 `null`，随存储/导出/导入 → Task 1 + Task 6/7/8；`normalizeQuestion/Kp` 保留数字、非法归 `null` → Task 1；`paperWrongToQuestion` 生成错题 `order=null` → Task 1。
- 纯函数：`sortItems`（auto 倒序 / manual 升序 + null 最前 + createdAt 兜底）→ Task 2；`materializeOrder` → Task 3；`reorderItems`（重编号 0..n-1、越界钳制、新数组）→ Task 4。
- 存储：`mq_settings.sortMode:{q,k}`，默认 auto → Task 5；首次拖拽先 `materializeOrder` 整库再应用并置 manual → Task 6。
- 交互：仅手柄触发、指针事件、实时移位、松手持久化、不影响长按多选 → Task 6。
- 可拖拽条件（列表视图 + 未搜索 + 无标签/状态/收藏/待复习 + 未分组 + 合集为全部）与禁用态（背题/随机复习/试卷视图）→ Task 6 `dragAllowed` + Task 8 验收。
- 设置「排序」小节、只影响当前库、切回自动不删 `order` → Task 5 + Task 8。
- 导出/Markdown/打印跟随排序模式 → Task 7（JSON 导出天然携带 `order`）。
- 边界：拖回原位不写盘、order 相同 createdAt 兜底、手动模式新增 `order=null` 排最前、删除不重编号（删除仅移除条目、不触碰他条 `order`）→ Task 2/4/6 + Task 8。
- 函数名/变量/状态名一致：`sortItems` / `materializeOrder` / `reorderItems` / `settings.sortMode` / `dragAllowed` / `dragState` / `dragPointerDown|Move|Up` / `bindDragHandle` / `setSort` / `sortLibName`。
