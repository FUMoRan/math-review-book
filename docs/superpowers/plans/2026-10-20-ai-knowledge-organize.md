# AI 按错题整理知识点（考点体系 + 挂载）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 从错题出发，在知识点库里建出一套三层考点体系（学科 / 章节 / 考点），再把每道错题挂到相关考点上（多对多），并为真正被挂到的考点补写讲解；全程「AI 提议 → 人工审阅 → 一键应用 → 可撤销」。

**Architecture:** 纯逻辑（体系落地计划 / 挂载应用 / 讲解写入 / 使用统计 / 错题 `kpId`→`kpIds` 迁移）全部放进 `lib.js` 并 TDD 覆盖；网络调用复用 `aiCall()`，JSON 解析复用 `parseAiJson()`，合集创建复用 `resolveCollectionPath()`，名称归一化复用 `normText()`；UI 复用现有 `.modal` / `.panel.wide` / `aiBusy` / 审阅表 / 撤销模式，新增一个「AI 整理知识点」弹层。

**Tech Stack:** 原生 JS（classic script，全局函数 + `MQ` 命名空间）、IndexedDB + localStorage、KaTeX（已有）、Node 内置 test runner（`node --test test/`）。

**约定：**
- 所有新增纯函数必须导出（`lib.js` 末尾 `return {...}`）并在 `test/lib.test.js` 顶部解构引入。
- 测试命令：`node --test test/`；当前基线 **109 条用例**，新增后应为 109+N。
- 提交信息用中文、`feat:` 前缀（与仓库历史一致）。
- 设计依据：`docs/superpowers/specs/2026-10-20-ai-knowledge-organize-design.md`。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib.js` | `normalizeQuestion` 的 `kpId` → `kpIds` 迁移；`applyOrganizePlan` 改挂 `kpIds`；新增 `planKpTaxonomy` / `applyKpLinks` / `applyKpExplain` / `kpUsage` |
| `test/lib.test.js` | 上述纯函数的单元测试；改掉 2 处已有的 `kpId` 断言 |
| `app.js` | 3 条新提示词 + 免 Key 拼装 + 四屏弹层状态机 + `relatedCount` 改按 `kpIds` + 删除知识点时清理引用 |
| `index.html` | 工具栏按钮 `#aiKpBtn`、弹层 `#aiKpModal` |
| `styles.css` | 体系审阅行的缩进与「新建 / 复用」标记样式 |

---

## Task 1: lib.js — 错题 `kpId` → `kpIds`（多对多 + 老数据迁移）

**Files:**
- Modify: `lib.js:89-110`（`normalizeQuestion`）
- Modify: `test/lib.test.js:918-924`（改掉旧的单值断言）

- [ ] **Step 1: 改写失败测试**

把 `test/lib.test.js` 第 918-924 行整段替换为：

