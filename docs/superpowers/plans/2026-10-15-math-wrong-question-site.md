# 数学错题本 正式版 Implementation Plan

> **For agentic workers:** 按任务顺序实现，每完成一个任务手动在浏览器验证再继续。

**Goal:** 把 demo 做成正式版：拆分为 `index.html` + `styles.css` + `app.js`，补齐编辑、随机抽题、导出/导入 JSON、按状态复习清单。

**Architecture:** 纯前端单页，无框架无构建。`app.js` 内按职责分块：`storage`（localStorage 读写与校验）、`parser`（解析 `【…】` 粘贴文本）、`render`（KaTeX 渲染与卡片 DOM）、`ui`（事件、筛选、弹窗、导入导出）。所有渲染统一走 `renderMath()`，保证公式处理一致。

**Tech Stack:** 原生 HTML/CSS/JS；本地 KaTeX（`vendor/katex/`）；数据存 `localStorage`。

**Spec:** `docs/superpowers/specs/2026-10-15-math-wrong-question-site-design.md`

---

## 文件结构

- `index.html` — 页面骨架与静态结构（顶栏、列表容器、弹窗）。
- `styles.css` — 全部样式。
- `app.js` — 全部逻辑，按 storage / parser / render / ui 四块组织。
- `vendor/katex/` — 已就位的本地 KaTeX。

---

## 数据结构

`localStorage` key `mq_items`，值为数组，每项：

```js
{ id, stem, analysis, knowledge, tags:[], status, createdAt, updatedAt }
// status ∈ 'new' | 'reviewing' | 'mastered'
```

---

### Task 1: 项目骨架拆分

**Files:** Create `index.html`、`styles.css`；Modify 无。

- [ ] 把 demo 的内联样式抽到 `styles.css`，内联脚本抽到 `app.js`。
- [ ] `index.html` 只保留结构 + 引入 `./vendor/katex/katex.min.css`、`./styles.css`、`./vendor/katex/katex.min.js`、`./app.js`。
- [ ] 验证：打开页面样式与 demo 一致，公式正常渲染。

### Task 2: storage 模块

**Files:** Modify `app.js`。

- [ ] 实现 `load()`：读 `mq_items`，JSON 解析失败返回 `null`。
- [ ] 实现 `save(items)`：写盘，捕获异常并提示。
- [ ] 实现 `normalize(item)`：补齐缺失字段、`tags` 保证为数组、`status` 非法时回落 `new`。
- [ ] 首次无数据时写入 2 道示例题（seed）。
- [ ] 验证：刷新页面数据保留。

### Task 3: parser 模块

**Files:** Modify `app.js`。

- [ ] `parseBlock(block)`：按独占一行的 `【题目】/【解析】/【知识点】/【标签】` 切段；标签按 `,，` 分割。
- [ ] `parseBatch(text)`：按独占一行的 `={3,}` 切块后逐个 `parseBlock`。
- [ ] 错误收集：缺 `【题目】`、标记前有杂散文本 → 写入 `errors[]`。
- [ ] 验证：单题、多题、缺段三种输入拆分正确。

### Task 4: render 模块

**Files:** Modify `app.js`。

- [ ] `renderMath(text)`：切分 `$$…$$` 与 `$…$`，用 `katex.renderToString(..., {throwOnError:false})`，失败保留原文；非公式部分转义后换行转 `<br>`。
- [ ] `render()`：按当前筛选渲染卡片；卡片含题干、标签 chips、状态色块、删除按钮，以及两个默认折叠的 `<details>`（解析 / 知识点）。
- [ ] 无结果时显示空状态。
- [ ] 验证：折叠默认收起、展开内容公式正确。

### Task 5: 筛选与搜索

**Files:** Modify `app.js`。

- [ ] 搜索：`search.value` 在题干+解析+知识点+标签里做包含匹配。
- [ ] 状态筛选、标签筛选；顶部下拉的标签项由现有数据动态生成（`refreshTagFilter()`）。
- [ ] 顶部显示「共 N 道，当前显示 M 道」。
- [ ] 验证：三种筛选组合生效。

### Task 6: 新增 / 编辑弹窗

**Files:** Modify `index.html`（弹窗结构）、`app.js`。

- [ ] 「+ 新增错题」打开弹窗；弹窗含粘贴框、格式示例、「拆分预览」、预览卡（可勾选）。
- [ ] 「导入选中的题」批量写入。
- [ ] 编辑：卡片上加「编辑」，打开同一弹窗并预填该题字段（单题模式，不走批量）。
- [ ] 保存后刷新列表与标签下拉。
- [ ] 验证：粘贴两题导入成功；编辑后内容更新。

### Task 7: 状态切换与删除

**Files:** Modify `app.js`。

- [ ] 点状态色块：`new → reviewing → mastered → new` 循环，写盘。
- [ ] 删除：二次确认后移除并写盘。
- [ ] 验证：切换状态后刷新仍是新状态。

### Task 8: 随机抽题（复习）

**Files:** Modify `index.html`（顶栏按钮）、`app.js`。

- [ ] 顶栏加「随机一题」；从当前筛选结果随机抽一道，弹出只显示题干、解析/知识点折叠的卡片。
- [ ] 验证：点多次得到不同题。

### Task 9: 导出 / 导入 JSON

**Files:** Modify `index.html`（顶栏按钮 + 隐藏 file input）、`app.js`。

- [ ] 导出：内存数组 → `Blob` → 下载 `错题本-YYYYMMDD.json`。
- [ ] 导入：读文件 → 校验为数组且每项含 `stem` → 询问「替换 / 追加」→ 写盘刷新。
- [ ] 结构非法时提示且不覆盖现有数据。
- [ ] 验证：导出后清空再导入，数据一致（含状态与标签）。

### Task 10: 整体浏览器验证

**Files:** 无。

- [ ] 逐条走查 spec 第 10 节测试清单。
- [ ] 用浏览器自动化复核关键交互（折叠、导入、导出往返、筛选）。

### Task 11: 知识点库（追加）

**Files:** Modify `index.html`、`styles.css`、`app.js`。

- [ ] 新增独立存储 key `mq_kps`，结构与错题分开（`title/content/tags/status`）。
- [ ] 顶部加 `错题` / `知识点` 视图切换；两个视图各自维护筛选与选择状态。
- [ ] 通用化渲染与解析：按视图配置 `main / details / hay / 导入字段映射`。
- [ ] 知识点视图：卡片带紫色「知识点」标记，讲解默认折叠。
- [ ] 新增知识点：手动或按 `【知识点】/【讲解】/【标签】` 粘贴，支持 `===` 批量。
- [ ] 标签共用一套（两库并集）；知识点卡片显示「相关错题 N 道」，点击跳转错题视图并按标签筛选。
- [ ] 导出/导入改为 `{ questions, knowledge }`，兼容旧版数组格式。
- [ ] 验证：视图切换、折叠、导入、编辑、关联跳转、数据隔离、导出。

---

## Self-Review

- Spec 覆盖：录入（T6）、折叠展示（T4）、公式（T4）、筛选搜索（T5）、状态（T7）、复习（T8）、备份（T9）均有对应任务；非目标未引入。
- 术语一致：统一用 `stem/analysis/knowledge/tags/status`，`renderMath` 单点渲染。
- 无占位符：每个任务均给出了实现要点与验证方式。
