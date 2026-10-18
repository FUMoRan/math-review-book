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
      srs: normalizeSrs(o.srs),
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
      star: !!o.star,
      images: Array.isArray(o.images) ? o.images.filter(s => typeof s === 'string' && s) : [],
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

  return {
    DAY,
    STATUS, STATUS_NEXT, uid,
    normText, bigrams, simScore, simScoreFrom, makeGramProfile, simFromProfile,
    SRS_DEF, normalizeSrs, scheduleSrs, isDue, dueLabel,
    normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper,
    parseBlockGeneric, parseText, parsePaper,
    parseSearch,
    bareMathSegments,
  };
});
