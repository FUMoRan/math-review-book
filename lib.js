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
      srs: normalizeSrs(o.srs),
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
        images: [],
        collectionId: null,
        srs: normalizeSrs(undefined),
        createdAt: t,
        updatedAt: t,
        fromPaper: { paperId: paper.id, questionId: q.id },
      }));
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
    normalizeCollection, settleCollections, collectionChildren, collectionSubtreeIds,
    collectionPath, flattenCollections, addCollection, renameCollection,
    canMoveCollection, moveCollection, deleteCollection,
    filterItemsByCollection, collectionCounts, sanitizeItemCollections,
    parseSearch,
    bareMathSegments,
  };
});
