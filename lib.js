/* =========================================================
   数学复习本 · lib.js
   纯逻辑（无 DOM 依赖）：状态、解析、归一化、相似度、SRS、搜索语法。
   浏览器以经典脚本加载（挂到 window.MQ）；Node 下可作为模块被单测引用。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MQ = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;

  /* ---------- 状态 ---------- */
  const STATUS = { new: '未复习', reviewing: '复习中', mastered: '已掌握' };
  const STATUS_NEXT = { new: 'reviewing', reviewing: 'mastered', mastered: 'new' };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 文本归一化 / 相似度（用于去重） ---------- */
  function normText(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[，。、；：！？“”‘’（）()【】\[\]$]/g, '');
  }
  function bigrams(s) {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }
  // Dice 系数（0~1）。对同一段文本反复比较时可预先 bigrams，见 makeGramProfile。
  function simScore(a, b) {
    return simScoreFrom(bigrams(normText(a)), bigrams(normText(b)));
  }
  function simScoreFrom(A, B) {
    if (!A.length || !B.length) return 0;
    const m = new Map();
    A.forEach(g => m.set(g, (m.get(g) || 0) + 1));
    let hit = 0;
    for (const g of B) { const c = m.get(g); if (c > 0) { hit++; m.set(g, c - 1); } }
    return (2 * hit) / (A.length + B.length);
  }
  // 预编译文本的 bigram 多重集，避免同一文本被反复计算
  function makeGramProfile(text) {
    const A = bigrams(normText(text));
    return { grams: A, len: A.length };
  }
  function simFromProfile(profile, textB) {
    return simScoreFrom(profile.grams, bigrams(normText(textB)));
  }

  /* ---------- SRS（轻量间隔重复） ----------
     队列规则：srs.due <= now 的条目即为「待复习」；新条目 due=0，天然立即到期。
     每次复习动作（切换状态）按新状态安排下次间隔。 */
  const SRS_DEF = { due: 0, interval: 0, ease: 2.5, reps: 0 };
  function normalizeSrs(s) {
    const o = s && typeof s === 'object' ? s : {};
    return { due: +o.due || 0, interval: +o.interval || 0, ease: +o.ease || 2.5, reps: +o.reps || 0 };
  }
  function scheduleSrs(it, newStatus, now) {
    const t = now || Date.now();
    const s = it.srs = normalizeSrs(it.srs);
    s.reps++;
    if (newStatus === 'new') {           // 手动重置回未复习
      s.interval = 0; s.ease = 2.5;
    } else if (newStatus === 'mastered') {
      s.interval = s.interval ? Math.round(s.interval * s.ease) : 3;
    } else {                              // reviewing：再次复习
      s.interval = s.interval ? Math.max(1, Math.round(s.interval * 1.5)) : 1;
    }
    s.due = s.interval > 0 ? t + s.interval * DAY : t;
    return s;
  }
  function isDue(it, now) {
    const s = it && it.srs;
    return ((s && s.due) || 0) <= (now || Date.now());
  }
  function dueLabel(it, now) {
    const due = (it && it.srs && it.srs.due) || 0;
    if (!due) return '待复习';
    const diff = due - (now || Date.now());
    if (diff <= 0) return '待复习';
    if (diff < DAY) return '今天稍后';
    return Math.round(diff / DAY) + ' 天后复习';
  }

  /* ---------- 归一化数据结构 ---------- */
  function normalizeQuestion(it) {
    const o = it && typeof it === 'object' ? it : {};
    const rawKp = Array.isArray(o.kpIds) ? o.kpIds : (typeof o.kpId === 'string' && o.kpId ? [o.kpId] : []);
    const kpIds = [...new Set(rawKp.filter(x => typeof x === 'string' && x))];
    return {
      id: o.id || uid(),
      stem: typeof o.stem === 'string' ? o.stem : '',
      analysis: typeof o.analysis === 'string' ? o.analysis : '',
      knowledge: typeof o.knowledge === 'string' ? o.knowledge : '',
      myAnswer: typeof o.myAnswer === 'string' ? o.myAnswer : '',
      tags: Array.isArray(o.tags) ? o.tags.filter(t => typeof t === 'string' && t.trim()) : [],
      status: STATUS[o.status] ? o.status : 'new',
      star: !!o.star,
      images: Array.isArray(o.images) ? o.images.filter(s => typeof s === 'string' && s) : [],
      collectionId: typeof o.collectionId === 'string' && o.collectionId ? o.collectionId : null,
      kpIds,
      srs: normalizeSrs(o.srs),
      order: Number.isFinite(o.order) ? o.order : null,
      createdAt: o.createdAt || Date.now(),
      fromPaper: (o.fromPaper && typeof o.fromPaper === 'object' && o.fromPaper.paperId)
        ? { paperId: o.fromPaper.paperId, questionId: o.fromPaper.questionId || null } : null,
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
      collectionId: typeof o.collectionId === 'string' && o.collectionId ? o.collectionId : null,
      srs: normalizeSrs(o.srs),
      order: Number.isFinite(o.order) ? o.order : null,
      createdAt: o.createdAt || Date.now(),
      updatedAt: o.updatedAt || Date.now(),
    };
  }

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
      images: Array.isArray(p.images) ? p.images.filter(s => typeof s === 'string' && s) : [],
      linkedQid: typeof p.linkedQid === 'string' && p.linkedQid ? p.linkedQid : null,
      steps: typeof p.steps === 'string' ? p.steps : '',
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

  /* 内置真题种子：只追加本地没有的（按 id 判重），不覆盖用户已有或已删除的 */
  function mergeSeedPapers(existing, seeds) {
    const have = new Set();
    for (const p of (Array.isArray(existing) ? existing : [])) {
      if (p && typeof p.id === 'string' && p.id) have.add(p.id);
    }
    const added = [];
    for (const s of (Array.isArray(seeds) ? seeds : [])) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) continue;
      if (have.has(s.id)) continue;
      have.add(s.id);
      added.push(normalizePaper(s));
    }
    return added;
  }

  /* ---------- 粘贴文本解析（【题目】/【解析】… / === 分隔） ---------- */
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
        images: Array.isArray(q.images) ? q.images.slice() : [],
        collectionId: null,
        kpId: null,
        srs: normalizeSrs(undefined),
        order: null,
        createdAt: t,
        updatedAt: t,
        fromPaper: { paperId: paper.id, questionId: q.id },
      }));
  }

  /* ---------- AI 解题 ----------
     模型返回的是讲解文本而非 JSON，只需去掉 ``` 围栏与首尾空白。 */
  function cleanAiText(text) {
    let s = String(text == null ? '' : text).trim();
    const m = s.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (m) s = m[1].trim();
    return s;
  }

  // 把某题的解题步骤写回题目数组（纯函数，不改原对象）
  function setPaperSteps(questions, qid, steps) {
    let changed = false;
    const out = (Array.isArray(questions) ? questions : []).map(q => {
      if (!q || q.id !== qid) return q;
      const next = cleanAiText(steps);
      if (next === q.steps) return q;
      changed = true;
      return Object.assign({}, q, { steps: next });
    });
    return { questions: out, changed };
  }

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

  /* 把当前顺序固化为显式 order（0..n-1）。
     入参应按「当前显示顺序」传入（进入手动模式时传 sortItems(items,'auto') 的结果）。 */
  function materializeOrder(items) {
    return (Array.isArray(items) ? items : []).map((it, i) => Object.assign({}, it, { order: i }));
  }

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

  /* ---------- AI 整理：输出解析与标签合并 ---------- */

  // 从 AI 输出里抽取 JSON：容忍 ```json 围栏、前后夹带的说明文字
  function parseAiJson(text) {
    const s = String(text == null ? '' : text);
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const body = (fence ? fence[1] : s).trim();
    try { return JSON.parse(body); } catch (e) { /* 继续退化尝试 */ }
    // 退化：取「最先出现的开括号」配对到同类型的最后一个闭括号
    // （散文里嵌 JSON 对象时，先出现的 { 优先于对象内部的 [，避免误取内层数组）
    const cands = [];
    for (const [a, b] of [['[', ']'], ['{', '}']]) {
      const i = body.indexOf(a), j = body.lastIndexOf(b);
      if (i >= 0 && j > i) cands.push([i, j]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    for (const [i, j] of cands) {
      try { return JSON.parse(body.slice(i, j + 1)); } catch (e) { /* 换下一个候选 */ }
    }
    return null;
  }

  // 标签归一：先去首尾空白，再去掉 # 前缀（用户/模型常写成 #标签）
  function normTag(t) {
    return String(t == null ? '' : t).trim().replace(/^#+/, '').trim();
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
     plan:  [{ id, tags?, collectionPath?, knowledge?, kpIds?, skip? }]
     opts:  { cols, vocab, maxNewTags, now }
       kpIds 直接并入错题的 kpIds（去重），调用方负责先过滤掉不存在的 id
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
      if (Array.isArray(p.kpIds) && p.kpIds.length) {
        const add = p.kpIds.filter(x => typeof x === 'string' && x);
        const ids = [...new Set([...(next.kpIds || []), ...add])];
        if (ids.length !== (next.kpIds || []).length) set('kpIds', ids);
      }
      if (dirty) { next = Object.assign({}, next, { updatedAt: now }); changed++; }
      return next;
    });
    return { items: out, cols, changed };
  }

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

  /* ---------- AI 单次输出上限 ----------
     用户在设置里可自定义，空值或非法值回落到 4096；越界按边界夹住。
     这是「上限」而非实际用量，调大不会增加耗时或扣费。 */
  const MAX_TOKENS_DEF = 4096;
  const MAX_TOKENS_MIN = 256;
  const MAX_TOKENS_MAX = 65536;
  function clampMaxTokens(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0) return MAX_TOKENS_DEF;
    return Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, n));
  }

  /* 把 AI / 粘贴回来的考点体系 JSON 归一成 [{ subject, chapter, topics: [{ title, kpId }] }]。
     模型经常不按示例给，这里对常见变形做容错：
       · 外层被对象包一层：{ subjects|data|items|result|taxonomy: [...] }
       · 学科下再套一层：[{ subject, chapters: [{ name, topics }] }]
       · 考点写成纯字符串，或键名用 name / 考点 / 名称
       · kpId 写成 kp_id
     两种情况都认不出来时返回 []，由上层提示用户重试。 */
  function normalizeKpTaxonomy(raw) {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (raw && typeof raw === 'object') {
      for (const k of ['subjects', 'subject', 'chapters', 'data', 'items', 'list', 'result', 'taxonomy', '体系', '学科']) {
        if (Array.isArray(raw[k])) { arr = raw[k]; break; }
      }
      if (!arr.length) {
        const only = Object.values(raw).filter(Array.isArray);
        if (only.length === 1) arr = only[0];
      }
    }
    const pick = (o, keys) => {
      if (!o || typeof o !== 'object') return '';
      for (const k of keys) {
        const v = o[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };
    const topicsOf = ch => {
      for (const k of ['topics', 'points', 'items', '考点']) {
        if (Array.isArray(ch[k])) return ch[k];
      }
      return [];
    };
    const toTopic = t => {
      if (typeof t === 'string') return { title: t.trim(), kpId: null };
      const title = pick(t, ['title', 'name', 'topic', '考点', '名称']);
      const kpId = (t && typeof t.kpId === 'string' && t.kpId)
        || (t && typeof t.kp_id === 'string' && t.kp_id) || null;
      return { title, kpId };
    };
    const out = [];
    const pushCh = (subject, chapter, topics) => {
      const s = String(subject || '').trim(), c = String(chapter || '').trim();
      if (!s || !c) return;
      const list = (Array.isArray(topics) ? topics : []).map(toTopic).filter(t => t.title);
      if (list.length) out.push({ subject: s, chapter: c, topics: list });
    };
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue;
      if (Array.isArray(el.chapters)) {
        const subject = pick(el, ['subject', 'name', '学科', '科目']);
        for (const ch of el.chapters) {
          if (!ch || typeof ch !== 'object') continue;
          pushCh(subject, pick(ch, ['chapter', 'name', '章节', '章']), topicsOf(ch));
        }
        continue;
      }
      pushCh(pick(el, ['subject', '学科', '科目']), pick(el, ['chapter', '章节', '章']), topicsOf(el));
    }
    return out;
  }

  /* 均匀抽样：至多取 max 个，覆盖首尾、分布均匀。
     用于「体系提议」这类只需要样本、却会被题量撑爆上下文的场景。
     不足 max 个时返回全部（副本）。 */
  function sampleEvenly(items, max) {
    const arr = Array.isArray(items) ? items : [];
    const n = Math.floor(max);
    if (!Number.isFinite(n) || n <= 0) return [];
    if (arr.length <= n) return arr.slice();
    const step = arr.length / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

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

  /* ---------- 搜索语法 ----------
     tag:导数  #导数    status:mastered/已掌握    star    due/今天
     其余词按普通关键词处理（AND）。 */
  const STATUS_TOKEN = { new: 'new', 未复习: 'new', reviewing: 'reviewing', 复习中: 'reviewing', mastered: 'mastered', 已掌握: 'mastered' };
  function parseSearch(str) {
    const out = { text: '', tags: [], status: null, star: false, due: false };
    const words = [];
    String(str || '').trim().split(/\s+/).forEach(tok => {
      if (!tok) return;
      let m;
      if ((m = tok.match(/^(?:tag:|#)(.+)$/i)) && m[1]) out.tags.push(m[1]);
      else if ((m = tok.match(/^status:(.+)$/i)) && m[1] && STATUS_TOKEN[m[1].toLowerCase()]) out.status = STATUS_TOKEN[m[1].toLowerCase()];
      else if (/^(star|\u661f\u6807)$/i.test(tok)) out.star = true;
      else if (/^(due|today|\u4eca\u5929|\u5f85\u590d\u4e60)$/i.test(tok)) out.due = true;
      else words.push(tok);
    });
    out.text = words.join(' ').toLowerCase();
    out.tags = [...new Set(out.tags)];
    return out;
  }

  /* ---------- 裸 LaTeX 切分（无 $ / \( \) 定界符，如部分 AI 直接输出） ----------
     场景：y'' = \frac{dp}{dx} = p \frac{dp}{dy} 这类整段 LaTeX 没有任何定界符。
     思路：只有当字符位置构成「强信号」时才认为是公式，再向左右按数学字符集扩展；
     遇到空白时，仅当两侧都是「数学词」才跨越（避免把普通英文句子卷入公式）。
     返回 [{t:'text',v}|{t:'math',v,display}]，公式未含定界符，交调用方渲染。 */
  const RE_MATH_ALNUM = /[0-9A-Za-z]/;
  const RE_MATH_SYM = /[\\{}^_()[\]|+\-*/=.,;:'"<>!?~%&·×÷≤≥≠≈∞∫∑∏√∂±→←⇒⇔∈∀∃αβγδθλμσφωπΩΔ∘∥⊥∠]/;

  function isMathChar(c) { return RE_MATH_ALNUM.test(c) || RE_MATH_SYM.test(c); }
  function isBlank(c) { return c === ' ' || c === '\t'; }
  // 连续两个及以上的下划线是填空题的空（如 a=______），不是数学下标，不能卷进公式
  function isBlankUnderscore(s, i) {
    return s[i] === '_' && (s[i + 1] === '_' || s[i - 1] === '_');
  }

  // 强信号：\命令、上下标（^ _ 后跟字母/数字/{/(）、求导撇（y'、yy''、(uv)'）、
  // 等号左侧有操作数的等式（x=0、y=1 这类只有等号的式子）
  function mathTrigger(s, i) {
    const c = s[i];
    if (c === '\\') return /[A-Za-z]/.test(s[i + 1] || '');
    if (c === '^' || c === '_') return /[A-Za-z0-9{(\[]/.test(s[i + 1] || '');
    if (c === "'") {
      const run = /([A-Za-z]*)$/.exec(s.slice(0, i))[1];   // 撇前连续字母不超过 2 个，避免 don't 这类英文词
      return (run.length >= 1 && run.length <= 2) || /\)$/.test(s.slice(0, i));
    }
    if (c === '=') return /[A-Za-z0-9)\]}']/.test(s[i - 1] || '');
    return false;
  }
  function tokenLeft(s, end) { let i = end; while (i > 0 && isMathChar(s[i - 1])) i--; return s.slice(i, end); }
  function tokenRight(s, from) { let i = from, n = s.length; while (i < n && isMathChar(s[i])) i++; return s.slice(from, i); }
  // 「像数学」的词：含 \命令、数字/上下标/括号/运算符；变量则要求一两个字母（x、uv、dp），
  // 或带撇的求导记号（y'、yy''、y'y'、u'v）；连续 3 个以上字母的英文词（MATLAB、don't）不算
  function mathToken(tok) {
    if (!tok) return false;
    if (/\\[A-Za-z]+/.test(tok)) return true;
    if (/[0-9^_{}[\]()=+\-*/<>]/.test(tok)) return true;
    if (/[A-Za-z]{3,}/.test(tok)) return false;
    return /^[A-Za-z][A-Za-z']*$/.test(tok) && (/'/.test(tok) || tok.length <= 2);
  }

  function expandLeft(s, start) {
    let i = start;
    while (i > 0) {
      if (isBlankUnderscore(s, i - 1)) break;
      if (isMathChar(s[i - 1])) { i--; continue; }
      if (isBlank(s[i - 1])) {
        let j = i; while (j > 0 && isBlank(s[j - 1])) j--;
        if (mathToken(tokenLeft(s, j)) && mathToken(tokenRight(s, i))) { i = j; continue; }
      }
      break;
    }
    return i;
  }
  function expandRight(s, start) {
    const n = s.length;
    let i = start;
    while (i < n) {
      const c = s[i];
      if (c === '\n' || c === '\r') break;
      if (isBlankUnderscore(s, i)) break;
      if (isMathChar(c)) { i++; continue; }
      if (isBlank(c)) {
        let j = i; while (j < n && isBlank(s[j])) j++;
        if (j < n && !/[\n\r]/.test(s[j]) && mathToken(tokenLeft(s, i)) && mathToken(tokenRight(s, j))) { i = j; continue; }
      }
      break;
    }
    return i;
  }

  function bareMathSegments(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    const n = s.length;
    let textStart = 0;
    const flush = end => { if (end > textStart) out.push({ t: 'text', v: s.slice(textStart, end) }); };

    // 跨行的 LaTeX 环境（矩阵 / 分段函数 / 对齐等）无法逐行识别，先整体定位，必须整段渲染
    const envEnd = new Map();
    const reEnv = /\\begin\{(pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|matrix|cases|aligned|alignedat|gathered|split|array|subarray|align\*?|alignat\*?)\}[\s\S]*?\\end\{\1\}/g;
    let em;
    while ((em = reEnv.exec(s))) envEnd.set(em.index, em.index + em[0].length);

    let i = 0;
    while (i < n) {
      if (envEnd.has(i)) {                       // 整个环境作为一段行间公式
        const b = envEnd.get(i);
        let a = expandLeft(s, i);
        while (a < b && /\s/.test(s[a])) a++;
        flush(a);
        out.push({ t: 'math', v: s.slice(a, b), display: true });
        textStart = b;
        i = b;
        continue;
      }
      if (!mathTrigger(s, i)) { i++; continue; }
      let a = expandLeft(s, i);
      let b = expandRight(s, i + 1);
      while (a < b && /\s/.test(s[a])) a++;
      while (b > a && /\s/.test(s[b - 1])) b--;
      while (b > a && /[.,;:]/.test(s[b - 1])) b--;
      while (a < b && /[.,;:]/.test(s[a])) a++;
      if (b <= a) { i++; continue; }

      const lineStart = s.lastIndexOf('\n', a - 1) + 1;
      let lineEnd = s.indexOf('\n', b); if (lineEnd < 0) lineEnd = n;
      // 整行只剩公式（允许行尾是全角/半角句读）时按行间公式渲染
      const tail = s.slice(b, lineEnd).replace(/[\s。，；：、,;:.]+$/, '');
      const display = !s.slice(lineStart, a).trim() && !tail;

      flush(a);
      out.push({ t: 'math', v: s.slice(a, b), display });
      textStart = b;
      i = b;
    }
    flush(n);
    return out;
  }

  /* ---------- 合集（文件夹式：一条内容只属一个合集；每库一棵可嵌套的树） ---------- */

  function normalizeCollection(o) {
    const p = o && typeof o === 'object' ? o : {};
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    return {
      id: p.id || uid(),
      name: name || '未命名合集',
      parentId: typeof p.parentId === 'string' && p.parentId ? p.parentId : null,
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
    };
  }

  // 归一化整棵树：修正指向不存在父节点的 parentId，并断开自环/父链环
  function settleCollections(list) {
    const cols = (Array.isArray(list) ? list : []).map(normalizeCollection);
    const byId = new Map(cols.map(c => [c.id, c]));
    for (const c of cols) {
      if (c.parentId && (!byId.has(c.parentId) || c.parentId === c.id)) c.parentId = null;
    }
    for (const c of cols) {
      const seen = new Set([c.id]);
      let p = c.parentId;
      while (p) {
        if (seen.has(p)) { c.parentId = null; break; }
        seen.add(p);
        const node = byId.get(p);
        p = node ? node.parentId : null;
      }
    }
    return cols;
  }

  function collectionChildren(cols, parentId) {
    const pid = parentId == null ? null : parentId;
    return (Array.isArray(cols) ? cols : [])
      .filter(c => (c.parentId || null) === pid)
      .sort((a, b) => (a.createdAt - b.createdAt) || a.name.localeCompare(b.name, 'zh'));
  }

  // 某节点及其全部后代（含自身）；对环安全
  function collectionSubtreeIds(cols, id) {
    const arr = Array.isArray(cols) ? cols : [];
    const out = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of arr) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); changed = true; }
      }
    }
    return out;
  }

  // 从根到该节点的路径（含自身），供面包屑
  function collectionPath(cols, id) {
    const byId = new Map((Array.isArray(cols) ? cols : []).map(c => [c.id, c]));
    const path = [];
    const seen = new Set();
    let cur = id;
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const n = byId.get(cur);
      path.unshift(n);
      cur = n.parentId;
    }
    return path;
  }

  // 深度优先展开，附带 depth，供侧栏与下拉使用
  function flattenCollections(cols) {
    const out = [];
    const walk = (parentId, depth) => {
      for (const c of collectionChildren(cols, parentId)) {
        out.push(Object.assign({}, c, { depth }));
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  function addCollection(cols, name, parentId, now) {
    const t = now || Date.now();
    const node = normalizeCollection({
      id: uid(),
      name,
      parentId: (typeof parentId === 'string' && parentId) ? parentId : null,
      createdAt: t, updatedAt: t,
    });
    return { cols: (Array.isArray(cols) ? cols : []).concat([node]), node };
  }

  function renameCollection(cols, id, name, now) {
    const t = now || Date.now();
    const nm = typeof name === 'string' ? name.trim() : '';
    if (!nm) return Array.isArray(cols) ? cols : [];
    return (Array.isArray(cols) ? cols : [])
      .map(c => c.id === id ? Object.assign({}, c, { name: nm, updatedAt: t }) : c);
  }

  function canMoveCollection(cols, id, newParentId) {
    const pid = (typeof newParentId === 'string' && newParentId) ? newParentId : null;
    if (!pid) return true;
    if (pid === id) return false;
    return !collectionSubtreeIds(cols, id).has(pid);
  }

  function moveCollection(cols, id, newParentId, now) {
    const arr = Array.isArray(cols) ? cols : [];
    if (!canMoveCollection(arr, id, newParentId)) return { cols: arr, ok: false };
    const t = now || Date.now();
    const pid = (typeof newParentId === 'string' && newParentId) ? newParentId : null;
    return {
      ok: true,
      cols: arr.map(c => c.id === id ? Object.assign({}, c, { parentId: pid, updatedAt: t }) : c),
    };
  }

  // 删除整棵子树，返回剩余树、被删 id 集合与该子树的父节点 id
  function deleteCollection(cols, id) {
    const arr = Array.isArray(cols) ? cols : [];
    const removedIds = collectionSubtreeIds(arr, id);
    const node = arr.find(c => c.id === id);
    return {
      cols: arr.filter(c => !removedIds.has(c.id)),
      removedIds: [...removedIds],
      parentId: node ? node.parentId : null,
    };
  }

  /* 按合集筛选条目。
     filterId：'__all__' 全部；null 未分类；其余 = 该合集及其子合集 */
  function filterItemsByCollection(items, cols, filterId) {
    const arr = Array.isArray(items) ? items : [];
    if (filterId === '__all__') return arr.slice();
    if (filterId == null) return arr.filter(it => !it.collectionId);
    const ids = collectionSubtreeIds(cols, filterId);
    return arr.filter(it => !!it.collectionId && ids.has(it.collectionId));
  }

  /* 计数：各节点「直接归属」数、含子树的数、未分类数。
     指向已不存在合集的条目计入未分类，与筛选口径保持一致。 */
  function collectionCounts(items, cols) {
    const arr = Array.isArray(items) ? items : [];
    const colsArr = Array.isArray(cols) ? cols : [];
    const valid = new Set(colsArr.map(c => c.id));
    const direct = new Map();
    let unassigned = 0;
    for (const it of arr) {
      const cid = it && it.collectionId;
      if (!cid || !valid.has(cid)) { unassigned++; continue; }
      direct.set(cid, (direct.get(cid) || 0) + 1);
    }
    const subtree = new Map();
    for (const c of colsArr) {
      const ids = collectionSubtreeIds(colsArr, c.id);
      let n = 0;
      for (const id of ids) n += direct.get(id) || 0;
      subtree.set(c.id, n);
    }
    return { direct, subtree, unassigned };
  }

  // 把指向不存在合集的条目纠正为「未分类」；返回是否需要落盘
  function sanitizeItemCollections(items, cols) {
    const valid = new Set((Array.isArray(cols) ? cols : []).map(c => c.id));
    let changed = false;
    for (const it of (Array.isArray(items) ? items : [])) {
      if (it && it.collectionId && !valid.has(it.collectionId)) { it.collectionId = null; changed = true; }
    }
    return changed;
  }

  return {
    DAY,
    STATUS, STATUS_NEXT, uid,
    normText, bigrams, simScore, simScoreFrom, makeGramProfile, simFromProfile,
    SRS_DEF, normalizeSrs, scheduleSrs, isDue, dueLabel,
    normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers,
    parseBlockGeneric, parseText, parsePaper,
    paperWrongToQuestion,
    cleanAiText, setPaperSteps,
    nextUnmarked,
    paperProgress,
    sortItems,
    materializeOrder,
    reorderItems,
    normalizeCollection, settleCollections, collectionChildren, collectionSubtreeIds,
    collectionPath, flattenCollections, addCollection, renameCollection,
    canMoveCollection, moveCollection, deleteCollection,
    filterItemsByCollection, collectionCounts, sanitizeItemCollections,
    parseAiJson, normTag, mergeSuggestTags,
    resolveCollectionPath, applyOrganizePlan,
    planKpTaxonomy, applyKpLinks, applyKpExplain, kpUsage, normalizeKpTaxonomy,
    sampleEvenly, clampMaxTokens, MAX_TOKENS_DEF,
    clusterBySimilarity, groupStats,
    parseSearch,
    bareMathSegments,
  };
});
