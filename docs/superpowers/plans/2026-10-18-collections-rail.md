# 合集侧栏收起/展开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让错题/知识点视图左侧的合集侧栏在宽屏下可「收起为窄竖条 / 展开为完整侧栏」，收起状态存于 `mq_settings` 并跨刷新保持，窄屏（<1024px）行为保持抽屉不变。

**Architecture:** 复用现有侧栏 DOM（`#colTree` 这个 `<aside>`）：新增设置项 `settings.rail`（`'on'`|`'off'`），`applySettings()` 在「宽屏且已收起」时给 `#colTree` 加类 `rail`，CSS 把宽度从 238px 改为 44px。`renderColTree()` 在最前面加一个分支：宽屏+收起时改渲染 `renderColRail()`（竖条），否则走原完整树逻辑。竖条与完整树共用同一份 `views[q/k].collectionFilter` 选中态与 `applyFilters()` 重渲染路径，不另造一套筛选。

**Tech Stack:** 纯前端（vanilla JS + CSS，IndexedDB/localStorage，Node 内置 test runner）

**依据规格:** `docs/superpowers/specs/2026-10-18-collections-rail-design.md`

---

## 文件结构

| 文件 | 责任 | 本次改动 |
| --- | --- | --- |
| `index.html` | 页面骨架 | 设置抽屉里新增「合集侧栏」开合分段控件 `#setRail` |
| `styles.css` | 样式 | 新增 `.colrail / .colrail-btn / .colrail-items / .colrail-item` 样式；`@media (min-width:1024px)` 里重新显示 `#colToggle` 并新增 `.coltree.rail` 宽度 |
| `app.js` | 界面与存储 | 设置项 `rail`；`colRailOn()/setColRail()`；`applySettings()` 类切换；`renderColTree()` 头部新增 `«` 收起按钮 + 竖条分支 + `renderColRail()`/`firstChar()`；`#colToggle` 宽屏改为切换收起 |
| `sw.js` | 离线缓存 | 缓存版本号 `math-review-v8` → `math-review-v9` |
| `lib.js` / `test/lib.test.js` | 纯逻辑与单测 | **不改**（本功能无新增纯函数；仅运行既有单测做回归） |

**约定（锁定，后续任务必须一致）：**

- 设置 key：`settings.rail`，取值 `'off'`（默认，展开）| `'on'`（收起为竖条）；持久化键仍是 `mq_settings`
- DOM id：`setRail`（设置分段）、`colCollapse`（完整侧栏头部 `«`）、`colRailExpand`（竖条顶部 `»`）、`colRailNew`（竖条底部 `＋`）
- CSS：侧栏根元素 `#colTree` 上的类名为 `rail`（选择器 `.coltree.rail`）；完整侧栏头部收起按钮用类 `railbtn`（仅宽屏显示）
- 竖条项 DOM：`<button class="colrail-item" data-rrow="<id>">`，其中 `<id>` 复用现有虚拟节点常量 `COL_ALL='__all__'`、`NONE_ID='__none__'`，其余为合集 id
- 复用的现有函数：`flattenCollections(cols)`、`collectionPath(cols, id)`、`collectionCounts(curItems(), cols)`、`collectionChildren`、`applyFilters()`、`createCollection(parentId)`、`cur()`、`curItems()`
- 新函数签名：`colRailOn(): boolean`、`setColRail(on: boolean): void`、`firstChar(s): string`、`renderColRail(kind, cols, subtree, unassigned, sel): void`

---

## Task 1: 新增设置项 rail 与收起态类切换

**Files:**
- Modify: `app.js:29`（`SET_DEF`）
- Modify: `app.js:1138` 之后（新增 `colRailOn`/`setColRail`）
- Modify: `app.js:60-81`（`applySettings`）

- [ ] **Step 1: 在 SET_DEF 中登记 rail 设置项**

把 `app.js:29` 这一行：

```js
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on' };
```

改为：

```js
const SET_DEF = { cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on', rail: 'off' };
```

- [ ] **Step 2: 新增收起状态的读写助手**

在 `app.js:1138` 的 `const colKind = ...` 一行之后插入：

```js
const colKind = () => active === 'k' ? 'k' : 'q';

// 「侧栏收起为竖条」的偏好：全局（错题 / 知识点共用），存于 mq_settings.rail（'on' | 'off'）
const colRailOn = () => settings.rail === 'on';
function setColRail(on) {
  settings.rail = on ? 'on' : 'off';
  saveSettings();
  applySettings();
}
```

