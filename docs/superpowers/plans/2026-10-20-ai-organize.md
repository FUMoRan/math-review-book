# AI 错题整理（标签 / 合集 / 考点 / 去重 / 诊断）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在离线优先的「数学复习本」里加入「AI 整理」功能：让 AI 批量给错题打标签、归入合集、写考点，外加本地相似题聚类与薄弱诊断，全程「AI 提议 → 人工审阅 → 一键应用 → 可撤销」。

**Architecture:** 纯逻辑（解析 AI 输出 / 合并标签 / 解析并创建合集路径 / 应用计划 / 相似聚类 / 统计）全部放进 `lib.js` 并 TDD 覆盖；网络调用复用已有的 `aiCall()`；UI 复用现有 `.modal` / `.panel.wide` / `aiBusy` 模式，新增一个「AI 整理」弹层与一个「整理工具」弹层。

**Tech Stack:** 原生 JS（classic script，全局挂 `MQ` / 全局函数）、IndexedDB + localStorage、KaTeX（已有）、Node 内置 test runner（`node --test test/`）。

**约定：**
- 所有新增纯函数都必须导出（`lib.js` 末尾 `return {...}`）并在 `test/lib.test.js` 顶部解构引入。
- 测试命令：`node --test test/`；测试文件当前 97 条用例，新增后应为 97+N。
- 提交信息用中文、`feat:` 前缀（与仓库历史一致）。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib.js` | 新增 8 个纯函数 + `normalizeQuestion` 加 `kpId` 字段 |
| `test/lib.test.js` | 上述纯函数的单元测试 |
| `app.js` | AI 提示词、批量调用、两个弹层的渲染与交互、入口按钮、撤销 |
| `index.html` | 工具栏按钮 `#aiOrgBtn`、`#aiOrgModal`、`#aiToolsModal` |
| `styles.css` | 审阅表格 / 标签 chip 开关 / 合集下拉 / 统计表样式 |

---

## Task 1: lib.js — 错题增加 `kpId` 字段（关联知识点）

**Files:**
- Modify: `lib.js:89-109`（`normalizeQuestion`）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 末尾追加：

```js
/* ===================== kpId（错题 ↔ 知识点关联） ===================== */
test('normalizeQuestion 保留 kpId，非法值归 null', () => {
  assert.equal(normalizeQuestion({ kpId: 'k1' }).kpId, 'k1');
  assert.equal(normalizeQuestion({ kpId: '' }).kpId, null);
  assert.equal(normalizeQuestion({ kpId: 123 }).kpId, null);
  assert.equal(normalizeQuestion({}).kpId, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`kpId` 为 `undefined`（不等于 `'k1'`）。

- [ ] **Step 3: 实现**

`lib.js` 的 `normalizeQuestion` 返回值里，紧挨 `collectionId` 之后插入一行：

```js
      kpId: typeof o.kpId === 'string' && o.kpId ? o.kpId : null,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: 错题条目增加 kpId（关联知识点）字段"
```

---

## Task 2: lib.js — `normTag` / `mergeSuggestTags` / `parseAiJson`

**Files:**
- Modify: `lib.js`（新增函数，放在 `parseSearch` 之前）
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

```js
/* ===================== AI 整理：解析与标签合并 ===================== */
test('parseAiJson 容忍 ``` 围栏与前后废话', () => {
  assert.deepEqual(parseAiJson('[{"id":"a"}]'), [{ id: 'a' }]);
  assert.deepEqual(parseAiJson('```json\n[{"id":"a"}]\n```'), [{ id: 'a' }]);
  assert.deepEqual(parseAiJson('好的，结果如下：\n[{"id":"a"}]\n希望有帮助'), [{ id: 'a' }]);
  assert.deepEqual(parseAiJson('前言 {"paths":["高数/极限"]} 后记'), { paths: ['高数/极限'] });
  assert.equal(parseAiJson('完全不是 JSON'), null);
  assert.equal(parseAiJson(''), null);
});

test('normTag 去掉 # 前缀与首尾空白', () => {
  assert.equal(normTag('  #导数 '), '导数');
  assert.equal(normTag(null), '');
});