```js
/* ===================== 错题 ↔ 知识点（多对多） ===================== */
test('normalizeQuestion 把 kpIds 归一为去重后的字符串数组', () => {
  assert.deepEqual(normalizeQuestion({ kpIds: ['k1', 'k2'] }).kpIds, ['k1', 'k2']);
  assert.deepEqual(normalizeQuestion({ kpIds: ['k1', 'k1', '', 123, null] }).kpIds, ['k1']);
  assert.deepEqual(normalizeQuestion({ kpIds: 'k1' }).kpIds, []);
  assert.deepEqual(normalizeQuestion({}).kpIds, []);
});

test('normalizeQuestion 把旧的单值 kpId 迁移进 kpIds', () => {
  assert.deepEqual(normalizeQuestion({ kpId: 'k1' }).kpIds, ['k1']);
  assert.deepEqual(normalizeQuestion({ kpId: '' }).kpIds, []);
  assert.deepEqual(normalizeQuestion({ kpId: 123 }).kpIds, []);
  // 已有 kpIds 时以 kpIds 为准，忽略旧的 kpId
  assert.deepEqual(normalizeQuestion({ kpId: 'old', kpIds: ['k2'] }).kpIds, ['k2']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`normalizeQuestion({}).kpIds` 为 `undefined`（不等于 `[]`）。

- [ ] **Step 3: 实现**

`lib.js` 的 `normalizeQuestion`：在 `const o = ...` 之后、`return {` 之前插入两行：

```js
    const rawKp = Array.isArray(o.kpIds) ? o.kpIds : (typeof o.kpId === 'string' && o.kpId ? [o.kpId] : []);
    const kpIds = [...new Set(rawKp.filter(x => typeof x === 'string' && x))];
```

并把第 102 行 `kpId: typeof o.kpId === 'string' && o.kpId ? o.kpId : null,` 替换为：

```js
      kpIds,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（109+1=110 条，原 109 条中少 1 条、新增 2 条 → 实际 110）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: 错题挂载知识点改为多对多（kpId → kpIds）并迁移老数据"
```

---

## Task 2: lib.js — `applyOrganizePlan` 把考点挂进 `kpIds`

现有实现写的是单值 `kpId`（`lib.js:450-453`），必须改成往 `kpIds` 里合并去重，否则旧入口（AI 整理的「写考点讲解」）会写出不存在的字段。

**Files:**
- Modify: `lib.js:415-418`（doc comment）、`lib.js:450-453`
- Modify: `test/lib.test.js:1006-1011`

- [ ] **Step 1: 改写失败测试**

把 `test/lib.test.js` 第 1006-1011 行的测试替换为：

```js
test('applyOrganizePlan 按 matchKp 把考点合并进 kpIds', () => {
  const items = [
    normalizeQuestion({ id: 'q1', stem: 'a' }),
    normalizeQuestion({ id: 'q2', stem: 'b', kpIds: ['k1'] }),
  ];
  const r = applyOrganizePlan(items, [
    { id: 'q1', kpTitle: '中值定理' },
    { id: 'q2', kpTitle: '中值定理' },
  ], { cols: [], matchKp: t => (t === '中值定理' ? 'k9' : null) });
  assert.deepEqual(r.items[0].kpIds, ['k9']);
  assert.deepEqual(r.items[1].kpIds, ['k1', 'k9']);
  assert.equal(r.changed, 2);
  // 同一个考点重复命中不产生重复项
  const r2 = applyOrganizePlan(items, [{ id: 'q2', kpTitle: '中值定理' }], { cols: [], matchKp: () => 'k1' });
  assert.deepEqual(r2.items[1].kpIds, ['k1']);
  assert.equal(r2.changed, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`r.items[0].kpIds` 为 `[]`（不等于 `['k9']`）。

- [ ] **Step 3: 实现**

`lib.js` 第 415-418 行的 doc comment 中，`matchKp` 那一行改为：

```js
       matchKp: (title) => kpId | null   用于把「考点名」挂到知识点库条目上（缺省不处理；命中则并入 kpIds）
```

第 450-453 行的 `kpTitle` 分支整体替换为：

```js
      if (typeof p.kpTitle === 'string' && p.kpTitle.trim() && typeof o.matchKp === 'function') {
        const kpId = o.matchKp(p.kpTitle.trim());
        if (kpId) {
          const ids = [...new Set([...(next.kpIds || []), kpId])];
          if (ids.length !== (next.kpIds || []).length) set('kpIds', ids);
        }
      }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: AI 整理的考点挂载改写入 kpIds"
```

---

## Task 3: lib.js — `planKpTaxonomy`（三层体系 → 两级合集 + 考点条目）

**Files:**
- Modify: `lib.js:458` 之后（紧跟 `applyOrganizePlan` 之后插入新函数）
- Modify: `lib.js:822-844`（导出）
- Modify: `test/lib.test.js:24` 后（解构引入）
- Test: `test/lib.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

`test/lib.test.js` 顶部解构里，把第 21 行 `parseAiJson, normTag, mergeSuggestTags, resolveCollectionPath, applyOrganizePlan,` 替换为：

```js
  parseAiJson, normTag, mergeSuggestTags, resolveCollectionPath, applyOrganizePlan,
  planKpTaxonomy, applyKpLinks, applyKpExplain, kpUsage,
```

在文件末尾追加：

```js
/* ===================== 知识点体系：计划与应用 ===================== */
const TAX = [
  { subject: '高等数学', chapter: '极限', topics: [{ title: '夹逼定理', kpId: null }, { title: '单调有界准则', kpId: null }] },
  { subject: '高等数学', chapter: '中值定理', topics: [{ title: '罗尔定理', kpId: 'k9' }] },
];

test('planKpTaxonomy 建两级合集 + 考点条目，并给出 key 映射', () => {
  const r = planKpTaxonomy(TAX, { cols: [], kps: [{ id: 'k9', title: '罗尔定理', content: '旧讲解', collectionId: 'z1' }], now: 1000 });
  // 学科/章节都建成了合集
  assert.deepEqual(r.cols.filter(c => c.parentId === null).map(c => c.name), ['高等数学']);
  const chaps = r.cols.filter(c => c.parentId && c.parentId !== null).map(c => c.name);
  assert.deepEqual(chaps.slice().sort(), ['中值定理', '极限'].sort());
  // 4 个考点：3 新建 + 1 复用
  assert.equal(r.entries.length, 4);
  assert.equal(r.kps.length, 4);
  const created = r.entries.filter(e => e.isNew);
  assert.equal(created.length, 3);
  assert.ok(created.every(e => /^tmp\d+$/.test(e.key)));
  const reused = r.entries.find(e => e.title === '罗尔定理');
  assert.equal(reused.key, 'k9');
  assert.equal(reused.isNew, false);
  // 复用项保留原有讲解，不被清空
  assert.equal(r.kps.find(k => k.id === 'k9').content, '旧讲解');
  // 新建条目 content 为空、带章节归属
  assert.equal(r.kps.filter(k => k.content === '').length, 3);
});

test('planKpTaxonomy 幂等：同名 + 同章节命中已有条目则复用，不重复新建', () => {
  const first = planKpTaxonomy(TAX, { cols: [], kps: [], now: 1000 });
  const again = planKpTaxonomy(TAX, { cols: first.cols, kps: first.kps, now: 2000 });
  assert.equal(again.kps.length, first.kps.length);          // 没有新增条目
  assert.equal(again.cols.length, first.cols.length);        // 没有新增合集
  assert.ok(again.entries.every(e => e.isNew === false));
});

test('planKpTaxonomy 丢弃 AI 编造的 kpId，并去掉合集名里的 /', () => {
  const r = planKpTaxonomy(
    [{ subject: '高数/极限', chapter: '夹逼', topics: [{ title: 'x', kpId: 'nope' }] }],
    { cols: [], kps: [], now: 1000 });
  assert.equal(r.entries[0].isNew, true);                    // 编造的 id 不生效，改为新建
  assert.deepEqual(r.cols.map(c => c.name), ['高数·极限', '夹逼']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`planKpTaxonomy is not a function`。

- [ ] **Step 3: 实现**

在 `lib.js` 的 `applyOrganizePlan` 函数结束（第 458 行的 `}`）之后插入：

```js
  /* 把 AI 提出的三层考点体系落成「两级合集 + 考点条目」计划（纯函数，不改动入参）。
     taxonomy: [{ subject, chapter, topics: [{ title, kpId }] }]
     opts: { cols, kps, now }
       cols —— 知识点库的合集数组；kps —— 知识点条目数组
     返回: { cols, kps, entries }
       entries: [{ key, kpId, title, collectionId, path, isNew }]
         key —— 后续挂载环节用的标识：复用项就是它的 kpId，新建项是 'tmp1'、'tmp2'…
         kpId —— 真实条目 id（新建项含本次生成的 id） */
  function planKpTaxonomy(taxonomy, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    // 合集名里的 / 会被当成路径分隔符，替换掉以免把考点名拆成层级
    const clean = s => String(s == null ? '' : s).replace(/\//g, '·').trim();
    let cols = Array.isArray(o.cols) ? o.cols.slice() : [];
    let kps = Array.isArray(o.kps) ? o.kps.slice() : [];
    const entries = [];
    const seenKeys = new Set();
    const hasId = new Set();
    const byName = new Map();   // 归一化考点名 + '\u0001' + 章节合集 id → kpId
    for (const k of kps) {
      if (!k || !k.id) continue;
      hasId.add(k.id);
      if (k.collectionId && k.title) byName.set(normText(k.title) + '\u0001' + k.collectionId, k.id);
    }
    const pathOf = id => collectionPath(cols, id).map(x => x.name).join('/');
    let tmp = 0;
    for (const ch of (Array.isArray(taxonomy) ? taxonomy : [])) {
      const subject = clean(ch && ch.subject), chapter = clean(ch && ch.chapter);
      if (!subject || !chapter) continue;
      const r = resolveCollectionPath(cols, subject + '/' + chapter, now);
      cols = r.cols;
      const colId = r.id;
      for (const t of (Array.isArray(ch.topics) ? ch.topics : [])) {
        const title = clean(t && t.title);
        if (!title) continue;
        const nk = normText(title) + '\u0001' + colId;
        // 1) AI 指定且真实存在的 kpId → 复用（并用条目自身的章节，不搬家）
        let kpId = (t && typeof t.kpId === 'string' && t.kpId) ? t.kpId : null;
        if (kpId && !hasId.has(kpId)) kpId = null;
        if (kpId && seenKeys.has(kpId)) continue;
        // 2) 否则按「归一化名 + 同章节」命中已有条目 → 复用
        if (!kpId && byName.has(nk)) kpId = byName.get(nk);
        if (kpId) {
          const cur = kps.find(k => k.id === kpId);
          seenKeys.add(kpId);
          byName.set(nk, kpId);
          entries.push({
            key: kpId, kpId, title: (cur && cur.title) || title,
            collectionId: (cur && cur.collectionId) || colId,
            path: pathOf((cur && cur.collectionId) || colId), isNew: false,
          });
          continue;
        }
        // 3) 新建
        const np = normalizeKp({ title, collectionId: colId });
        kps = kps.concat([np]);
        hasId.add(np.id);
        byName.set(nk, np.id);
        const key = 'tmp' + (++tmp);
        entries.push({ key, kpId: np.id, title, collectionId: colId, path: pathOf(colId), isNew: true });
      }
    }
    return { cols, kps, entries };
  }
```

并把 `lib.js:840` 的 `resolveCollectionPath, applyOrganizePlan,` 替换为：

```js
    resolveCollectionPath, applyOrganizePlan,
    planKpTaxonomy, applyKpLinks, applyKpExplain, kpUsage,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: planKpTaxonomy — 三层考点体系落成两级合集 + 考点条目"
```

---

## Task 4: lib.js — `applyKpLinks`（挂载计划 → 错题 `kpIds` / `knowledge`）

**Files:**
- Modify: `lib.js`（新增函数，放在 `planKpTaxonomy` 之后）
- Test: `test/lib.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 末尾追加：

```js
test('applyKpLinks 只补不覆盖：并入现有 kpIds，已有 knowledge 不覆盖', () => {
  const items = [
    normalizeQuestion({ id: 'q1', stem: 'a' }),
    normalizeQuestion({ id: 'q2', stem: 'b', kpIds: ['k1'], knowledge: '已写' }),
  ];
  const keyMap = new Map([['tmp1', 'kA'], ['k9', 'k9']]);
  const r = applyKpLinks(items, [
    { qid: 'q1', kpKeys: ['tmp1', 'k9', 'unknown'], knowledge: '新考点' },
    { qid: 'q2', kpKeys: ['k9'], knowledge: '覆盖我' },
  ], { keyMap, mode: 'append', now: 1000 });
  assert.deepEqual(r.items[0].kpIds, ['kA', 'k9']);          // unknown 被丢弃
  assert.equal(r.items[0].knowledge, '新考点');
  assert.deepEqual(r.items[1].kpIds, ['k1', 'k9']);          // 并入而非替换
  assert.equal(r.items[1].knowledge, '已写');                 // append 模式不覆盖
  assert.equal(r.changed, 2);
});

test('applyKpLinks 覆盖模式：kpIds 全量替换，kpKeys 为空则清空', () => {
  const items = [normalizeQuestion({ id: 'q1', stem: 'a', kpIds: ['k1', 'k2'], knowledge: '旧' })];
  const keyMap = new Map([['tmp1', 'kA']]);
  const r = applyKpLinks(items, [{ qid: 'q1', kpKeys: ['tmp1'], knowledge: '新' }], { keyMap, mode: 'overwrite' });
  assert.deepEqual(r.items[0].kpIds, ['kA']);
  assert.equal(r.items[0].knowledge, '新');
  const r2 = applyKpLinks(items, [{ qid: 'q1', kpKeys: [] }], { keyMap, mode: 'overwrite' });
  assert.deepEqual(r2.items[0].kpIds, []);
});

test('applyKpLinks 跳过 skip 与未知 qid，不改动原数组', () => {
  const items = [normalizeQuestion({ id: 'q1', stem: 'a' })];
  const snap = JSON.stringify(items);
  const r = applyKpLinks(items, [{ qid: 'q1', kpKeys: ['k9'], skip: true }, { qid: 'zz', kpKeys: ['k9'] }], { keyMap: new Map([['k9', 'k9']]) });
  assert.equal(r.changed, 0);
  assert.deepEqual(r.items[0].kpIds, []);
  assert.equal(JSON.stringify(items), snap);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`applyKpLinks is not a function`。

- [ ] **Step 3: 实现**

紧跟 `planKpTaxonomy` 之后插入：

```js
  /* 把审阅后的挂载计划应用到错题数组（纯函数，不改动入参）。
     plan: [{ qid, kpKeys: [...], knowledge?, skip? }]
     opts: { keyMap, mode, now }
       keyMap —— key → 真实 kpId（通常由 planKpTaxonomy 的 entries 得到）；未知 key 丢弃
       mode   —— 'append'（默认，只补不覆盖）| 'overwrite'（覆盖）
     返回: { items, changed } */
  function applyKpLinks(items, plan, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const map = o.keyMap instanceof Map ? o.keyMap : new Map(Object.entries(o.keyMap || {}));
    const overwrite = o.mode === 'overwrite';
    const decided = new Map();
    for (const p of (Array.isArray(plan) ? plan : [])) {
      if (p && typeof p.qid === 'string' && !p.skip) decided.set(p.qid, p);
    }
    let changed = 0;
    const out = (Array.isArray(items) ? items : []).map(it => {
      const p = it && decided.get(it.id);
      if (!p) return it;
      let next = it, dirty = false;
      const set = (k, v) => { if (next[k] !== v) { next = Object.assign({}, next, { [k]: v }); dirty = true; } };
      const ids = [];
      for (const key of (Array.isArray(p.kpKeys) ? p.kpKeys : [])) {
        const id = map.get(key);
        if (id && !ids.includes(id)) ids.push(id);
      }
      const merged = overwrite ? ids : [...new Set([...(next.kpIds || []), ...ids])];
      if (merged.join('\u0001') !== (next.kpIds || []).join('\u0001')) set('kpIds', merged);
      if (typeof p.knowledge === 'string' && p.knowledge.trim() && (overwrite || !next.knowledge)) {
        set('knowledge', p.knowledge.trim());
      }
      if (dirty) { next = Object.assign({}, next, { updatedAt: now }); changed++; }
      return next;
    });
    return { items: out, changed };
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: applyKpLinks — 把挂载计划写进错题 kpIds / knowledge"
```

---

## Task 5: lib.js — `applyKpExplain`（讲解写入考点条目）

**Files:**
- Modify: `lib.js`（新增函数，放在 `applyKpLinks` 之后）
- Test: `test/lib.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 末尾追加：

```js
test('applyKpExplain 只给 content 为空的考点写讲解', () => {
  const kps = [
    { id: 'k1', title: 'A', content: '', tags: [] },
    { id: 'k2', title: 'B', content: '已有讲解', tags: [] },
  ];
  const r = applyKpExplain(kps, [{ kpKey: 'k1', content: '新讲解' }, { kpKey: 'k2', content: '想覆盖' }],
    { keyMap: new Map([['k1', 'k1'], ['k2', 'k2']]), now: 1000 });
  assert.equal(r.kps[0].content, '新讲解');
  assert.equal(r.kps[1].content, '已有讲解');   // 非覆盖模式保留
  assert.equal(r.changed, 1);
  assert.equal(kps[0].content, '');            // 不改动入参
});

test('applyKpExplain 覆盖模式可改写已有讲解，空内容与未知 key 忽略', () => {
  const kps = [{ id: 'k2', title: 'B', content: '旧', tags: [] }];
  const r = applyKpExplain(kps, [{ kpKey: 'k2', content: '新' }, { kpKey: 'zz', content: 'x' }, { kpKey: 'k2', content: '   ' }],
    { keyMap: new Map([['k2', 'k2']]), mode: 'overwrite' });
  assert.equal(r.kps[0].content, '新');
  assert.equal(r.changed, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`applyKpExplain is not a function`。

- [ ] **Step 3: 实现**

紧跟 `applyKpLinks` 之后插入：

```js
  /* 把 AI 写好的考点讲解写入知识点条目（纯函数，不改动入参）。
     explains: [{ kpKey, content }]
     opts: { keyMap, mode, now }   同 applyKpLinks
     返回: { kps, changed } */
  function applyKpExplain(kps, explains, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const map = o.keyMap instanceof Map ? o.keyMap : new Map(Object.entries(o.keyMap || {}));
    const overwrite = o.mode === 'overwrite';
    const byId = new Map();
    for (const e of (Array.isArray(explains) ? explains : [])) {
      const id = e && map.get(e.kpKey);
      const text = e && typeof e.content === 'string' ? e.content.trim() : '';
      if (id && text) byId.set(id, text);
    }
    let changed = 0;
    const out = (Array.isArray(kps) ? kps : []).map(k => {
      const text = k && byId.get(k.id);
      if (!text) return k;
      if (!overwrite && k.content) return k;
      if (k.content === text) return k;
      changed++;
      return Object.assign({}, k, { content: text, updatedAt: now });
    });
    return { kps: out, changed };
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: applyKpExplain — 给被挂到的考点写入讲解"
```

---

## Task 6: lib.js — `kpUsage`（考点使用统计）

**Files:**
- Modify: `lib.js`（新增函数，放在 `applyKpExplain` 之后）
- Test: `test/lib.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

在 `test/lib.test.js` 末尾追加：

```js
test('kpUsage 统计每个考点被多少错题挂到', () => {
  const u = kpUsage([
    { kpIds: ['k1', 'k2'] },
    { kpIds: ['k1'] },
    { kpIds: [] },
    { },
  ]);
  assert.equal(u.get('k1'), 2);
  assert.equal(u.get('k2'), 1);
  assert.equal(u.get('k9'), undefined);
  assert.equal(u.size, 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL，`kpUsage is not a function`。

- [ ] **Step 3: 实现**

紧跟 `applyKpExplain` 之后插入：

```js
  /* 统计每个考点被多少错题挂到：返回 Map<kpId, 次数> */
  function kpUsage(items) {
    const m = new Map();
    for (const it of (Array.isArray(items) ? items : [])) {
      for (const id of ((it && it.kpIds) || [])) {
        if (typeof id === 'string' && id) m.set(id, (m.get(id) || 0) + 1);
      }
    }
    return m;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: kpUsage — 知识点被错题引用的次数统计"
```

---

## Task 7: app.js — 「相关 N」改按 `kpIds`、撤销快照改 `kpIds`、删除知识点清理引用

**Files:**
- Modify: `app.js:18-29`（解构引入 `kpUsage`）
- Modify: `app.js:711-716`（`relatedCount`）
- Modify: `app.js:3504-3506`、`app.js:3526-3529`（AI 整理的撤销快照）
- Modify: `app.js:787-796`（删除卡片）

- [ ] **Step 1: 引入 kpUsage**

`app.js` 顶部解构里，把第 27 行 `  clusterBySimilarity, groupStats,` 替换为：

```js
  clusterBySimilarity, groupStats, kpUsage,
```

- [ ] **Step 2: 改写 `relatedCount`**

把 `app.js:711-716` 整段替换为：

```js
// 与「另一库」的关联数：只按 kpIds 算（错题↔知识点多对多），不再用标签交集
function relatedCount(it) {
  if (active === 'k') return kpUsage(stores.q.items).get(it.id) || 0;
  return (it.kpIds || []).length;
}
```

- [ ] **Step 3: 撤销快照改 kpIds**

`app.js:3504-3506` 替换为：

```js
  st.undo = stores.q.items.map(it => ({
    id: it.id, tags: it.tags.slice(), collectionId: it.collectionId,
    knowledge: it.knowledge, kpIds: (it.kpIds || []).slice(),
  }));
```

`app.js:3526-3529` 替换为：

```js
  stores.q.items = stores.q.items.map(it => {
    const u = byId.get(it.id);
    return u ? Object.assign({}, it, {
      tags: u.tags.slice(), collectionId: u.collectionId,
      knowledge: u.knowledge, kpIds: u.kpIds.slice(),
    }) : it;
  });
```

- [ ] **Step 4: 删除知识点时清理错题引用**

把 `app.js:787-796` 的删除处理整体替换为：

```js
  card.querySelector('[data-act="delete"]').onclick = () => {
    if (confirm('移入回收站？30 天内可在「设置 → 回收站」恢复。')) {
      toTrash(active, it);
      stores[active].items = curItems().filter(x => x.id !== it.id);
      // 删掉的是知识点 → 同时从各错题的 kpIds 摘掉它，避免悬空引用
      if (active === 'k') {
        stores.q.items = stores.q.items.map(q =>
          (q.kpIds || []).includes(it.id)
            ? Object.assign({}, q, { kpIds: q.kpIds.filter(x => x !== it.id), updatedAt: Date.now() })
            : q);
        saveStore(stores.q.key, stores.q.items);
      }
      v.selected.delete(it.id);
      saveActive();
      refreshTagPicker();
      render();
    }
  };
```

- [ ] **Step 5: 语法与回归检查**

Run: `node --check app.js && node --test test/`
Expected: 无输出（语法 OK）；测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add app.js
git commit -m "feat: 相关数改按 kpIds 现算；删除知识点时清理错题引用"
```

---

## Task 8: app.js — 三条提示词 + 免 Key 拼装

**Files:**
- Modify: `app.js`（在 `aiOrgPromptText`（3040 行）之后插入）

- [ ] **Step 1: 实现**

在 `app.js` 的 `aiOrgPromptText` 函数结束后插入：

```js
/* ---------- AI 整理知识点：Step1 体系 / Step2 挂载 / Step3 讲解 ---------- */
function aiKpExistingText() {
  return JSON.stringify(stores.k.items.map(k => ({
    title: k.title || '',
    path: k.collectionId ? collectionPath(colStores.k, k.collectionId).map(x => x.name).join('/') : '',
    kpId: k.id,
  })));
}

function aiKpUserText(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map(it => ({
    id: it.id,
    stem: String(it.stem || '').replace(/\s+/g, ' ').slice(0, 300),
    tags: it.tags || [],
  })));
}

// Step1：让 AI 提出三层考点体系（学科 / 章节 / 考点）
function aiKpTaxonomyPrompt() {
  return [
    '你是考研数学 / 高中数学的课程分类专家。下面会给你两段 JSON：一批错题原文与标签，以及知识点库里已有的考点清单。',
    '请据此提出一套**三层考点体系**：学科 → 章节 → 考点。',
    '严格只输出一个 JSON 数组，不要输出任何解释、标题或 ``` 围栏。每个元素形如：',
    '{ "subject": "高等数学", "chapter": "极限", "topics": [ { "title": "夹逼定理", "kpId": "k12" }, { "title": "单调有界准则", "kpId": null } ] }',
    '要求：',
    '1. subject 控制在 2~6 个（如 高等数学 / 线性代数 / 概率论与数理统计）；',
    '2. 每个 subject 下 2~8 个 chapter；每个 chapter 下 1~6 个 topics；',
    '3. 考点名要短（不超过 12 字）、要能复用，同一考点不要换个说法重复出现；',
    '4. 【已有清单】里出现过的考点，必须原样照抄它的 kpId 复用，禁止编造 kpId；新考点 kpId 一律用 null；',
    '5. 同一个考点不要同时放进两个 chapter；学科名与章节名里不要出现 / 字符。',
  ].join('\n');
}

// Step2：把错题挂到考点上（多选），必要时补一句「考点 + 易错点」
function aiKpLinkPrompt(entries) {
  return [
    '你是数学错题整理助手。下面给你一份**已确定的考点清单**（每个考点有唯一 key）和一批错题。',
    '请为每道错题挑出它涉及的全部考点（可多个，也可以一个都不涉及），并在需要时补一句「考点 + 易错点」。',
    '严格只输出一个 JSON 数组，不要输出任何解释或 ``` 围栏。每个元素形如：',
    '{ "qid": "错题 id（原样照抄）", "kpKeys": ["k12", "tmp3"], "knowledge": "夹逼定理：……" }',
    '要求：',
    '1. kpKeys 只能取自下面清单里的 key，禁止编造；一道题最多 3 个考点；',
    '2. 不确定就给空数组，不要瞎猜；',
    '3. knowledge 是可选的一句话（考点 + 易错点），公式用 $...$；不确定就给空字符串；',
    '4. 输出元素个数、id 与输入错题一一对应。',
    '考点清单：',
    JSON.stringify((Array.isArray(entries) ? entries : []).map(e => ({ key: e.key, path: e.path, title: e.title }))),
  ].join('\n');
}

// Step3：只为被挂到的考点写讲解
function aiKpExplainPrompt(entries) {
  return [
    '你是数学助教。下面给你一批数学考点，请为每个考点写一段讲解。',
    '严格只输出一个 JSON 数组，不要输出任何解释或 ``` 围栏。每个元素形如：',
    '{ "kpKey": "k12", "content": "……" }',
    '要求：',
    '1. 讲解写清「定义 + 为什么成立 + 怎么用 + 易错点」，公式一律用 LaTeX 且必须带 $...$ 或 $$...$$；',
    '2. 不要用 Markdown 语法（不要 **加粗**、# 标题、- 列表）；需要分步就用「第 1 步：」这类前缀；',
    '3. kpKey 必须原样照抄，不要编造。',
    '考点清单：',
    JSON.stringify((Array.isArray(entries) ? entries : []).map(e => ({ kpKey: e.key, title: e.title }))),
  ].join('\n');
}

// 免 Key：拼成一段可直接丢给任意对话式 AI 的文本
function aiKpCopyText(step, items, entries) {
  if (step === 'taxonomy') {
    return [
      aiKpTaxonomyPrompt(), '',
      '下面是错题（JSON）：', aiKpUserText(items), '',
      '下面是知识点库里已有的考点清单：', aiKpExistingText(), '',
      '请只输出那个 JSON 数组。',
    ].join('\n');
  }
  if (step === 'link') {
    return [aiKpLinkPrompt(entries), '', '下面是错题（JSON）：', aiKpUserText(items), '', '请只输出那个 JSON 数组。'].join('\n');
  }
  return [aiKpExplainPrompt(entries), '', '请只输出那个 JSON 数组。'].join('\n');
}

// Step2 / Step3 的合并请求：一批错题 → { rows, explains }
async function aiKpPlanRun(items, entries, mode) {
  const rows = [], explains = [], errors = [];
  const text = await aiCall({ system: aiKpLinkPrompt(entries), ask: aiKpUserText(items) });
  const o = parseAiJson(text);
  if (!Array.isArray(o)) throw new Error('AI 没有返回 JSON 数组。');
  for (const r of o) {
    if (!r || typeof r.qid !== 'string') continue;
    const kpKeys = Array.isArray(r.kpKeys) ? r.kpKeys.filter(k => typeof k === 'string' && k) : [];
    rows.push({ qid: r.qid, kpKeys, knowledge: typeof r.knowledge === 'string' ? r.knowledge : '', skip: false });
  }
  // 只为「本次挂到且讲解为空」的考点写讲解
  const usedKeys = new Set();
  for (const r of rows) for (const k of r.kpKeys) usedKeys.add(k);
  const need = entries.filter(e => usedKeys.has(e.key) && !(e.content || '').trim());
  if (need.length) {
    try {
      const t2 = await aiCall({ system: aiKpExplainPrompt(need), ask: '请写讲解。' });
      const o2 = parseAiJson(t2);
      if (Array.isArray(o2)) {
        for (const e of o2) {
          const key = e && typeof e.kpKey === 'string' ? e.kpKey : null;
          const content = e && typeof e.content === 'string' ? e.content.trim() : '';
          if (key && content) explains.push({ kpKey: key, content });
        }
      }
    } catch (err) {
      errors.push('讲解生成失败（可稍后单独重试）：' + ((err && err.message) || err));
    }
  }
  return { rows, explains, errors };
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check app.js`
Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: AI 整理知识点的三条提示词与免 Key 拼装"
```

---

## Task 9: index.html — 入口按钮与弹层结构

**Files:**
- Modify: `index.html:48`（工具栏按钮）
- Modify: `index.html`（在 `#aiOrgModal` 结束后插入新弹层）

- [ ] **Step 1: 加工具栏按钮**

在 `index.html` 第 48 行 `<button id="aiToolsBtn" ...>` 之后插入：

```html
  <button id="aiKpBtn" title="让 AI 从错题整理出知识点（考点体系 + 挂载）">🧠 整理知识点</button>
```

- [ ] **Step 2: 加弹层**

在 `index.html` 的 `<div class="modal" id="aiOrgModal">` 整块结束（`</div>` 闭合 modal）之后插入：

```html
<div class="modal" id="aiKpModal">
  <div class="panel wide">
    <h2>AI 整理知识点</h2>
    <p class="hint">AI 只负责<b>提议</b>，结果会列出来让你核对，确认后才写入。使用时会联网，错题原文会发送到你配置的服务商。</p>

    <!-- 1 设置 -->
    <div id="aiKpSetup">
      <div class="ai-org-fields">
        <label class="ai-label" for="aiKpScope">整理范围</label>
        <select id="aiKpScope">
          <option value="all">全部错题</option>
          <option value="filtered">当前筛选结果</option>
          <option value="unlinked">仅未挂知识点</option>
        </select>
        <label class="ai-label" for="aiKpMode">已有挂载</label>
        <select id="aiKpMode">
          <option value="append">只补不覆盖</option>
          <option value="overwrite">覆盖</option>
        </select>
        <p class="setnote" id="aiKpNote"></p>
      </div>
      <div class="row">
        <button class="primary" id="aiKpRun">① 让 AI 提考点体系</button>
        <button class="ghost" id="aiKpCopy">复制提示词（免 Key）</button>
        <span class="spacer"></span>
        <button class="ghost" id="aiKpCancel">取消</button>
        <span class="badge-note" id="aiKpMsg"></span>
      </div>
    </div>

    <!-- 1b 粘贴 JSON -->
    <div id="aiKpPasteWrap" style="display:none">
      <p class="hint" id="aiKpPasteHint"></p>
      <textarea id="aiKpPaste" placeholder="粘贴 AI 输出的 JSON 数组"></textarea>
      <div class="row">
        <button class="primary" id="aiKpPasteGo">解析并继续</button>
        <button class="ghost" id="aiKpPasteBack">返回</button>
      </div>
    </div>

    <!-- 2 体系审阅 -->
    <div id="aiKpTaxWrap" style="display:none">
      <p class="hint">核对要建立的考点体系（可改名、删行、取消勾选）。已存在的会标「复用」，不会重复新建。</p>
      <div class="ai-org-table" id="aiKpTax"></div>
      <div class="row">
        <button class="primary" id="aiKpTaxApply">应用体系，继续挂载</button>
        <span class="spacer"></span>
        <button class="ghost" id="aiKpTaxBack">返回</button>
        <span class="badge-note" id="aiKpTaxMsg"></span>
      </div>
    </div>

    <!-- 3 挂载审阅 -->
    <div id="aiKpLinkWrap" style="display:none">
      <p class="hint" id="aiKpLinkMsg"></p>
      <div class="ai-org-table" id="aiKpLink"></div>
      <p class="hint">待补讲解的考点（这些考点本次被错题挂到，讲解会一并写入）：</p>
      <div class="ai-org-table" id="aiKpExplain"></div>
      <div class="row">
        <button class="primary" id="aiKpApply">应用并保存</button>
        <button class="ghost" id="aiKpAll">全选</button>
        <button class="ghost" id="aiKpNone">全不选</button>
        <span class="spacer"></span>
        <button class="ghost" id="aiKpUndo" style="display:none">撤销上次应用</button>
        <button class="ghost" id="aiKpClose">关闭</button>
        <span class="badge-note" id="aiKpLinkMsg2"></span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: 校验结构**

Run: `grep -c 'id="aiKp' index.html`
Expected: `15`（按钮 1 + 弹层内 14）。

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "feat: 新增「AI 整理知识点」入口与四屏弹层结构"
```

---

## Task 10: styles.css — 体系审阅行样式

**Files:**
- Modify: `styles.css`（在 `/* ---------- AI 整理 ---------- */` 区块末尾追加）

- [ ] **Step 1: 实现**

在 `styles.css` 的 AI 整理样式区块末尾（`ai-org-table` 相关规则之后）追加：

```css
/* AI 整理知识点：体系审阅行 */
.kp-tax-lv1,.kp-tax-lv2,.kp-tax-lv3{display:flex; align-items:center; gap:8px; padding:4px 2px;}
.kp-tax-lv2{padding-left:22px;}
.kp-tax-lv3{padding-left:44px;}
.kp-tax-lv1 .kp-tax-name{font-weight:700;}
.kp-tax-name{flex:1 1 auto; min-width:0;}
.kp-tax-badge{font-size:11px; padding:1px 7px; border-radius:999px; border:1px solid var(--line); color:var(--muted); flex:0 0 auto;}
.kp-tax-badge.new{color:var(--brand); border-color:var(--brand);}
.kp-tax-del{border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:13px; padding:0 4px; flex:0 0 auto;}
.kp-tax-del:hover{color:var(--danger, var(--brand));}
.kp-exp-ta{width:100%; min-height:56px;}
```

- [ ] **Step 2: 校验类名被引用**

Run: `grep -c 'kp-tax-lv1\|kp-tax-lv2\|kp-tax-lv3' styles.css`
Expected: `3`。

- [ ] **Step 3: 提交**

```bash
git add styles.css
git commit -m "style: AI 整理知识点弹层的体系审阅行样式"
```

---

## Task 11: app.js — 弹层四屏状态机（设置 → 体系 → 挂载 → 应用/撤销）

**Files:**
- Modify: `app.js`（在 `undoAiOrg` / `orgEl('aiOrgUndo')` 相关代码之后插入）

- [ ] **Step 1: 实现**

在 `app.js` 中 `orgEl('aiOrgUndo').onclick = () => undoAiOrg();`（约 3537 行）之后插入：

```js
/* ===================== AI 整理知识点（考点体系 + 挂载） ===================== */
const kpEl = id => document.getElementById(id);
const kpModal = kpEl('aiKpModal');
let kpState = null;   // { items, mode, taxonomy, entries, keyMap, rows, explains, undo }

function kpScopeItems() {
  const scope = kpEl('aiKpScope').value;
  if (scope === 'filtered') return currentFiltered();
  if (scope === 'unlinked') return stores.q.items.filter(it => !(it.kpIds || []).length);
  return stores.q.items.slice();
}
const kpMode = () => kpEl('aiKpMode').value === 'overwrite' ? 'overwrite' : 'append';

function kpShowStep(name) {
  ['aiKpSetup', 'aiKpPasteWrap', 'aiKpTaxWrap', 'aiKpLinkWrap'].forEach(id => {
    kpEl(id).style.display = (id === name) ? '' : 'none';
  });
}

function openAiKp() {
  if (active !== 'q') { alert('AI 整理知识点需要从错题视图发起（结果写入知识点库）。'); return; }
  if (!stores.q.items.length) { alert('错题库还是空的，先添加几道错题吧。'); return; }
  kpState = { items: [], mode: kpMode(), taxonomy: [], entries: [], keyMap: new Map(), rows: [], explains: [], undo: null };
  kpShowStep('aiKpSetup');
  kpEl('aiKpMsg').textContent = '';
  kpEl('aiKpNote').textContent = stores.k.items.length
    ? `知识点库已有 ${stores.k.items.length} 个条目，AI 会优先复用同名考点。`
    : '知识点库还是空的，AI 会新建整套考点。';
  kpModal.classList.add('open');
}
kpEl('aiKpBtn').onclick = () => openAiKp();
kpEl('aiKpCancel').onclick = () => kpModal.classList.remove('open');
kpEl('aiKpClose').onclick = () => kpModal.classList.remove('open');
kpModal.onclick = e => { if (e.target === kpModal) kpModal.classList.remove('open'); };

/* ---------- 把 AI / 粘贴得到的体系 JSON 整理成待审阅的行 ---------- */
function kpNormTaxonomy(raw) {
  const out = [];
  for (const ch of (Array.isArray(raw) ? raw : [])) {
    if (!ch || typeof ch !== 'object') continue;
    const subject = String(ch.subject == null ? '' : ch.subject).trim();
    const chapter = String(ch.chapter == null ? '' : ch.chapter).trim();
    if (!subject || !chapter) continue;
    const topics = (Array.isArray(ch.topics) ? ch.topics : [])
      .map(t => ({ title: String((t && t.title) || '').trim(), kpId: (t && typeof t.kpId === 'string' && t.kpId) || null }))
      .filter(t => t.title);
    if (topics.length) out.push({ subject, chapter, topics });
  }
  return out;
}

/* ---------- 步骤 2 渲染：三层体系审阅 ---------- */
function renderKpTax() {
  const rows = [], RADIO = `data-kp-tax`;
  kpState.taxonomy.forEach((ch, ci) => {
    ch.topics.forEach((t, ti) => {
      rows.push({ ci, ti, level: 3, text: t.title, kpId: t.kpId, checked: true });
    });
  });
  // 用「合集/条目」两级结构渲染：先按 subject/chapter 分组，再列考点
  const subs = [];
  kpState.taxonomy.forEach((ch, ci) => {
    if (!subs.includes(ch.subject)) subs.push(ch.subject);
  });
  let html = '';
  for (const sub of subs) {
    const ids = kpState.taxonomy.map((ch, ci) => ch.subject === sub ? ci : -1).filter(i => i >= 0);
    html += `<div class="kp-tax-lv1" data-kp-sub="${esc(sub)}"><input type="checkbox" data-kp-keep="sub:${esc(sub)}" checked><span class="kp-tax-name">${esc(sub)}</span><span class="kp-tax-badge">学科</span></div>`;
    for (const ci of ids) {
      const ch = kpState.taxonomy[ci];
      html += `<div class="kp-tax-lv2" data-kp-ch="${ci}"><input type="checkbox" data-kp-keep="ch:${ci}" checked><input class="kp-tax-name" data-kp-name="ch:${ci}" value="${esc(ch.chapter)}"><span class="kp-tax-badge">章节</span><button class="kp-tax-del" data-kp-del="ch:${ci}" title="不建这个章节">✕</button></div>`;
      ch.topics.forEach((t, ti) => {
        const exists = t.kpId && stores.k.items.some(k => k.id === t.kpId);
        html += `<div class="kp-tax-lv3" data-kp-tp="${ci}:${ti}"><input type="checkbox" data-kp-keep="tp:${ci}:${ti}" checked><input class="kp-tax-name" data-kp-name="tp:${ci}:${ti}" value="${esc(t.title)}"><span class="kp-tax-badge${exists ? '' : ' new'}">${exists ? '复用' : '新建'}</span><button class="kp-tax-del" data-kp-del="tp:${ci}:${ti}" title="不建这个考点">✕</button></div>`;
      });
    }
  }
  kpEl('aiKpTax').innerHTML = html || '<div class="col-empty">AI 没有给出可用的考点体系，请返回重试或改用手动输入。</div>';
  kpState.keep = {};
  kpEl('aiKpTax').querySelectorAll('[data-kp-keep]').forEach(cb => {
    kpState.keep[cb.dataset.kpKeep] = cb.checked;
    cb.onchange = () => { kpState.keep[cb.dataset.kpKeep] = cb.checked; };
  });
  kpEl('aiKpTax').querySelectorAll('[data-kp-name]').forEach(inp => {
    inp.onchange = () => {
      const [kind, a, b] = inp.dataset.kpName.split(':');
      const v = inp.value.trim();
      if (!v) { inp.value = kind === 'ch' ? kpState.taxonomy[a].chapter : kpState.taxonomy[a].topics[b].title; return; }
      if (kind === 'ch') kpState.taxonomy[a].chapter = v;
      else kpState.taxonomy[a].topics[b].title = v;
    };
  });
  kpEl('aiKpTax').querySelectorAll('[data-kp-del]').forEach(btn => {
    btn.onclick = () => {
      const [kind, a, b] = btn.dataset.kpDel.split(':');
      if (kind === 'ch') kpState.taxonomy[a].topics = [];
      else kpState.taxonomy[a].topics[b].title = '';
      renderKpTax();
    };
  });
  kpEl('aiKpTaxMsg').textContent = `学科 ${new Set(kpState.taxonomy.map(t => t.subject)).size} 个 · 章节 ${kpState.taxonomy.length} 个 · 考点 ${kpState.taxonomy.reduce((n, t) => n + t.topics.length, 0)} 个`;
}

/* ---------- 收集审阅结果：勾选/改名/删除后真正要建的体系 ---------- */
function kpCollectTaxonomy() {
  const keep = kpState.keep || {};
  const out = [];
  kpState.taxonomy.forEach((ch, ci) => {
    if (!keep['ch:' + ci]) return;
    if (!keep['sub:' + ch.subject]) return;
    const topics = [];
    ch.topics.forEach((t, ti) => {
      if (!keep['tp:' + ci + ':' + ti]) return;
      if (!t.title.trim()) return;
      topics.push({ title: t.title.trim(), kpId: t.kpId });
    });
    if (topics.length) out.push({ subject: ch.subject, chapter: ch.chapter, topics });
  });
  return out;
}

/* ---------- 开始：调 AI 或粘贴 ---------- */
kpEl('aiKpRun').onclick = async () => {
  const items = kpScopeItems();
  if (!items.length) { kpEl('aiKpMsg').textContent = '这个范围里没有错题。'; return; }
  kpState.items = items;
  kpState.mode = kpMode();
  if (!aiReady()) {
    kpEl('aiKpMsg').textContent = '';
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里填好 Base URL、模型名与 API Key；或改用「复制提示词（免 Key）」。');
    return;
  }
  kpEl('aiKpRun').disabled = true;
  showAiBusy('AI 正在提考点体系，请稍候…');
  try {
    const text = await aiCall({
      system: aiKpTaxonomyPrompt(),
      ask: ['下面是错题（JSON）：', aiKpUserText(items), '', '下面是知识点库里已有的考点清单：', aiKpExistingText()].join('\n'),
    });
    const raw = parseAiJson(text);
    hideAiBusy();
    kpState.taxonomy = kpNormTaxonomy(raw);
    if (!kpState.taxonomy.length) { kpEl('aiKpMsg').textContent = 'AI 没有给出可用的考点体系，可重试或改用手动输入。'; return; }
    renderKpTax();
    kpShowStep('aiKpTaxWrap');
  } catch (e) {
    hideAiBusy();
    kpEl('aiKpMsg').textContent = (e && e.name === 'AbortError') ? '已取消。' : '整理失败：' + ((e && e.message) || e);
  } finally { kpEl('aiKpRun').disabled = false; }
};

/* ---------- 免 Key：复制提示词 ---------- */
kpEl('aiKpCopy').onclick = async () => {
  const items = kpScopeItems();
  if (!items.length) { kpEl('aiKpMsg').textContent = '这个范围里没有错题。'; return; }
  kpState.items = items;
  kpState.mode = kpMode();
  const text = aiKpCopyText('taxonomy', items, []);
  try { await navigator.clipboard.writeText(text); kpEl('aiKpMsg').textContent = '提示词已复制，去任意 AI 跑一遍再粘回来。'; }
  catch (e) { kpEl('aiKpPaste').value = text; kpEl('aiKpMsg').textContent = '复制失败，提示词已填在下面的框里，请手动复制。'; }
  kpEl('aiKpPasteHint').textContent = '把 AI 输出的 JSON 数组粘到下面（Step1 的体系 JSON）。';
  kpEl('aiKpPaste').value = '';
  kpShowStep('aiKpPasteWrap');
};

kpEl('aiKpPasteBack').onclick = () => kpShowStep('aiKpSetup');
kpEl('aiKpPasteGo').onclick = () => {
  const text = kpEl('aiKpPaste').value;
  let raw;
  try { raw = parseAiJson(text); } catch (e) { alert('解析失败：' + ((e && e.message) || e)); return; }
  if (kpState.pasteStep === 'explain') {
    // 讲解 JSON 直接进入挂载审阅的讲解区
    const list = (Array.isArray(raw) ? raw : []).map(e => ({
      kpKey: e && typeof e.kpKey === 'string' ? e.kpKey : null,
      content: e && typeof e.content === 'string' ? e.content.trim() : '',
    })).filter(e => e.kpKey && e.content);
    kpState.explains = list;
    kpShowStep('aiKpLinkWrap');
    renderKpLink();
    kpEl('aiKpLinkMsg2').textContent = `已解析 ${list.length} 条讲解。`;
    return;
  }
  kpState.taxonomy = kpNormTaxonomy(raw);
  if (!kpState.taxonomy.length) { alert('没解析出可用的考点体系。'); return; }
  renderKpTax();
  kpShowStep('aiKpTaxWrap');
};

/* ---------- 体系审阅：应用体系（建合集 + 条目），进入挂载 ---------- */
kpEl('aiKpTaxBtnDummy') && null;
kpEl('aiKpTaxBack').onclick = () => kpShowStep('aiKpSetup');
kpEl('aiKpTaxApply').onclick = async () => {
  const taxonomy = kpCollectTaxonomy();
  if (!taxonomy.length) { alert('没有勾选任何要建的考点。'); return; }
  const r = planKpTaxonomy(taxonomy, { cols: colStores.k, kps: stores.k.items });
  kpState.taxonomy = taxonomy;
  kpState.entries = r.entries;
  kpState.keyMap = new Map(r.entries.map(e => [e.key, e.kpId]));
  kpState.undo = { q: stores.q.items.slice(), k: stores.k.items.slice(), cols: colStores.k.slice() };
  colStores.k = r.cols;
  stores.k.items = r.kps;
  await saveCols('k');
  await saveStore(stores.k.key, stores.k.items);
  render();
  // 进入挂载：有 Key 调 AI，没 Key 走复制
  if (!aiReady()) {
    kpEl('aiKpLinkMsg').textContent = `已建 ${r.entries.filter(e => e.isNew).length} 个新考点、复用 ${r.entries.filter(e => !e.isNew).length} 个。未配置 AI：请复制提示词，再把 AI 输出的 JSON 粘回来。`;
    renderKpLink();
    kpShowStep('aiKpLinkWrap');
    return;
  }
  kpEl('aiKpTaxApply').disabled = true;
  showAiBusy('AI 正在把错题挂到考点上，请稍候…');
  try {
    const res = await aiKpPlanRun(kpState.items, r.entries, kpState.mode);
    hideAiBusy();
    kpState.rows = res.rows;
    kpState.explains = res.explains;
    renderKpLink();
    kpEl('aiKpLinkMsg2').textContent = res.errors.join('；');
    kpEl('aiKpLinkMsg').textContent = `考点 ${r.entries.length} 个（新建 ${r.entries.filter(e => e.isNew).length}）· 错题 ${kpState.items.length} 道。`;
    kpShowStep('aiKpLinkWrap');
  } catch (e) {
    hideAiBusy();
    kpEl('aiKpTaxMsg').textContent = (e && e.name === 'AbortError') ? '已取消。' : '挂载失败：' + ((e && e.message) || e);
    kpEl('aiKpLinkMsg').textContent = '体系已建好，可在挂载环节重试或手动填。';
    renderKpLink();
    kpShowStep('aiKpLinkWrap');
  } finally { kpEl('aiKpTaxApply').disabled = false; }
};

/* ---------- 步骤 3 渲染：逐题挂载 + 待补讲解 ---------- */
function renderKpLink() {
  const entries = kpState.entries || [];
  const byQid = new Map(kpState.items.map(it => [it.id, it]));
  const rows = kpState.rows || [];
  kpState.rows = rows;
  kpEl('aiKpLink').innerHTML = rows.length ? rows.map((row, i) => {
    const it = byQid.get(row.qid) || {};
    const chips = row.kpKeys.map(k => {
      const e = entries.find(x => x.key === k);
      return `<span class="aio-chip" data-kp-chip-i="${i}" data-kp-chip-k="${esc(k)}">${esc(e ? e.title : k)}<b>×</b></span>`;
    }).join('');
    return `<div class="aio-row">
      <label class="aio-skip"><input type="checkbox" data-kp-skip="${i}"${row.skip ? ' checked' : ''}></label>
      <div class="aio-stem">${renderMath(String(it.stem || '').slice(0, 160))}</div>
      <div class="aio-fields">
        <div class="aio-tags">${chips}
          <select data-kp-add="${i}"><option value="">＋考点</option>${
            entries.map(e => `<option value="${esc(e.key)}">${esc(e.path + ' / ' + e.title)}</option>`).join('')
          }</select>
        </div>
        <textarea class="aio-know" data-kp-know="${i}" placeholder="考点 + 易错点（可留空）">${esc(row.knowledge || '')}</textarea>
        <p class="setnote">现有挂载：${(it.kpIds || []).length} 个</p>
      </div>
    </div>`;
  }).join('') : '<div class="col-empty">AI 没有给出挂载建议，可返回重试；或直接点「应用并保存」只建体系。</div>';

  kpEl('aiKpLink').querySelectorAll('[data-kp-skip]').forEach(cb => {
    cb.onchange = () => { rows[+cb.dataset.kpSkip].skip = cb.checked; };
  });
  kpEl('aiKpLink').querySelectorAll('[data-kp-chip-i]').forEach(el => {
    el.onclick = () => {
      const row = rows[+el.dataset.kpChipI];
      row.kpKeys = row.kpKeys.filter(k => k !== el.dataset.kpChipK);
      renderKpLink();
    };
  });
  kpEl('aiKpLink').querySelectorAll('[data-kp-add]').forEach(sel => {
    sel.onchange = () => {
      const row = rows[+sel.dataset.kpAdd];
      const k = sel.value;
      if (!k) return;
      if (!row.kpKeys.includes(k)) row.kpKeys.push(k);
      renderKpLink();
    };
  });
  kpEl('aiKpLink').querySelectorAll('[data-kp-know]').forEach(ta => {
    ta.onchange = () => { rows[+ta.dataset.kpKnow].knowledge = ta.value; };
  });

  // 待补讲解：只列本次被挂到、且还没有讲解的考点
  const usedKeys = new Set();
  for (const row of rows) if (!row.skip) for (const k of row.kpKeys) usedKeys.add(k);
  const need = entries.filter(e => usedKeys.has(e.key));
  const ex = kpState.explains || [];
  kpEl('aiKpExplain').innerHTML = need.length ? need.map((e, i) => {
    const cur = ex.find(x => x.kpKey === e.key);
    return `<div class="aio-row">
      <div class="aio-stem">${esc(e.path + ' / ' + e.title)}<span class="kp-tax-badge${e.isNew ? ' new' : ''}">${e.isNew ? '新建' : '复用'}</span></div>
      <div class="aio-fields">
        <textarea class="aio-know kp-exp-ta" data-kp-exp="${esc(e.key)}" placeholder="讲解（定义 + 为什么成立 + 怎么用 + 易错点）">${esc(cur ? cur.content : '')}</textarea>
      </div>
    </div>`;
  }).join('') : '<div class="col-empty">本次没有需要补讲解的考点。</div>';
  kpEl('aiKpExplain').querySelectorAll('[data-kp-exp]').forEach(ta => {
    ta.onchange = () => {
      const key = ta.dataset.kpExp;
      kpState.explains = (kpState.explains || []).filter(x => x.kpKey !== key);
      if (ta.value.trim()) kpState.explains.push({ kpKey: key, content: ta.value });
    };
  });
}

kpEl('aiKpAll').onclick = () => { (kpState.rows || []).forEach(r => { r.skip = false; }); renderKpLink(); };
kpEl('aiKpNone').onclick = () => { (kpState.rows || []).forEach(r => { r.skip = true; }); renderKpLink(); };

/* ---------- 应用并保存 + 撤销 ---------- */
kpEl('aiKpApply').onclick = async () => {
  const st = kpState;
  if (!st) return;
  const rows = (st.rows || []).filter(r => !r.skip && r.kpKeys.length);
  if (!rows.length && !(st.explains || []).length) { alert('没有选中任何可应用的挂载或讲解。'); return; }
  const r1 = applyKpLinks(stores.q.items, rows, { keyMap: st.keyMap, mode: st.mode });
  const r2 = applyKpExplain(stores.k.items, st.explains || [], { keyMap: st.keyMap, mode: st.mode });
  stores.q.items = r1.items;
  stores.k.items = r2.kps;
  await saveStore(stores.q.key, stores.q.items);
  await saveStore(stores.k.key, stores.k.items);
  render();
  refreshTagPicker();
  kpEl('aiKpUndo').style.display = '';
  kpEl('aiKpLinkMsg2').textContent = `已应用：错题 ${r1.changed} 道、考点讲解 ${r2.changed} 条。`;
};

function undoAiKp() {
  const st = kpState;
  if (!st || !st.undo) return;
  stores.q.items = st.undo.q;
  stores.k.items = st.undo.k;
  colStores.k = st.undo.cols;
  saveStore(stores.q.key, stores.q.items);
  saveStore(stores.k.key, stores.k.items);
  saveCols('k');
  render();
  refreshTagPicker();
  kpEl('aiKpUndo').style.display = 'none';
  kpEl('aiKpLinkMsg2').textContent = '已撤销。';
  st.undo = null;
}
kpEl('aiKpUndo').onclick = () => undoAiKp();
```

- [ ] **Step 2: 语法检查**

Run: `node --check app.js && node --test test/`
Expected: 无输出（语法 OK）；测试全部 PASS。

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: AI 整理知识点的四屏弹层（设置 → 体系 → 挂载 → 应用/撤销）"
```

---

## Task 12: 浏览器验收 + 手工回归

**Files:** 无（只验收）

- [ ] **Step 1: 起本地服务**

Run: `python3 -m http.server 8127 --bind 127.0.0.1`
Expected: 服务启动，浏览器打开 `http://127.0.0.1:8127/`。

- [ ] **Step 2: 造数据**

在浏览器控制台执行（模拟 3 道错题，无 AI Key 时也能验收后半段）：

```js
colStores.q = []; colStores.k = [];
stores.q.items = [
  normalizeQuestion({ id: 'q1', stem: '求 $\\lim_{n\\to\\infty} \\frac{1}{n}=0$ 的证明' }),
  normalizeQuestion({ id: 'q2', stem: '用罗尔定理证明方程有根' }),
  normalizeQuestion({ id: 'q3', stem: '求矩阵 $A$ 的行列式' }),
];
saveStore(stores.q.key, stores.q.items);
render();
```

- [ ] **Step 3: 走一遍四屏（无 Key 路径）**

点「🧠 整理知识点」→ 设置屏选「全部错题 / 只补不覆盖」→ 点「复制提示词（免 Key）」→ 在粘贴框里填：

```json
[{"subject":"高等数学","chapter":"极限","topics":[{"title":"夹逼定理","kpId":null}]},{"subject":"高等数学","chapter":"中值定理","topics":[{"title":"罗尔定理","kpId":null}]}]
```

点「解析并继续」→ 体系审阅应出现 1 个学科、2 个章节、2 个考点，标「新建」→ 点「应用体系，继续挂载」。

Expected: 知识点视图出现「高等数学」合集，其下「极限」「中值定理」，各挂 1 个考点条目；挂载屏出现 3 道错题（无 AI 时为 0 行，直接点「应用并保存」应弹「没有选中任何可应用的挂载或讲解」）。

- [ ] **Step 4: 手工补挂载并应用**

挂载屏逐题用「＋考点」下拉挂上考点，再点「应用并保存」。

Expected: 错题卡片出现「相关知识点 N」；知识点卡片出现「相关错题 N 道」；「待补讲解的考点」区里填的内容写入知识点 `content`。

- [ ] **Step 5: 持久化与撤销**

刷新页面 → 挂载与体系仍在；再点「撤销上次应用」。

Expected: 错题 `kpIds`、知识点讲解、合集全部回滚到应用前。

- [ ] **Step 6: 删除知识点不悬空**

在知识点视图删掉一个考点条目 → 切到错题视图。

Expected: 该错题上的相关知识点数减 1，`kpIds` 里不再有该 id。

- [ ] **Step 7: 回归**

按现有手工回归清单走一遍：AI 识题、AI 整理（打标签 / 归档 / 写考点）、整理工具（相似题 / 薄弱诊断）、导出 / 导入 / 回收站。

Expected: 与改动前一致；`node --test test/` 全绿。

- [ ] **Step 8: 提交验收记录（可选）**

```bash
git commit --allow-empty -m "chore: AI 整理知识点浏览器验收通过"
```

---

## 自查记录

- **spec 覆盖**：数据模型 → Task 1/2/7；AI 产物与两次调用 → Task 8；免 Key → Task 8/11；UI 四屏 → Task 9/10/11；应用语义（只补不覆盖 / 覆盖、key 解析、幂等、撤销）→ Task 3/4/5/11；边界（无 Key、空范围、非法 JSON、未知 id、删除清理）→ Task 7/8/11；测试 → Task 1-6 + 12。
- **类型一致性**：`kpIds`（数组）、`planKpTaxonomy` 返回 `{cols, kps, entries}`、`entries` 字段 `{key, kpId, title, collectionId, path, isNew}`、`applyKpLinks` 入参 `{qid, kpKeys, knowledge, skip}`、`applyKpExplain` 入参 `[{kpKey, content}]`、`keyMap` 为 `Map` —— 在 Task 3/4/5/8/11 中用法一致。
- **占位扫描**：无 TBD / TODO；每个代码步骤都给了完整代码。