- [ ] **Step 3: 让 applySettings 应用「收起」状态**

在 `app.js:73` 这一行之后（即 `document.querySelectorAll('#setAnim button')...` 那行之后）：

```js
  document.querySelectorAll('#setAnim button').forEach(b => b.classList.toggle('on', b.dataset.anim === settings.anim));
```

插入：

```js
  document.querySelectorAll('#setRail button').forEach(b => b.classList.toggle('on', b.dataset.rail === settings.rail));

  // 宽屏且已「收起」→ 侧栏切成窄竖条；窄屏（<1024）始终是抽屉，不加该类
  if (colTreeEl) {
    colTreeEl.classList.toggle('rail', settings.rail === 'on' && window.innerWidth >= 1024);
    renderColTree();
  }
```

（`colTreeEl`、`renderColTree`、`colRailOn` 均在脚本后续位置声明，但 `applySettings` 只在 `boot()`/交互时被调用，届时都已初始化，无 TDZ 问题。）

- [ ] **Step 4: 语法检查**

Run: `node --check app.js`
Expected: 无输出、退出码 0（仅做语法解析，不执行浏览器代码）

- [ ] **Step 5: 回归既有单测**

Run: `node --test test/lib.test.js`
Expected: 全部通过（`pass` 数等于当前用例总数，`fail 0`）

- [ ] **Step 6: 提交**

```bash
git add app.js
git commit -m "feat(coltree): 新增合集侧栏收起设置项与类切换"
```

---

## Task 2: 竖条样式与宽屏显示 header 切换按钮

**Files:**
- Modify: `styles.css:489` 之后（新增竖条样式）
- Modify: `styles.css:491-502`（`@media (min-width:1024px)` 块）

- [ ] **Step 1: 新增竖条基础样式**

在 `styles.css:489`（`@media (hover:none){ .colrow .cacts{display:flex;} }`）之后插入：

```css
/* 收起后的窄竖条（仅宽屏出现；窄屏始终是抽屉，不带 .rail 类） */
.coltree-head .railbtn{
  display:none; border:0; background:transparent; color:var(--muted);
  font-size:16px; padding:0 4px; cursor:pointer;
}
.coltree-head .railbtn:hover{color:var(--brand);}
.colrail{
  display:flex; flex-direction:column; align-items:center; gap:6px;
  flex:1 1 auto; min-height:0; width:100%;
}
.colrail-btn{
  width:28px; height:26px; border:0; background:transparent; color:var(--muted);
  font-size:15px; line-height:1; border-radius:6px; cursor:pointer; padding:0;
}
.colrail-btn:hover{background:var(--sunken); color:var(--brand);}
.colrail-items{
  display:flex; flex-direction:column; align-items:center; gap:5px;
  flex:1 1 auto; min-height:0; overflow-y:auto; width:100%;
}
.colrail-item{
  width:28px; height:28px; flex:0 0 auto; padding:0;
  display:flex; align-items:center; justify-content:center;
  border:1px solid var(--line); border-radius:8px; background:var(--card);
  color:var(--text-2); font-size:13px; cursor:pointer;
}
.colrail-item:hover{border-color:var(--brand);}
.colrail-item.active{background:var(--brand-soft); border-color:var(--brand); color:var(--brand); font-weight:700;}
```

- [ ] **Step 2: 宽屏重新显示 header 按钮并加竖条宽度规则**

把 `styles.css:491-502` 的整个媒体块：

```css
@media (min-width: 1024px){
  #colToggle{display:none;}
  .shell{display:flex; align-items:flex-start;}
  .coltree{
    position:sticky; top:var(--hdr,64px); left:auto; bottom:auto;
    width:238px; flex:0 0 238px; max-width:none; height:calc(100vh - var(--hdr,64px));
    transform:none; transition:none; box-shadow:none; z-index:1;
  }
  .coltree-backdrop{display:none !important;}
  .coltree-head .cls{display:none;}
  main{flex:1 1 auto; min-width:0;}
}
```

替换为：