test('mergeSuggestTags 优先命中已有词表，限制新增数量', () => {
  const vocab = ['导数', '单调性', '中值定理'];
  // 建议里的 ' 导数 ' 归一后命中词表，采用词表原写法，不新增
  assert.deepEqual(mergeSuggestTags(['极限'], ['导数', ' 单调性 ', '拉格朗日'], vocab, 2), ['极限', '导数', '单调性', '拉格朗日']);
  // 超出 maxNew 的新标签被截断
  assert.deepEqual(mergeSuggestTags([], ['a', 'b', 'c'], [], 2), ['a', 'b']);
  // 去重
  assert.deepEqual(mergeSuggestTags(['导数'], ['导数', '#导数'], [], 3), ['导数']);
  // 空建议不改动
  assert.deepEqual(mergeSuggestTags(['x'], [], [], 3), ['x']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现**

在 `lib.js` 的 `/* ---------- 搜索语法 ---------- */` 注释之前插入：

```js
  /* ---------- AI 整理：输出解析与标签合并 ---------- */

  // 从 AI 输出里抽取 JSON：容忍 ```json 围栏、前后夹带的说明文字
  function parseAiJson(text) {
    const s = String(text == null ? '' : text);
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const body = (fence ? fence[1] : s).trim();
    try { return JSON.parse(body); } catch (e) { /* 继续退化尝试 */ }
    for (const [a, b] of [['[', ']'], ['{', '}']]) {
      const i = body.indexOf(a), j = body.lastIndexOf(b);
      if (i >= 0 && j > i) {
        try { return JSON.parse(body.slice(i, j + 1)); } catch (e) { /* 换下一种括号 */ }
      }
    }
    return null;
  }

  // 标签归一：去掉 # 前缀与首尾空白
  function normTag(t) {
    return String(t == null ? '' : t).replace(/^#+/, '').trim();
  }

  // 把 AI 建议的标签合并进已有标签：
  //  · 归一后能命中 vocab（现有词表）的，采用词表里的原写法，避免「导数/求导/微分」各写一份；
  //  · 其余作为新标签追加，最多补 maxNew 个；整体去重。
  function mergeSuggestTags(existing, suggested, vocab, maxNew) {
    const canonBy = new Map((Array.isArray(vocab) ? vocab : [])
      .map(v => normTag(v)).filter(Boolean)
      .map(v => [v.toLowerCase(), v]));
    const out = [];
    const has = t => out.includes(t);
    for (const t of (Array.isArray(existing) ? existing : [])) {
      const v = normTag(t);
      if (v && !has(v)) out.push(v);
    }
    const cap = Number.isFinite(maxNew) ? maxNew : 3;
    let added = 0;
    for (const s of (Array.isArray(suggested) ? suggested : [])) {
      const v = normTag(s);
      if (!v) continue;
      const canon = canonBy.get(v.toLowerCase()) || v;
      if (has(canon)) continue;
      if (added >= cap) break;
      out.push(canon);
      added++;
    }
    return out;
  }
```

并在末尾 `return {...}` 中加入：`parseAiJson, normTag, mergeSuggestTags,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: 新增 AI 输出解析与标签合并纯函数"
```

---

## Task 3: lib.js — `resolveCollectionPath` / `applyOrganizePlan`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

```js
/* ===================== AI 整理：路径解析与应用计划 ===================== */
test('resolveCollectionPath 逐级创建，重复调用复用同一节点', () => {
  let cols = [];
  const r1 = resolveCollectionPath(cols, '高等数学/极限', 1000);
  cols = r1.cols;
  assert.equal(cols.length, 2);
  assert.equal(collectionPath(cols, r1.id).map(c => c.name).join('/'), '高等数学/极限');

  const r2 = resolveCollectionPath(cols, '高等数学/极限', 2000);
  assert.equal(r2.cols.length, 2);           // 不重复创建
  assert.equal(r2.id, r1.id);

  const r3 = resolveCollectionPath(r2.cols, '高等数学> 导数', 3000);
  assert.equal(r3.cols.length, 3);            // 复用「高等数学」，新建「导数」
  assert.equal(r3.id, r3.cols.find(c => c.name === '导数').id);
});

test('resolveCollectionPath 空路径返回 id=null 且不改动合集', () => {
  const cols = [];
  assert.deepEqual(resolveCollectionPath(cols, '', 1), { cols: [], id: null });
  assert.deepEqual(resolveCollectionPath(cols, '   ', 1).id, null);
});

test('applyOrganizePlan 合并标签、归入合集、写考点，并新建合集', () => {
  const items = [
    normalizeQuestion({ id: 'q1', stem: 'a', tags: ['极限'] }),
    normalizeQuestion({ id: 'q2', stem: 'b' }),
  ];
  const plan = [
    { id: 'q1', tags: ['导数'], collectionPath: '高等数学/极限', knowledge: '考点A' },
    { id: 'q2', tags: ['行列式'], collectionPath: '线性代数/行列式', knowledge: '考点B' },
  ];
  const r = applyOrganizePlan(items, plan, { cols: [], vocab: ['导数'], now: 5000 });
  assert.equal(r.changed, 2);
  assert.deepEqual(r.items[0].tags, ['极限', '导数']);
  assert.equal(r.items[0].knowledge, '考点A');
  assert.equal(r.items[0].updatedAt, 5000);
  assert.equal(collectionPath(r.cols, r.items[0].collectionId).map(c => c.name).join('/'), '高等数学/极限');
  assert.equal(r.cols.length, 4);             // 高数/极限 + 线代/行列式
  assert.deepEqual(r.items[1].tags, ['行列式']);
  // 原有 knowledge 非空时不覆盖
  const r2 = applyOrganizePlan([normalizeQuestion({ id: 'q3', knowledge: '已写' })],
    [{ id: 'q3', knowledge: '新' }], { cols: [] });
  assert.equal(r2.items[0].knowledge, '已写');
  assert.equal(r2.changed, 0);
});

test('applyOrganizePlan 跳过 skip 项，不改动原数组', () => {
  const items = [normalizeQuestion({ id: 'q1', stem: 'a' })];
  const snap = JSON.stringify(items);
  const r = applyOrganizePlan(items, [{ id: 'q1', tags: ['x'], skip: true }], { cols: [] });
  assert.equal(r.changed, 0);
  assert.equal(JSON.stringify(items), snap);
  assert.deepEqual(r.items[0].tags, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现**

紧跟 Task 2 新增代码之后插入：

```js
  // 按「高等数学/极限」「高等数学 > 极限」这类路径查找合集；缺哪级就建哪级。
  // 返回新的 cols 与末级节点 id（路径为空时 id=null，cols 原样返回）。
  function resolveCollectionPath(cols, path, now) {
    const t = now || Date.now();
    const parts = String(path == null ? '' : path)
      .split(/\s*(?:\/|>|＞|\\)\s*/).map(s => s.trim()).filter(Boolean);
    let list = Array.isArray(cols) ? cols.slice() : [];
    if (!parts.length) return { cols: list, id: null };
    let parentId = null, id = null;
    for (const name of parts) {
      let found = list.find(c => (c.parentId || null) === parentId && c.name === name);
      if (!found) {
        const r = addCollection(list, name, parentId, t);
        list = r.cols;
        found = r.node;
      }
      id = found.id;
      parentId = found.id;
    }
    return { cols: list, id };
  }

  /* 把审阅后的 AI 计划应用到错题数组（纯函数，不改动入参对象）。
     plan:  [{ id, tags?, collectionPath?, knowledge?, kpTitle?, skip? }]
     opts:  { cols, vocab, maxNewTags, now, matchKp }
       matchKp: (title) => kpId | null   用于把「考点名」挂到知识点库条目上（缺省不处理）
     返回:  { items, cols, changed } */
  function applyOrganizePlan(items, plan, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const decided = new Map();
    for (const p of (Array.isArray(plan) ? plan : [])) {
      if (p && typeof p.id === 'string' && !p.skip) decided.set(p.id, p);
    }
    let cols = Array.isArray(o.cols) ? o.cols.slice() : [];
    const pathCache = new Map();
    let changed = 0;
    const out = (Array.isArray(items) ? items : []).map(it => {
      const p = it && decided.get(it.id);
      if (!p) return it;
      let next = it, dirty = false;
      const set = (k, v) => { if (next[k] !== v) { next = Object.assign({}, next, { [k]: v }); dirty = true; } };

      if (Array.isArray(p.tags) && p.tags.length) {
        const tags = mergeSuggestTags(next.tags, p.tags, o.vocab, o.maxNewTags);
        if (tags.join('\u0001') !== (next.tags || []).join('\u0001')) set('tags', tags);
      }
      if (typeof p.collectionPath === 'string' && p.collectionPath.trim()) {
        const key = p.collectionPath.trim();
        if (!pathCache.has(key)) pathCache.set(key, resolveCollectionPath(cols, key, now));
        const r = pathCache.get(key);
        cols = r.cols;
        if (r.id && next.collectionId !== r.id) set('collectionId', r.id);
      }
      if (typeof p.knowledge === 'string' && p.knowledge.trim() && !next.knowledge) {
        set('knowledge', p.knowledge.trim());
      }
      if (typeof p.kpTitle === 'string' && p.kpTitle.trim() && typeof o.matchKp === 'function') {
        const kpId = o.matchKp(p.kpTitle.trim());
        if (kpId && next.kpId !== kpId) set('kpId', kpId);
      }
      if (dirty) { next = Object.assign({}, next, { updatedAt: now }); changed++; }
      return next;
    });
    return { items: out, cols, changed };
  }
```

`return {...}` 中加入：`resolveCollectionPath, applyOrganizePlan,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: 新增合集路径解析与 AI 计划应用纯函数"
```

---

## Task 4: lib.js — `clusterBySimilarity` / `groupStats`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

- [ ] **Step 1: 写失败测试**

```js
/* ===================== 期3：相似聚类与分组统计 ===================== */
test('clusterBySimilarity 把高度相似项归组，相似度低于阈值的不归组', () => {
  const items = [
    normalizeQuestion({ id: 'a', stem: '求函数 f(x)=x^2-2x+1 的最小值' }),
    normalizeQuestion({ id: 'b', stem: '求函数 f(x)=x^2-2x+1 的最小值。' }),
    normalizeQuestion({ id: 'c', stem: '求矩阵 A 的行列式' }),
  ];
  const cs = clusterBySimilarity(items, 0.75, it => it.stem);
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].map(x => x.id), ['a', 'b']);
});

test('clusterBySimilarity 空输入与无重复都返回空数组', () => {
  assert.deepEqual(clusterBySimilarity([], 0.75, it => it.stem), []);
  const items = [normalizeQuestion({ id: 'a', stem: '甲' }), normalizeQuestion({ id: 'b', stem: '乙丙丁戊' })];
  assert.deepEqual(clusterBySimilarity(items, 0.9, it => it.stem), []);
});

test('groupStats 按 key 计数并统计到期/状态', () => {
  const now = 1000;
  const items = [
    normalizeQuestion({ id: '1', tags: ['导数'], status: 'mastered', srs: { due: 0 } }),
    normalizeQuestion({ id: '2', tags: ['导数', '单调性'], status: 'new', srs: { due: 0 } }),
    normalizeQuestion({ id: '3', tags: ['导数'], status: 'reviewing', srs: { due: 9999999999999 } }),
  ];
  const gs = groupStats(items, it => it.tags, now);
  assert.deepEqual(gs[0], { key: '导数', count: 3, due: 2, newc: 1, reviewing: 1, mastered: 1 });
  assert.equal(gs[1].key, '单调性');
  assert.equal(gs[1].count, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现**

```js
  /* ---------- 期3：相似题聚类（纯本地，零 API 成本） ----------
     贪心聚类：按顺序取未归组的项作「种子」，把其后与种子相似度 >= threshold 的项并入同组；
     只有成员数 >= 2 的组会被返回。textOf 缺省取 stem。 */
  function clusterBySimilarity(items, threshold, textOf) {
    const arr = Array.isArray(items) ? items : [];
    const th = Number.isFinite(threshold) ? threshold : 0.75;
    const pick = typeof textOf === 'function' ? textOf : (it => it && it.stem);
    const profiles = arr.map(it => makeGramProfile(pick(it) || ''));
    const used = new Array(arr.length).fill(false);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const group = [arr[i]];
      for (let j = i + 1; j < arr.length; j++) {
        if (used[j]) continue;
        if (simFromProfile(profiles[i], pick(arr[j]) || '') >= th) { used[j] = true; group.push(arr[j]); }
      }
      if (group.length > 1) out.push(group);
    }
    return out;
  }

  /* ---------- 期3：分组统计（供薄弱诊断，纯本地） ----------
     pick: it => key | [keys] | null     统计每个 key 的条目数、到期数、三态分布。
     按 count 降序，同 count 按 key 中文序。 */
  function groupStats(items, pick, now) {
    const t = now || Date.now();
    const m = new Map();
    for (const it of (Array.isArray(items) ? items : [])) {
      const raw = typeof pick === 'function' ? pick(it) : null;
      const keys = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
      for (const k of keys) {
        if (!k) continue;
        const key = normTag(k);
        if (!key) continue;
        const g = m.get(key) || { key, count: 0, due: 0, newc: 0, reviewing: 0, mastered: 0 };
        g.count++;
        if (it.status === 'mastered') g.mastered++;
        else if (it.status === 'reviewing') g.reviewing++;
        else g.newc++;
        if (isDue(it, t)) g.due++;
        m.set(key, g);
      }
    }
    return [...m.values()].sort((a, b) => (b.count - a.count) || String(a.key).localeCompare(String(b.key), 'zh'));
  }
```

`return {...}` 中加入：`clusterBySimilarity, groupStats,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: 新增相似题聚类与分组统计纯函数"
```

---

## Task 5: app.js — AI 提示词（整理 / 分类树 / 诊断 / 免 Key 整段）

**Files:**
- Modify: `app.js`（紧跟 `aiPromptText()` 之后）

- [ ] **Step 1: 实现（无单测；纯字符串拼装，靠浏览器验收）**

```js
/* ---------- AI 整理：提示词 ----------
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
```

- [ ] **Step 2: 语法自检**

Run: `node -e "require('./lib.js'); console.log('lib ok')"`
Expected: 输出 `lib ok`（app.js 无 DOM 依赖无法直接 require，此处只保证 lib 未受影响）。

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: 新增 AI 整理提示词（整理/分类树/诊断/免Key）"
```

---

## Task 6: app.js — 批量调用 `aiOrganizeRun`

**Files:**
- Modify: `app.js`（紧跟 Task 5 代码之后）

- [ ] **Step 1: 实现**

```js
/* ---------- AI 整理：分批请求，合并结果 ----------
   返回 { plan:[{id,tags?,collectionPath?,knowledge?}], ok, failed:[id], errors:[] } */
async function aiOrganizeRun(items, dims, onProgress) {
  const list = Array.isArray(items) ? items : [];
  const plan = [], failed = [], errors = [];
  const total = list.length;
  for (let i = 0; i < total; i += AI_ORG_BATCH) {
    const chunk = list.slice(i, i + AI_ORG_BATCH);
    if (typeof onProgress === 'function') onProgress(Math.min(i + AI_ORG_BATCH, total), total);
    const text = await aiCall({ system: aiOrgJsonRules(dims), ask: aiOrgUserText(chunk) });
    const arr = parseAiJson(text);
    if (!Array.isArray(arr)) { errors.push(`第 ${i / AI_ORG_BATCH + 1} 批返回的不是 JSON 数组`); chunk.forEach(c => failed.push(c.id)); continue; }
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

// 同上，但走免 Key：直接解析用户粘回来的文本
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
```

- [ ] **Step 2: 提交**

```bash
git add app.js
git commit -m "feat: 新增 AI 整理的分批请求与免Key结果解析"
```

---

## Task 7: index.html — 入口按钮与两个弹层结构

**Files:**
- Modify: `index.html:45`（工具栏按钮）、`index.html:280` 之后（弹层）

- [ ] **Step 1: 加按钮**

在 `index.html` 第 45 行 `aiBtn` 之后插入：

```html
  <button id="aiOrgBtn" title="让 AI 批量给错题打标签 / 归档 / 写考点">🧠 AI 整理</button>
```

- [ ] **Step 2: 加弹层**

在 `<!-- 回收站 -->` 之前插入：

```html
<!-- AI 整理：范围/维度 → 提议 → 审阅 → 应用 -->
<div class="modal" id="aiOrgModal">
  <div class="panel wide">
    <h2 id="aiOrgTitle">AI 整理错题</h2>
    <p class="hint" id="aiOrgHint">AI 只负责<b>提议</b>，下面会列出每一条建议让你核对，确认后才写入。使用时会联网，错题原文会发送到你配置的服务商。</p>

    <!-- 步骤 1：设置 -->
    <div id="aiOrgSetup">
      <div class="ai-org-fields">
        <label class="ai-label">整理范围</label>
        <select id="aiOrgScope">
          <option value="all">全部错题</option>
          <option value="filtered">当前筛选结果</option>
          <option value="qualified">仅未分类或空白错题</option>
        </select>
        <label class="ai-label">整理维度（可多选）</label>
        <label class="chkline"><input type="checkbox" id="aiOrgDimTags" checked> 打标签</label>
        <label class="chkline"><input type="checkbox" id="aiOrgDimCol" checked> 归入合集</label>
        <label class="chkline"><input type="checkbox" id="aiOrgDimKp"> 写考点讲解</label>
        <p class="setnote" id="aiOrgVocabNote"></p>
      </div>
      <div class="row">
        <button class="primary" id="aiOrgRun">开始整理</button>
        <button class="ghost" id="aiOrgTree">先让 AI 建议分类体系</button>
        <button class="ghost" id="aiOrgCopy">复制提示词（免 Key）</button>
        <span class="spacer"></span>
        <button class="ghost" id="aiOrgCancel">取消</button>
        <span class="badge-note" id="aiOrgMsg"></span>
      </div>
    </div>

    <!-- 步骤 2：粘贴 AI 输出（免 Key 路径） -->
    <div id="aiOrgPasteWrap" style="display:none">
      <p class="hint">把上面复制的内容粘到任意 AI，再把它的输出整段粘回下面。</p>
      <textarea id="aiOrgPaste" placeholder='粘贴 AI 输出的 JSON 数组'></textarea>
      <div class="row">
        <button class="primary" id="aiOrgPasteGo">解析并进入审阅</button>
        <button class="ghost" id="aiOrgPasteBack">返回</button>
      </div>
    </div>

    <!-- 步骤 3：分类树建议 -->
    <div id="aiOrgTreeWrap" style="display:none">
      <p class="hint">AI 建议的分类体系（可改：每行一个「一级/二级」路径）。点「创建这些合集」后会按该体系建好空合集。</p>
      <textarea id="aiOrgTreeText"></textarea>
      <div class="row">
        <button class="primary" id="aiOrgTreeCreate">创建这些合集</button>
        <button class="ghost" id="aiOrgTreeBack">返回</button>
      </div>
    </div>

    <!-- 步骤 4：审阅 -->
    <div id="aiOrgReviewWrap" style="display:none">
      <p class="hint" id="aiOrgReviewMsg"></p>
      <div class="ai-org-table" id="aiOrgReview"></div>
      <div class="row">
        <button class="primary" id="aiOrgApply">应用并保存</button>
        <button class="ghost" id="aiOrgAll">全选</button>
        <button class="ghost" id="aiOrgNone">全不选</button>
        <span class="spacer"></span>
        <button class="ghost" id="aiOrgUndo" style="display:none">撤销上次应用</button>
        <button class="ghost" id="aiOrgClose">关闭</button>
      </div>
    </div>
  </div>
</div>

<!-- 整理工具：相似题检测 / 薄弱诊断 -->
<div class="modal" id="aiToolsModal">
  <div class="panel wide">
    <h2>整理工具</h2>
    <p class="hint">这两个功能优先用本地计算，零 API 成本；「让 AI 点评」是可选的。</p>
    <div class="row">
      <button id="aiToolDup">找出相似/重复错题</button>
      <button id="aiToolWeak">薄弱考点诊断</button>
      <span class="spacer"></span>
      <button class="ghost" id="aiToolsClose">关闭</button>
    </div>
    <div class="ai-org-table" id="aiToolsBody"></div>
    <div class="row" id="aiToolsAiRow" style="display:none">
      <button class="ghost" id="aiToolsAiBtn">让 AI 点评</button>
      <span class="badge-note" id="aiToolsMsg"></span>
    </div>
  </div>
</div>
```

- [ ] **Step 3: 加「整理工具」入口**

在第 46 行 `colToggle` 之后插入：

```html
  <button id="aiToolsBtn" title="相似题检测 / 薄弱诊断">🔍 整理工具</button>
```

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "feat: 新增 AI 整理与整理工具的界面结构"
```

---

## Task 8: app.js — 弹层渲染与交互（设置 / 审阅 / 应用 / 撤销）

**Files:**
- Modify: `app.js`（文件末尾，`/* ---- 启动 ---- */` 之前）

- [ ] **Step 1: 实现**

```js
/* ===================== AI 整理弹层 ===================== */
const orgEl = id => document.getElementById(id);
const orgModal = orgEl('aiOrgModal');
let orgState = null;              // { items, dims, plan, rows, undo }
let orgCtrl = null;               // AbortController 复用 aiCall 的

function orgDims() {
  return { tags: orgEl('aiOrgDimTags').checked, collection: orgEl('aiOrgDimCol').checked, knowledge: orgEl('aiOrgDimKp').checked };
}
function orgPickItems() {
  const scope = orgEl('aiOrgScope').value;
  if (active !== 'q') return [];
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
    orgEl('aiOrgMsg').textContent = r.errors.length ? r.errors.join('；') : '';
    renderAiOrgReview();
    orgShowStep('aiOrgReviewWrap');
  } catch (e) {
    hideAiBusy();
    const m = (e && e.name === 'AbortError') ? '已取消。' : '整理失败：' + ((e && e.message) || e);
    orgEl('aiOrgMsg').textContent = m;
  } finally { orgEl('aiOrgRun').disabled = false; }
};

// 审阅表：每行 = 跳过勾选 + 题干摘要 + 标签开关 + 合集下拉 + 考点文本框
function renderAiOrgReview() {
  const st = orgState;
  const box = orgEl('aiOrgReview');
  if (!st) { box.innerHTML = ''; return; }
  const vocab = allTags();
  const byId = new Map(st.items.map(it => [it.id, it]));
  const rows = st.plan.map(p => Object.assign({ skip: false }, p));
  st.rows = rows;

  box.innerHTML = rows.map((row, i) => {
    const it = byId.get(row.id) || {};
    const curTags = Array.isArray(row.tags) ? row.tags.slice() : [];
    const chips = curTags.map(t => `<span class="aio-chip" data-chip="${i}|${esc(t)}">${esc(t)}<b>×</b></span>`).join('');
    const colOpts = collectionOptionsHtml('q', null)
      .replace('<option value="" shape="selected">', '');
    return `<div class="aio-row" data-row="${i}">
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

  box.querySelectorAll('[data-skip]').forEach(cb => cb.onchange = () => { rows[+cb.dataset.skip].skip = cb.checked; });
  box.querySelectorAll('[data-chip]').forEach(el => el.onclick = () => {
    const [i, t] = el.dataset.chip.split('|');
    const row = rows[+i];
    row.tags = (row.tags || []).filter(x => x !== t);
    renderAiOrgReview();
  });
  box.querySelectorAll('[data-tagadd]').forEach(inp => inp.onchange = () => {
    const i = +inp.dataset.tagadd, v = inp.value.trim();
    if (!v) return;
    const row = rows[i];
    row.tags = mergeSuggestTags(row.tags || [], [v], [], 99);
    renderAiOrgReview();
  });
  box.querySelectorAll('[data-path]').forEach(inp => inp.onchange = () => { rows[+inp.dataset.path].collectionPath = inp.value.trim(); });
  box.querySelectorAll('[data-know]').forEach(ta => ta.onchange = () => { rows[+ta.dataset.know].knowledge = ta.value; });
  orgEl('aiOrgReviewMsg').textContent = `共 ${rows.length} 条建议（AI 未返回的 ${st.items.length - rows.length} 道已跳过）。`;
}

orgEl('aiOrgAll').onclick = () => { if (orgState) { orgState.rows.forEach(r => r.skip = false); renderAiOrgReview(); } };
orgEl('aiOrgNone').onclick = () => { if (orgState) { orgState.rows.forEach(r => r.skip = true); renderAiOrgReview(); } };

// 应用：快照 + 写回 + 可撤销
orgEl('aiOrgApply').onclick = async () => {
  const st = orgState;
  if (!st) return;
  const active_ = st.rows.filter(r => !r.skip);
  if (!active_.length) { alert('没有选中任何一条建议。'); return; }
  st.undo = stores.q.items.map(it => ({ id: it.id, tags: it.tags.slice(), collectionId: it.collectionId, knowledge: it.knowledge, kpId: it.kpId }));
  const matchKp = title => {
    const hit = stores.k.items.find(k => (k.title || '').trim() === title);
    return hit ? hit.id : null;
  };
  const r = applyOrganizePlan(stores.q.items, active_, { cols: colStores.q, vocab: allTags(), matchKp });
  stores.q.items = r.items;
  if (r.cols !== colStores.q) { colStores.q = r.cols; await saveCols('q'); }
  await saveStore(stores.q.key, stores.q.items);
  render();
  orgEl('aiOrgUndo').style.display = '';
  orgEl('aiOrgMsg').textContent = `已应用 ${r.changed} 条改动。`;
  orgModal.classList.remove('open');
  setTimeout(() => { if (confirm('已应用 ' + r.changed + ' 条改动。要撤销吗？')) undoAiOrg(); }, 60);
};

function undoAiOrg() {
  const st = orgState;
  if (!st || !st.undo) return;
  const byId = new Map(st.undo.map(x => [x.id, x]));
  stores.q.items = stores.q.items.map(it => { const u = byId.get(it.id); return u ? Object.assign({}, it, u) : it; });
  saveStore(stores.q.key, stores.q.items);
  render();
  orgEl('aiOrgMsg').textContent = '已撤销。';
  st.undo = null;
  orgEl('aiOrgUndo').style.display = 'none';
}
orgEl('aiOrgUndo').onclick = () => undoAiOrg();

document.getElementById('aiOrgBtn').onclick = openAiOrg;
```

- [ ] **Step 2: 自检**

Run: `node -e "const s=require('fs').readFileSync('app.js','utf8'); new Function(s.replace(/^/,'if(1){}'))"` — 若因浏览器全局而报错可忽略，重点看是否报 **语法** 错误（SyntaxError）。
Expected: 无 SyntaxError。

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: AI 整理弹层（范围/维度、审阅表、应用与撤销）"
```

---

## Task 9: app.js — 分类树建议 + 免 Key 粘贴 + 整理工具（相似题/薄弱诊断）

**Files:**
- Modify: `app.js`（Task 8 代码之后）

- [ ] **Step 1: 分类树建议**

```js
// 让 AI 建议分类体系 → 可编辑 → 一键建合集
orgEl('aiOrgTree').onclick = async () => {
  if (!aiReady()) { alert('这个功能需要配置 AI；也可以自己在下面手写分类路径。'); orgShowStep('aiOrgTreeWrap'); orgEl('aiOrgTreeText').value = ''; return; }
  showAiBusy('AI 正在建议分类体系…');
  try {
    const text = await aiCall({ system: aiTreePrompt(), ask: aiOrgUserText(orgPickItems().slice(0, AI_ORG_BATCH)) });
    const o = parseAiJson(text);
    const paths = (o && Array.isArray(o.paths)) ? o.paths.filter(p => typeof p === 'string' && p.trim()) : [];
    hideAiBusy();
    orgEl('aiOrgTreeText').value = paths.join('\n');
    if (!paths.length) orgEl('aiOrgMsg').textContent = 'AI 没有给出可用路径，请在下面手动写。';
    orgShowStep('aiOrgTreeWrap');
  } catch (e) { hideAiBusy(); orgEl('aiOrgMsg').textContent = '建议失败：' + ((e && e.message) || e); }
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
```

- [ ] **Step 2: 免 Key 粘贴路径**

```js
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
  orgEl('aiOrgMsg').textContent = '提示词已复制。';
};
orgEl('aiOrgPasteBack').onclick = () => orgShowStep('aiOrgSetup');
orgEl('aiOrgPasteGo').onclick = () => {
  if (!orgState) return;
  const text = orgEl('aiOrgPaste').value;
  const r = aiOrganizeParsePasted(text, orgState.items, orgState.dims);
  orgState.plan = r.plan;
  orgEl('aiOrgMsg').textContent = r.errors.join('；');
  renderAiOrgReview();
  orgShowStep('aiOrgReviewWrap');
};
```

- [ ] **Step 3: 整理工具（相似题 / 薄弱诊断 + AI 点评）**

```js
/* ===================== 整理工具 ===================== */
const toolsModal = orgEl('aiToolsModal');
let toolsLastTable = '';

orgEl('aiToolsBtn').onclick = () => { toolsModal.classList.add('open'); orgEl('aiToolsBody').innerHTML = ''; orgEl('aiToolsMsg').textContent = ''; orgEl('aiToolsAiRow').style.display = 'none'; };
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
      ${g.map(it => `<div class="aio-group-row" data-gid="${esc(it.id)}">
        <span class="aio-stem">${renderMath(String(it.stem || '').slice(0, 120))}</span>
        <button class="ghost" data-gopen="${esc(it.id)}">打开</button>
        <button class="danger" data-gdel="${esc(it.id)}">删除</button>
      </div>`).join('')}
    </div>`).join('');
  body.querySelectorAll('[data-gopen]').forEach(b => b.onclick = () => openDetail(b.dataset.gopen));
  body.querySelectorAll('[data-gdel]').forEach(b => b.onclick = () => {
    const it = stores.q.items.find(x => x.id === b.dataset.gdel);
    if (!it) return;
    const hint = String(it.stem || '').slice(0, 40);
    if (!confirm(`删除这道错题？\n${hint}…\n（会进回收站，30 天内可恢复）`)) return;
    deleteItem(it.id);
    b.closest('.aio-group-row').remove();
  });
};

orgEl('aiToolWeak').onclick = async () => {
  if (active !== 'q') { alert('只针对错题库。'); return; }
  const gs = groupStats(stores.q.items, it => it.tags, Date.now());
  const body = orgEl('aiToolsBody');
  if (!gs.length) { body.innerHTML = '<div class="empty">还没有标签，先做一次「AI 整理 → 打标签」。</div>'; orgEl('aiToolsAiRow').style.display = 'none'; return; }
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
  } catch (e) { hideAiBusy(); orgEl('aiToolsMsg').textContent = '诊断失败：' + ((e && e.message) || e); }
};
```

- [ ] **Step 4: 自检语法**

Run: `node --check app.js`
Expected: 无输出（通过）。若 `node --check` 因浏览器全局不适用，改用 `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"`，只关心 SyntaxError。

- [ ] **Step 5: 提交**

```bash
git add app.js
git commit -m "feat: 分类树建议、免Key粘贴路径与整理工具（相似题/薄弱诊断）"
```

---

## Task 10: styles.css — 审阅表 / chip / 统计表样式

**Files:**
- Modify: `styles.css`（文件末尾追加）

- [ ] **Step 1: 追加样式**

```css
/* ---------- AI 整理 ---------- */
.ai-org-fields{display:grid; gap:10px; margin-bottom:8px;}
.chkline{font-size:13px; color:var(--text); display:inline-flex; align-items:center; gap:6px; margin-right:14px;}
.ai-org-table{margin:12px 0; max-height:52vh; overflow:auto; border:1px solid var(--line); border-radius:10px;}
.aio-row{display:grid; grid-template-columns:26px 1fr; gap:4px 10px; padding:10px 12px; border-bottom:1px solid var(--line);}
.aio-row:last-child{border-bottom:0;}
.aio-skip{padding-top:3px;}
.aio-stem{font-size:13px; color:var(--text-2); line-height:1.5; overflow-wrap:anywhere;}
.aio-fields{grid-column:2; display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start;}
.aio-tags{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
.aio-chip{background:var(--brand-soft); color:var(--brand); border-radius:20px; padding:2px 10px; font-size:12px; cursor:pointer;}
.aio-chip b{margin-left:5px; opacity:.6;}
.aio-tagin,.aio-path,.aio-know{font-size:12px; padding:4px 8px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--text);}
.aio-tagin{width:96px;}
.aio-path{width:210px;}
.aio-know{width:100%; min-height:44px; font-family:inherit;}
.aio-group{margin:8px 0 14px;}
.aio-group-h{font-size:13px; color:var(--muted); margin-bottom:6px;}
.aio-group-row{display:flex; gap:8px; align-items:center; padding:6px 0; border-bottom:1px dashed var(--line);}
.aio-group-row .aio-stem{flex:1;}
.aio-tbl{width:100%; border-collapse:collapse; font-size:13px;}
.aio-tbl th,.aio-tbl td{padding:6px 8px; border-bottom:1px solid var(--line); text-align:left;}
.aio-tbl th{color:var(--muted); font-weight:600;}
.aio-diagnose{margin-top:12px; padding:12px; border-radius:10px; background:var(--brand-soft); color:var(--text); font-size:13px; line-height:1.7; white-space:pre-wrap;}
```

> 注：`--card` / `--card-2` / `--text-2` 若仓库未定义，改为已有的 `--panel` / `--text`；实现时先 `grep` 确认变量名再落笔。

- [ ] **Step 2: 提交**

```bash
git add styles.css
git commit -m "feat: AI 整理相关样式"
```

---

## Task 11: 浏览器验收 + 手工回归

**Files:** 无（只验证）

- [ ] **Step 1: 起本地服务并跑测试**

```bash
node --test test/
python3 -m http.server 8123 &
```

- [ ] **Step 2: 浏览器验证（无法真实调 AI，用注入方式模拟 AI 返回）**

在页面里 `browser_evaluate`：
1. 点开 `#aiOrgBtn`，确认弹层打开、范围/维度可见、词表提示正确。
2. 造 3 道错题 + 预置 `orgState`（模拟 AI 返回）→ 调 `renderAiOrgReview()`，确认审阅表渲染出 chip / 路径输入 / 考点框。
3. 调 `applyOrganizePlan` 走一遍应用：确认标签写入、`collectionPath` 建出合集、`knowledge` 写入、`updatedAt` 更新。
4. 调 `undoAiOrg()` 确认回滚。
5. 点 `#aiToolsBtn` → 「找出相似/重复错题」造两道几乎相同的题，确认聚成一组；「薄弱考点诊断」确认表格渲染。
6. 收集 console 错误。

- [ ] **Step 3: 提交（若有修正）**

```bash
git add -A && git commit -m "fix: AI 整理浏览器验收修正"
```

---

## Self-Review

**1. Spec coverage**
- 期1 打标签 → Task 2（mergeSuggestTags）+ Task 5/6（提示词/调用）+ Task 8（审阅/应用）。
- 期2 分类体系 + 归合集 → Task 3（resolveCollectionPath / applyOrganizePlan）+ Task 9（aiTreePrompt 建树）。
- 期3 去重聚类 → Task 4（clusterBySimilarity）+ Task 9（相似题面板）。
- 期3 错题↔知识点 → Task 1（kpId）+ Task 3（`matchKp`）+ Task 8（apply 时匹配知识点库）。
- 期3 薄弱诊断 → Task 4（groupStats）+ Task 5（aiDiagnosePrompt）+ Task 9（面板 + AI 点评）。
- 免 Key 路径 → Task 5（aiOrgPromptText）+ Task 9（粘贴解析 `aiOrganizeParsePasted`）。
- 隐私提示 → Task 7（弹层 hint）。

**2. Placeholder scan**：无 TBD / TODO；每个 Task 都给了可落笔的代码。

**3. Type consistency**
- `applyOrganizePlan(items, plan, opts)` 的 `opts.{cols,vocab,maxNewTags,now,matchKp}` 与 Task 8 调用一致。
- `aiOrganizeRun(items, dims, onProgress)` → 返回 `{plan,failed,errors,ok}`，Task 8 消费 `.plan/.errors` 一致。
- `clusterBySimilarity(items, threshold, textOf)`、`groupStats(items, pick, now)` 与 Task 9 调用一致。
- `resolveCollectionPath(cols, path, now)` → `{cols,id}`，Task 3/8/9 用法一致。
- 审阅表字段名 `tags / collectionPath / knowledge / skip` 在 `renderAiOrgReview` 与 `applyOrganizePlan` 两侧一致。

**已知风险（实现时注意）**
- `collectionOptionsHtml` 在 Task 8 里被复用但只需其 `<option>` 形态；实现时若不合适就直接写 `<select>` + 生成 option。
- `deleteItem(id)` / `openDetail(id)` 必须是仓库里已存在的函数名；实现前先 `grep` 确认，否则改为调用已有等价函数。
- `currentFiltered()` 必须在 `active==='q'` 时可用；先 `grep` 确认名称。