```css
@media (min-width: 1024px){
  #colToggle{display:inline-block;}
  .shell{display:flex; align-items:flex-start;}
  .coltree{
    position:sticky; top:var(--hdr,64px); left:auto; bottom:auto;
    width:238px; flex:0 0 238px; max-width:none; height:calc(100vh - var(--hdr,64px));
    transform:none; transition:none; box-shadow:none; z-index:1;
  }
  .coltree.rail{
    width:44px; flex:0 0 44px; padding:10px 8px 16px;
    align-items:center; gap:0; overflow:hidden;
  }
  .coltree-backdrop{display:none !important;}
  .coltree-head .cls{display:none;}
  .coltree-head .railbtn{display:inline-block;}
  main{flex:1 1 auto; min-width:0;}
}
```

- [ ] **Step 3: 启动本地静态服务器**

在仓库根目录 `/workspace` 运行：

Run: `python3 -m http.server 8000`
Expected: 输出 `Serving HTTP on 0.0.0.0 port 8000 ...`（保持运行；浏览器打开 `http://localhost:8000`）

- [ ] **Step 4: 浏览器里验证竖条宽度（宽屏 >1024px）**

把浏览器窗口拉到宽于 1024px，打开 `http://localhost:8000`，在 DevTools Console 依次执行：

```js
document.getElementById('colTree').classList.add('rail');
getComputedStyle(document.getElementById('colTree')).width;
```

Expected: 返回字符串 `"44px"`；且 `document.getElementById('colToggle').style.display` 不为 `"none"`（宽屏可见）。
再执行 `document.getElementById('colTree').classList.remove('rail');` 复位。

- [ ] **Step 5: 提交**

```bash
git add styles.css
git commit -m "feat(coltree): 竖条样式并在宽屏显示侧栏切换按钮"
```

---

## Task 3: 设置抽屉增加「合集侧栏」开合控件

**Files:**
- Modify: `index.html:344` 之后（在「动效」setrow 与「回收站」setrow 之间插入）

- [ ] **Step 1: 插入设置分段控件**

在 `index.html` 的「动效」区块末尾（`index.html:344` 的 `</div>`）与「回收站」区块（`index.html:346` 的 `<div class="setrow">`）之间插入：

```html
    <div class="setrow">
      <span class="lbl">合集侧栏</span>
      <div class="seg" id="setRail">
        <button data-rail="off">展开</button>
        <button data-rail="on">收起为竖条</button>
      </div>
      <p class="setnote">收起后：宽屏在左侧显示窄竖条；窄屏（手机）仍是抽屉，不受影响。</p>
    </div>
```

（分段控件由现有通用处理自动接线：`app.js:2214` 的 `settingsDrawer.querySelectorAll('.seg button')` 处理里，`btn.closest('.seg').id` 为 `setRail`，`slice(3).toLowerCase()` 得 `rail`，`btn.dataset.rail` 为 `on/off`，即自动写入 `settings.rail` 并保存。）

- [ ] **Step 2: 浏览器里验证控件写入设置**

保持 `http://localhost:8000` 打开、窗口宽于 1024px，在 Console 执行：

```js
document.getElementById('setRail').querySelector('button[data-rail="on"]').click();
document.getElementById('colTree').classList.contains('rail');
JSON.parse(localStorage.getItem('mq_settings')).rail;
```

Expected: 依次返回 `true`、`"on"`；且侧栏宽度变为 44px。再执行：

```js
document.getElementById('setRail').querySelector('button[data-rail="off"]').click();
```

Expected: 侧栏恢复 238px，`document.getElementById('colTree').classList.contains('rail')` 为 `false`。

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "feat(coltree): 设置抽屉新增合集侧栏收起开关"
```

---

## Task 4: 竖条渲染 renderColRail 与 renderColTree 分支

**Files:**
- Modify: `app.js:1186` 之后（`renderColTree` 内插入竖条分支）
- Modify: `app.js:1204`（`renderColTree` 头部新增 `«` 收起按钮并接线）
- Modify: `app.js:1248` 之后（新增 `firstChar` 与 `renderColRail`）

- [ ] **Step 1: 在 renderColTree 开头加入竖条分支**

在 `app.js` 的 `renderColTree()` 里，`const st = colTreeEl.scrollTop;`（约 `app.js:1186`）这一行之后插入：

```js
  // 宽屏 + 已收起 → 渲染窄竖条（平铺所有合集）；否则保持现有完整树
  if (colRailOn() && window.innerWidth >= 1024) {
    renderColRail(kind, cols, subtree, unassigned, sel);
    return;
  }
```

- [ ] **Step 2: 完整侧栏头部新增 « 收起按钮并接线**

把 `app.js:1204` 这一行：

```js
  let html = `<div class="coltree-head"><span class="t">合集</span><button class="cls" id="colClose" title="关闭">✕</button></div>`;
```

替换为：

```js
  let html = `<div class="coltree-head"><span class="t">合集</span><button class="railbtn" id="colCollapse" title="收起侧栏">«</button><button class="cls" id="colClose" title="关闭">✕</button></div>`;
```

再在 `renderColTree()` 末尾的关闭按钮接线处（约 `app.js:1246-1247`）：

```js
  const cb = colTreeEl.querySelector('#colClose');
  if (cb) cb.onclick = () => closeColDrawer();
```

追加一行：

```js
  const cc = colTreeEl.querySelector('#colCollapse');
  if (cc) cc.onclick = () => setColRail(true);
```

（`.railbtn` 在窄屏默认 `display:none`，仅宽屏显示；窄屏头部仍显示 `.cls` 的 `✕`。CSS 由 Task 2 提供。）

- [ ] **Step 3: 新增 firstChar 与 renderColRail**

在 `renderColTree()` 的结束大括号（约 `app.js:1248`）之后、`const NONE_ID = '__none__';`（约 `app.js:1250`）之前插入：

```js
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
```

- [ ] **Step 4: 语法检查**

Run: `node --check app.js`
Expected: 无输出、退出码 0

- [ ] **Step 5: 浏览器里验证竖条渲染与筛选**

保持 `http://localhost:8000`、窗口宽于 1024px。先进入设置点「收起为竖条」，再在 Console 执行：

```js
document.querySelectorAll('.colrail-item').length;
document.querySelectorAll('.colrail-item.active').length;
document.querySelector('.colrail-item').title;
```

Expected:
- 第 1 条：`2 + 当前库合集总数`（例如该库 0 个合集时为 `2`，含 1 个子合集时为 `4`；用 `flattenCollections(colList('q')).length` 核对）
- 第 2 条：`1`（有且仅有一个高亮项）
- 第 3 条：`"全部 · N 条"` 文案（点开某项 `title` 能看到 `路径 · N 条`）

再点一个合集方块并断言筛选与高亮同步：

```js
const el = document.querySelectorAll('.colrail-item')[2];   // 第 3 个 = 第一个真实合集
el.click();
document.querySelector('.colrail-item.active').dataset.rrow === el.dataset.rrow;
document.getElementById('count').textContent;
```

Expected: 第 1 条表达式为 `true`；`#count` 文案随该合集（含子树）筛选结果变化。

再验证完整侧栏头部的 `«` 收起按钮：

```js
document.getElementById('colRailExpand').click();           // 先展开回完整侧栏
document.getElementById('colCollapse').click();             // 点头部 « 收起
document.getElementById('colTree').classList.contains('rail');
```

Expected: 第 1 次点击后 `document.querySelectorAll('.colrail-item').length` 为 `0`（回到完整树）；第 2 次点击后表达式为 `true`（又收成竖条）。

- [ ] **Step 6: 提交**

```bash
git add app.js
git commit -m "feat(coltree): 宽屏收起时渲染合集竖条并复用筛选逻辑"
```

---

## Task 5: header「☰ 合集」宽屏切换收起

**Files:**
- Modify: `app.js:1174-1176`（`document.getElementById('colToggle').onclick`）

- [ ] **Step 1: 宽屏改为切换收起，窄屏保持抽屉**

把 `app.js:1174-1176`：

```js
document.getElementById('colToggle').onclick = () => {
  colTreeEl.classList.contains('open') ? closeColDrawer() : openColDrawer();
};
```

替换为：

```js
document.getElementById('colToggle').onclick = () => {
  // 宽屏：一键在「完整侧栏 ⇄ 窄竖条」之间切换；窄屏：开合抽屉（行为不变）
  if (window.innerWidth >= 1024) { setColRail(!colRailOn()); return; }
  colTreeEl.classList.contains('open') ? closeColDrawer() : openColDrawer();
};
```

- [ ] **Step 2: 语法检查**

Run: `node --check app.js`
Expected: 无输出、退出码 0

- [ ] **Step 3: 浏览器里验证 header 切换**

Console 执行（宽屏 >1024px）：

```js
document.getElementById('colToggle').click();
document.getElementById('colTree').classList.contains('rail');
document.getElementById('colToggle').click();
document.getElementById('colTree').classList.contains('rail');
```

Expected: 依次 `true`、`false`（一次点开竖条，再点恢复完整侧栏）。

窗口缩到 <1024px 后执行：

```js
document.getElementById('colToggle').click();
document.getElementById('colTree').classList.contains('open');
```

Expected: 为 `true`（窄屏仍是抽屉机制），且 `document.querySelectorAll('.colrail-item').length` 为 `0`。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat(coltree): 宽屏 header 按钮切换侧栏收起/展开"
```

---

## Task 6: 端到端浏览器验收与离线缓存版本号

**Files:**
- Modify: `sw.js:3`（缓存版本号）

- [ ] **Step 1: 提升离线缓存版本号**

把 `sw.js:3`：

```js
const CACHE = 'math-review-v8';
```

改为：

```js
const CACHE = 'math-review-v9';
```

（`index.html`/`styles.css`/`app.js` 已在 `CORE` 清单里，改代码后必须换版本号，避免发新版仍命中旧缓存。）

- [ ] **Step 2: 语法检查并回归单测**

Run: `node --check app.js && node --test test/lib.test.js`
Expected: 语法检查无输出；单测全部通过（`fail 0`）

- [ ] **Step 3: 端到端浏览器验收**

在仓库根目录 `/workspace` 运行 `python3 -m http.server 8000`，浏览器打开 `http://localhost:8000`，窗口宽于 1024px，按下列路径逐条核对（Console 断言为附加确认）：

1. 完整侧栏 → 点击侧栏头部的 `«`（`#colCollapse`）或 header 的「☰ 合集」任一，均切到窄竖条
   断言：先记 `const w0 = document.querySelector('main').getBoundingClientRect().width;`，再 `document.getElementById('colCollapse').click(); document.getElementById('colTree').classList.contains('rail')`
   期望：`true`；`document.querySelector('main').getBoundingClientRect().width > w0`（主内容区变宽）。再点 `document.getElementById('colTree').querySelector('#colRailExpand').click();` 期望 `document.querySelectorAll('.colrail-item').length === 0`（恢复完整侧栏）。
2. 竖条上悬停任一方块 → 浏览器原生 tooltip 显示「路径 · N 条」
   断言：`document.querySelectorAll('.colrail-item')[2].title`
   期望：含 ` / `（子合集）或为 `名称 · N 条`，且以 ` 条` 结尾。
3. 竖条点不同合集 → 列表按该合集（含子树）筛选、高亮随之更新
   断言：点击后 `document.querySelector('.colrail-item.active').dataset.rrow` 等于被点方块 `dataset.rrow`，且 `#count` 数字变化。
4. 刷新页面（F5）→ 收起状态保持为竖条
   断言：`JSON.parse(localStorage.getItem('mq_settings')).rail === 'on'` 且 `document.getElementById('colTree').classList.contains('rail')` 为 `true`。
5. 缩窗口到 <1024px → 变回抽屉
   断言：`document.getElementById('colTree').classList.contains('rail')` 为 `false`；点「☰ 合集」后 `document.getElementById('colTree').classList.contains('open')` 为 `true`；`document.querySelectorAll('.colrail-item').length` 为 `0`。
6. 切到「试卷」tab → 侧栏与「☰ 合集」隐藏；切回「错题」→ 恢复上次收起状态
   断言：切到试卷后 `document.getElementById('colTree').style.display === 'none'` 且 `document.getElementById('colToggle').style.display === 'none'`；切回错题后两者恢复，且 `document.getElementById('colTree').classList.contains('rail')` 仍为 `true`。
7. 空合集库（该库只有「全部」「未分类」）→ 竖条照常显示这两项
   断言：把某一库（如知识点库）合集清空后，`document.querySelectorAll('.colrail-item').length === 2`，且两项 `title` 分别为 `全部 · N 条`、`未分类 · N 条`。
8. 删除当前选中的合集 → 选中态回落到「全部」，竖条高亮为「全部」
   断言：删除后 `cur().collectionFilter === '__all__'` 且 `document.querySelector('.colrail-item.active').dataset.rrow === '__all__'`。
9. 设置抽屉点「展开」→ 恢复完整侧栏
   断言：`document.getElementById('setRail').querySelector('button[data-rail="off"]').click(); document.getElementById('colTree').classList.contains('rail')` 为 `false`。

- [ ] **Step 4: 提交**

```bash
git add sw.js
git commit -m "chore: 提升离线缓存版本号至 v9"
```
