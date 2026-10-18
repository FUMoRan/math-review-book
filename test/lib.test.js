/* =========================================================
   lib.js 纯函数单元测试（Node 内置 test runner）
   运行：node --test test/
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const MQ = require('../lib.js');

const {
  DAY, STATUS, STATUS_NEXT, uid,
  normText, bigrams, simScore, simScoreFrom, makeGramProfile, simFromProfile,
  normalizeSrs, scheduleSrs, isDue, dueLabel,
  normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers, paperWrongToQuestion,
  sortItems,
  parseText, parsePaper, parseSearch,
  normalizeCollection, settleCollections, collectionChildren, collectionSubtreeIds,
  collectionPath, flattenCollections, addCollection, renameCollection,
  canMoveCollection, moveCollection, deleteCollection,
  filterItemsByCollection, collectionCounts, sanitizeItemCollections,
  bareMathSegments,
} = MQ;

/* ===================== 基础工具 ===================== */
test('STATUS 与流转链自洽', () => {
  assert.equal(STATUS.new, '未复习');
  assert.equal(STATUS[STATUS_NEXT.new], '复习中');
  assert.equal(STATUS[STATUS_NEXT.reviewing], '已掌握');
  assert.equal(STATUS[STATUS_NEXT.mastered], '未复习');
});

test('uid 非空且具备唯一性', () => {
  const a = uid();
  assert.ok(typeof a === 'string' && a.length > 0);
  const set = new Set();
  for (let i = 0; i < 2000; i++) set.add(uid());
  assert.equal(set.size, 2000);
});

/* ===================== 归一化 / 相似度 ===================== */
test('normText 去空格、转小写、去标点与 $', () => {
  assert.equal(normText('  F(x) = X^2  '), 'fx=x^2');
  assert.equal(normText('数学，。、；：！？“”‘’（）()【】[]$'), '数学');
  assert.equal(normText(null), '');
});

test('bigrams 生成相邻二元组', () => {
  assert.deepEqual(bigrams('abc'), ['ab', 'bc']);
  assert.deepEqual(bigrams('a'), []);
  assert.deepEqual(bigrams(''), []);
});

test('simScoreFrom 为 Dice 系数', () => {
  assert.equal(simScoreFrom(['ab', 'bc'], ['ab', 'bc']), 1);
  assert.equal(simScoreFrom([], ['ab']), 0);
  assert.equal(simScoreFrom(['ab'], []), 0);
  // A 命中 1 / (2+2) * 2 = 0.5
  assert.equal(simScoreFrom(['ab', 'bc'], ['bc', 'cd']), 0.5);
});

test('相似文本得分高，无关文本得分低', () => {
  const a = '求函数 f(x)=x^2-2x+1 的最小值';
  const b = '求函数 f(x)=x^2-2x+1 的最小值。';
  const c = '等差数列前 n 项和公式推导';
  assert.ok(simScore(a, b) > 0.9);
  assert.ok(simScore(a, c) < 0.2);
});

test('预编译 profile 与直接比较结果一致', () => {
  const a = '求函数 $f(x)=x^2-2x+1$ 的最小值';
  const b = '求函数 f(x)=x^2-2x+1 的最小值。';
  const p = makeGramProfile(a);
  assert.equal(simFromProfile(p, b), simScore(a, b));
  assert.equal(p.len, p.grams.length);
});

/* ===================== SRS ===================== */
test('normalizeSrs 补全默认值并转数字', () => {
  assert.deepEqual(normalizeSrs(undefined), { due: 0, interval: 0, ease: 2.5, reps: 0 });
  assert.deepEqual(normalizeSrs({ due: '123', interval: '2', ease: '3', reps: '4' }),
    { due: 123, interval: 2, ease: 3, reps: 4 });
});

test('scheduleSrs: reviewing 首次排到 1 天后', () => {
  const t0 = 1_000_000;
  const it = {};
  scheduleSrs(it, 'reviewing', t0);
  assert.equal(it.srs.reps, 1);
  assert.equal(it.srs.interval, 1);
  assert.equal(it.srs.due, t0 + DAY);
});

test('scheduleSrs: reviewing 间隔按 1.5 倍增长', () => {
  const t0 = 0;
  const it = {};
  scheduleSrs(it, 'reviewing', t0);          // interval 1
  scheduleSrs(it, 'reviewing', t0);          // round(1*1.5)=2
  assert.equal(it.srs.interval, 2);
  scheduleSrs(it, 'reviewing', t0);          // round(2*1.5)=3
  assert.equal(it.srs.interval, 3);
});

test('scheduleSrs: mastered 首次 3 天、之后按 ease 放大', () => {
  const t0 = 0;
  const it = {};
  scheduleSrs(it, 'mastered', t0);
  assert.equal(it.srs.interval, 3);
  scheduleSrs(it, 'mastered', t0);           // round(3*2.5)=8
  assert.equal(it.srs.interval, 8);
  assert.equal(it.srs.ease, 2.5);
});

test('scheduleSrs: new 重置间隔与 ease，立即到期', () => {
  const t0 = 5 * DAY;
  const it = { srs: { due: 0, interval: 10, ease: 2.8, reps: 3 } };
  scheduleSrs(it, 'new', t0);
  assert.equal(it.srs.interval, 0);
  assert.equal(it.srs.ease, 2.5);
  assert.equal(it.srs.due, t0);              // interval 0 => due = now
  // reps 仍累加
  assert.equal(it.srs.reps, 4);
});

test('isDue: 无 srs / due 到点 / 未到点', () => {
  const now = 10 * DAY;
  assert.equal(isDue({}, now), true);
  assert.equal(isDue({ srs: { due: 0 } }, now), true);
  assert.equal(isDue({ srs: { due: now - 1 } }, now), true);
  assert.equal(isDue({ srs: { due: now + 1 } }, now), false);
});

test('dueLabel 文案分支', () => {
  const now = 10 * DAY;
  assert.equal(dueLabel({}, now), '待复习');
  assert.equal(dueLabel({ srs: { due: now - DAY } }, now), '待复习');
  assert.equal(dueLabel({ srs: { due: now + DAY / 2 } }, now), '今天稍后');
  assert.equal(dueLabel({ srs: { due: now + 2 * DAY } }, now), '2 天后复习');
});

/* ===================== 数据结构归一化 ===================== */
test('normalizeQuestion 补全字段并过滤脏数据', () => {
  const o = normalizeQuestion({
    stem: 'x',
    tags: ['a', '', '  ', 1, 'b'],
    status: '不存在的状态',
    star: 1,
    images: ['id1', '', null, 'id2'],
  });
  assert.ok(o.id);
  assert.equal(o.stem, 'x');
  assert.equal(o.analysis, '');
  assert.equal(o.myAnswer, '');
  assert.deepEqual(o.tags, ['a', 'b']);
  assert.equal(o.status, 'new');
  assert.equal(o.star, true);
  assert.deepEqual(o.images, ['id1', 'id2']);
  assert.deepEqual(o.srs, { due: 0, interval: 0, ease: 2.5, reps: 0 });
  assert.ok(o.createdAt > 0 && o.updatedAt > 0);
});

test('normalizeQuestion 保留合法状态与时间戳', () => {
  const o = normalizeQuestion({ status: 'mastered', createdAt: 123, updatedAt: 456, myAnswer: '我算错了' });
  assert.equal(o.status, 'mastered');
  assert.equal(o.createdAt, 123);
  assert.equal(o.updatedAt, 456);
  assert.equal(o.myAnswer, '我算错了');
});

test('normalizeKp 与题目共用结构和默认值', () => {
  const k = normalizeKp({ title: '顶点式', content: '$y=a(x-h)^2+k$' });
  assert.ok(k.id);
  assert.equal(k.title, '顶点式');
  assert.equal(k.content, '$y=a(x-h)^2+k$');
  assert.deepEqual(k.tags, []);
  assert.equal(k.status, 'new');
});
test('normalizeQuestion / normalizeKp 对非对象入参安全', () => {
  assert.equal(normalizeQuestion(null).stem, '');
  assert.equal(normalizeKp(undefined).title, '');
  assert.equal(normalizeKp('nonsense').title, '');
});

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

test('mergeSeedPapers 只追加本地没有的试卷', () => {
  const seeds = [
    { id: 'seed-math1-2024', title: '2024 年考研数学一真题', questions: [{ no: 1, stem: '$x$' }] },
    { id: 'seed-math1-2023', title: '2023 年考研数学一真题', questions: [{ no: 1, stem: '$y$' }] },
  ];
  const out = mergeSeedPapers([{ id: 'seed-math1-2024', title: '我自己改过的 2024' }], seeds);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'seed-math1-2023');
  assert.equal(out[0].title, '2023 年考研数学一真题');
  assert.equal(out[0].questions.length, 1);
  assert.ok(out[0].questions[0].id);            // 题目 id 由归一化补全
});

test('mergeSeedPapers 入参非法、脏数据与重复 id 均安全', () => {
  assert.deepEqual(mergeSeedPapers(null, null), []);
  assert.deepEqual(mergeSeedPapers([], [{ no: 1 }]), []);            // 种子缺 id 直接跳过
  assert.equal(mergeSeedPapers([], [{ id: 'a' }, { id: 'a' }]).length, 1);
  const out = mergeSeedPapers([null, 42, { id: 'a' }], [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(out.map(p => p.id), ['b']);
});

test('mergeSeedPapers 追加项经归一化（三态默认 unset、答案与日期为空）', () => {
  const [p] = mergeSeedPapers([], [{ id: 's', questions: [{ no: 3, stem: 'z', wrong: 'bogus' }] }]);
  assert.equal(p.questions[0].no, 3);
  assert.equal(p.questions[0].wrong, 'unset');
  assert.equal(p.questions[0].answer, '');
  assert.equal(p.date, '');
  assert.equal(p.note, '');
});

/* ===================== 粘贴文本解析 ===================== */
const Q_MAP = { 题目: 'stem', 解析: 'analysis', 知识点: 'knowledge', 我的错误答案: 'myAnswer', 标签: 'tags' };
const Q_REQ = '题目';

test('parseText 解析单题（含可选字段与标签）', () => {
  const input = [
    '【题目】',
    '求函数 $f(x)=x^2-2x+1$ 的最小值。',
    '【解析】',
    '配方得 $f(x)=(x-1)^2$，最小值为 $0$。',
    '【知识点】',
    '二次函数顶点式。',
    '【我的错误答案】',
    '我把对称轴看反了。',
    '【标签】',
    '二次函数, 最值',
  ].join('\n');
  const out = parseText(input, Q_MAP, Q_REQ);
  assert.equal(out.length, 1);
  const q = out[0];
  assert.equal(q.stem, '求函数 $f(x)=x^2-2x+1$ 的最小值。');
  assert.match(q.analysis, /配方得/);
  assert.equal(q.knowledge, '二次函数顶点式。');
  assert.equal(q.myAnswer, '我把对称轴看反了。');
  assert.deepEqual(q.tags, ['二次函数', '最值']);
  assert.deepEqual(q.errors, []);
});

test('parseText 以 === 分隔多题', () => {
  const input = [
    '【题目】', '第一题', '【解析】', '解一', '【知识点】', '知一', '【标签】', '导数',
    '===',
    '【题目】', '第二题', '【解析】', '解二', '【知识点】', '知二', '【标签】', '数列',
  ].join('\n');
  const out = parseText(input, Q_MAP, Q_REQ);
  assert.equal(out.length, 2);
  assert.equal(out[0].stem, '第一题');
  assert.deepEqual(out[0].tags, ['导数']);
  assert.equal(out[1].stem, '第二题');
  assert.deepEqual(out[1].tags, ['数列']);
});

test('parseText 缺少必填字段时记录错误', () => {
  const input = '【解析】\n只有解析\n【知识点】\n有知识';
  const out = parseText(input, Q_MAP, Q_REQ);
  assert.equal(out.length, 1);
  assert.ok(out[0].errors.some(e => e.includes('缺少【题目】')));
});

test('parseText 标记前多余文本被忽略并告警', () => {
  const input = '这行是废话\n【题目】\n真正的题目';
  const out = parseText(input, Q_MAP, Q_REQ);
  assert.equal(out.length, 1);
  assert.equal(out[0].stem, '真正的题目');
  assert.ok(out[0].errors.some(e => e.includes('标记前有多余文本')));
});

test('parseText 过滤空白块，标签支持中文逗号', () => {
  const input = '【题目】\n题\n【标签】\n函数，方程';
  const out = parseText(input, Q_MAP, Q_REQ);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].tags, ['函数', '方程']);
  // 顿号不在规范分隔符内，整段作为一个标签（已知行为）
  assert.deepEqual(parseText('【题目】\n题\n【标签】\n函数、方程', Q_MAP, Q_REQ)[0].tags, ['函数、方程']);
});

test('parseText 支持知识点库的字段映射', () => {
  const K_MAP = { 知识点: 'title', 讲解: 'content', 标签: 'tags' };
  const out = parseText('【知识点】\n顶点式\n【讲解】\n$y=a(x-h)^2+k$\n【标签】\n函数', K_MAP, '知识点');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '顶点式');
  assert.equal(out[0].content, '$y=a(x-h)^2+k$');
  assert.deepEqual(out[0].tags, ['函数']);
});

/* ===================== 搜索语法 ===================== */
test('parseSearch 空输入返回空条件', () => {
  assert.deepEqual(parseSearch(''), { text: '', tags: [], status: null, star: false, due: false });
  assert.deepEqual(parseSearch(null), { text: '', tags: [], status: null, star: false, due: false });
});

test('parseSearch 普通关键词进入 text 并小写化', () => {
  const s = parseSearch('函数  单调性');
  assert.equal(s.text, '函数 单调性');
  assert.deepEqual(s.tags, []);
  assert.equal(s.status, null);
});

test('parseSearch tag: 与 # 前缀等价且去重', () => {
  const s = parseSearch('tag:导数 #导数 #数列');
  assert.deepEqual(s.tags, ['导数', '数列']);
  assert.equal(s.text, '');
});

test('parseSearch status: 支持中英文并做合法性校验', () => {
  assert.equal(parseSearch('status:mastered').status, 'mastered');
  assert.equal(parseSearch('status:已掌握').status, 'mastered');
  assert.equal(parseSearch('status:复习中').status, 'reviewing');
  assert.equal(parseSearch('status:new').status, 'new');
  // 非法状态值回落为普通关键词
  const bad = parseSearch('status:xxx');
  assert.equal(bad.status, null);
  assert.equal(bad.text, 'status:xxx');
});

test('parseSearch star / due 标志位（中英文）', () => {
  assert.equal(parseSearch('star').star, true);
  assert.equal(parseSearch('星标').star, true);
  assert.equal(parseSearch('due').due, true);
  assert.equal(parseSearch('今天').due, true);
  assert.equal(parseSearch('待复习').due, true);
  assert.equal(parseSearch('today').due, true);
});

test('parseSearch 组合语法：标签 + 状态 + 星标 + 关键词', () => {
  const s = parseSearch('tag:导数 status:reviewing star 极值');
  assert.deepEqual(s.tags, ['导数']);
  assert.equal(s.status, 'reviewing');
  assert.equal(s.star, true);
  assert.equal(s.due, false);
  assert.equal(s.text, '极值');
});

test('parseSearch 无前缀的普通词只作为关键词，不当作标签', () => {
  const s = parseSearch('导数 数列');
  assert.deepEqual(s.tags, []);
  assert.equal(s.text, '导数 数列');
});

/* ===================== 裸 LaTeX 切分（无定界符） ===================== */
// 只取 math 片段，便于断言
const mathOf = segs => segs.filter(s => s.t === 'math').map(s => s.v);
const textOf = segs => segs.filter(s => s.t === 'text').map(s => s.v);

test('bareMathSegments: 整行裸公式判为行间公式', () => {
  const src = "y'' = \\frac{dp}{dx} = \\frac{dp}{dy} \\cdot \\frac{dy}{dx} = p \\frac{dp}{dy}";
  const segs = bareMathSegments(src);
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].v, src);
  assert.equal(math[0].display, true);
});

test('bareMathSegments: 中文句子中的裸公式判为行内公式', () => {
  const segs = bareMathSegments('由 a_1 与公差 d 可得 x^2 的结果。');
  assert.deepEqual(textOf(segs), ['由 ', ' 与公差 d 可得 ', ' 的结果。']);
  const math = segs.filter(s => s.t === 'math');
  assert.deepEqual(math.map(m => m.v), ['a_1', 'x^2']);
  assert.ok(math.every(m => m.display === false));
});

test('bareMathSegments: 无公式的纯中文文本不误判', () => {
  const src = '这是一个普通句子，没有任何公式。';
  const segs = bareMathSegments(src);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].t, 'text');
  assert.equal(segs[0].v, src);
});

test('bareMathSegments: 全角句号后正确截断，不吞进标点', () => {
  const segs = bareMathSegments('因此 y=x^2。');
  assert.deepEqual(mathOf(segs), ['y=x^2']);
  assert.deepEqual(textOf(segs), ['因此 ', '。']);
});

test('bareMathSegments: 行间公式与说明文字混排，换行保留在文本段', () => {
  const segs = bareMathSegments('第一行说明\n\nx^2 + 1 = 0\n\n结束');
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].display, true);
  assert.equal(math[0].v, 'x^2 + 1 = 0');
  assert.equal(textOf(segs).join(''), '第一行说明\n\n\n\n结束');
});

test('bareMathSegments: 多个 LaTeX 片段（含空格）合并为一段', () => {
  const segs = bareMathSegments('设 \\alpha + \\beta = \\gamma 成立');
  assert.deepEqual(mathOf(segs), ['\\alpha + \\beta = \\gamma']);
  assert.equal(segs[0].t, 'text');
});

test('bareMathSegments: 无强信号（无 \\命令/上下标）不触发', () => {
  const src = '(a+b)/2 这只是一段说明文字';
  const segs = bareMathSegments(src);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].t, 'text');
});

test('bareMathSegments: 空与非字符串入参安全', () => {
  assert.deepEqual(bareMathSegments(''), []);
  assert.deepEqual(bareMathSegments(null), []);
  assert.deepEqual(bareMathSegments(undefined), []);
});

test('bareMathSegments: 整行公式即便以全角句号收尾也判为行间公式', () => {
  const segs = bareMathSegments('\\frac{a}{b} = c。');
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].v, '\\frac{a}{b} = c');
  assert.equal(math[0].display, true);
  assert.deepEqual(textOf(segs), ['。']);
});

test('bareMathSegments: 行内公式即使位于句尾也不升级为行间公式', () => {
  const segs = bareMathSegments('求导得 x^2。');
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].display, false);
});

test('bareMathSegments: 字母+撇的导数记号（yy\'、yy\'\'）不从公式中断开', () => {
  const segs = bareMathSegments("第2步：得 yy' = C_1。");
  assert.deepEqual(mathOf(segs), ["yy' = C_1"]);
  assert.deepEqual(textOf(segs), ['第2步：得 ', '。']);
});

test('bareMathSegments: 只有撇、没有 ^ _ 反斜杠的整行公式也能识别', () => {
  const segs = bareMathSegments("(yy')' = 0");
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].v, "(yy')' = 0");
  assert.equal(math[0].display, true);
});

test('bareMathSegments: 乘积求导公式（含 u\'v、uv\'）整体识别', () => {
  const segs = bareMathSegments("由 (uv)' = u'v + uv' 可得");
  assert.deepEqual(mathOf(segs), ["(uv)' = u'v + uv'"]);
  assert.deepEqual(textOf(segs), ['由 ', ' 可得']);
});

test('bareMathSegments: 只有等号的等式（x=0、y=1）可识别', () => {
  assert.deepEqual(mathOf(bareMathSegments('代入初始条件 x=0 时')), ['x=0']);
  assert.deepEqual(mathOf(bareMathSegments('初始条件 x=0, y=1，得')), ['x=0, y=1']);
});

test('bareMathSegments: 大于号片段不脱离公式（y|_{x=0}=1 > 0）', () => {
  const segs = bareMathSegments('由 y|_{x=0}=1 > 0，应舍去负根');
  assert.deepEqual(mathOf(segs), ['y|_{x=0}=1 > 0']);
});

test('bareMathSegments: 填空题下划线不被当成公式', () => {
  const segs = bareMathSegments('特解为_______。');
  assert.equal(segs.filter(s => s.t === 'math').length, 0);
});

test('bareMathSegments: 英文词不被吞进公式（MATLAB、don\'t）', () => {
  assert.deepEqual(mathOf(bareMathSegments('用 MATLAB 绘制 s^2 曲线')), ['s^2']);
  assert.equal(bareMathSegments("注意 don't 这类词").filter(s => s.t === 'math').length, 0);
});

test('bareMathSegments: 填空下划线（a=____）不与等号一起卷进公式', () => {
  const segs = bareMathSegments('则 a=____。');
  assert.deepEqual(mathOf(segs), ['a=']);
  assert.deepEqual(textOf(segs), ['则 ', '____。']);
});

test('bareMathSegments: 跨行矩阵环境整体识别为行间公式', () => {
  const src = "A = \\begin{pmatrix}\na & 2 & 2 \\\\\n2 & a & 2 \\\\\n2 & 2 & a\n\\end{pmatrix}";
  const segs = bareMathSegments(src);
  const math = segs.filter(s => s.t === 'math');
  assert.equal(math.length, 1);
  assert.equal(math[0].display, true);
  assert.equal(math[0].v, src);
  assert.equal(segs.filter(s => s.t === 'text').length, 0);
});

/* ===================== 端到端：解析 → 归一化 → SRS ===================== */
test('粘贴文本经解析归一化后可正确排程', () => {
  const input = '【题目】\n题\n【解析】\n解\n【知识点】\n知\n【标签】\n函数';
  const [parsed] = parseText(input, Q_MAP, Q_REQ);
  const item = normalizeQuestion(parsed);
  assert.equal(item.status, 'new');
  assert.equal(isDue(item, Date.now()), true);         // 新条目天然到期

  // 复刻 app.js applyStatus：先改状态，再按新状态排程
  const next = STATUS_NEXT[item.status];
  item.status = next;
  scheduleSrs(item, next, Date.now());
  assert.equal(item.status, 'reviewing');
  assert.equal(item.srs.interval, 1);
  assert.equal(isDue(item, Date.now()), false);        // 已排到 1 天后
});

/* ===================== 合集（集合树） ===================== */
// 构造一棵固定树：a(根) > b(子) ；c(根)
function tree() {
  return [
    { id: 'a', name: '高数', parentId: null, createdAt: 1, updatedAt: 1 },
    { id: 'b', name: '极限', parentId: 'a', createdAt: 2, updatedAt: 2 },
    { id: 'c', name: '线代', parentId: null, createdAt: 3, updatedAt: 3 },
  ];
}

test('normalizeCollection 补默认值并 trim 名称', () => {
  const c = normalizeCollection({ name: '  极限  ' });
  assert.equal(c.name, '极限');
  assert.equal(c.parentId, null);
  assert.ok(c.id && typeof c.id === 'string');
  assert.equal(normalizeCollection({}).name, '未命名合集');
  assert.equal(normalizeCollection({ name: 'x', parentId: '' }).parentId, null);
});

test('settleCollections 修正悬空 parentId 并断开环', () => {
  const cols = settleCollections([
    { id: 'a', name: 'A', parentId: 'ghost' },          // 父不存在 → 提到根
    { id: 'b', name: 'B', parentId: 'b' },              // 自环 → 断开
    { id: 'c', name: 'C', parentId: 'd' },              // c↔d 互指 → 断环
    { id: 'd', name: 'D', parentId: 'c' },
  ]);
  const byId = new Map(cols.map(c => [c.id, c]));
  assert.equal(byId.get('a').parentId, null);
  assert.equal(byId.get('b').parentId, null);
  assert.ok(byId.get('c').parentId === null || byId.get('d').parentId === null);
});

test('collectionSubtreeIds 含自身、跨层、对环安全', () => {
  assert.deepEqual([...collectionSubtreeIds(tree(), 'a')].sort(), ['a', 'b']);
  assert.deepEqual([...collectionSubtreeIds(tree(), 'b')], ['b']);
  assert.deepEqual([...collectionSubtreeIds(tree(), 'c')], ['c']);
});

test('collectionChildren 按创建时间稳定排序', () => {
  assert.deepEqual(collectionChildren(tree(), null).map(c => c.id), ['a', 'c']);
  assert.deepEqual(collectionChildren(tree(), 'a').map(c => c.id), ['b']);
});

test('flattenCollections 带层级深度，深度优先', () => {
  assert.deepEqual(flattenCollections(tree()).map(c => [c.id, c.depth]),
    [['a', 0], ['b', 1], ['c', 0]]);
});

test('collectionPath 返回从根到自身的路径', () => {
  assert.deepEqual(collectionPath(tree(), 'b').map(c => c.id), ['a', 'b']);
  assert.deepEqual(collectionPath(tree(), 'a').map(c => c.id), ['a']);
  assert.deepEqual(collectionPath(tree(), 'none'), []);
});

test('addCollection / renameCollection', () => {
  const { cols, node } = addCollection([], '高数', null, 100);
  assert.equal(cols.length, 1);
  assert.equal(node.name, '高数');
  assert.equal(node.createdAt, 100);
  const child = addCollection(cols, '极限', node.id, 101);
  assert.equal(child.node.parentId, node.id);
  const renamed = renameCollection(child.cols, child.node.id, ' 数列极限 ', 102);
  assert.equal(renamed.find(c => c.id === child.node.id).name, '数列极限');
  assert.equal(renamed.find(c => c.id === child.node.id).updatedAt, 102);
  // 空名不生效
  assert.equal(renameCollection(child.cols, node.id, '   ')[0].name, '高数');
});

test('moveCollection 拒绝移入自身子树，允许合法移动', () => {
  assert.equal(canMoveCollection(tree(), 'a', 'b'), false);   // b 是 a 的子
  assert.equal(canMoveCollection(tree(), 'a', 'a'), false);   // 自身
  assert.equal(canMoveCollection(tree(), 'b', 'a'), true);     // 原地
  assert.equal(canMoveCollection(tree(), 'c', 'a'), true);     // 换父
  const bad = moveCollection(tree(), 'a', 'b');
  assert.equal(bad.ok, false);
  const good = moveCollection(tree(), 'c', 'a', 9);
  assert.equal(good.ok, true);
  assert.equal(good.cols.find(c => c.id === 'c').parentId, 'a');
});

test('deleteCollection 删除整棵子树并返回 removedIds/parentId', () => {
  const r = deleteCollection(tree(), 'a');
  assert.deepEqual(r.removedIds.sort(), ['a', 'b']);
  assert.equal(r.parentId, null);
  assert.deepEqual(r.cols.map(c => c.id), ['c']);
});

test('filterItemsByCollection 三种口径：全部 / 未分类 / 子树', () => {
  const items = [
    { id: '1', collectionId: 'a' },
    { id: '2', collectionId: 'b' },
    { id: '3', collectionId: 'c' },
    { id: '4', collectionId: null },
    { id: '5', collectionId: 'ghost' },   // 指向已删合集
  ];
  const cols = tree();
  assert.equal(filterItemsByCollection(items, cols, '__all__').length, 5);
  assert.deepEqual(filterItemsByCollection(items, cols, null).map(i => i.id), ['4']);
  assert.deepEqual(filterItemsByCollection(items, cols, 'a').map(i => i.id), ['1', '2']);
  assert.deepEqual(filterItemsByCollection(items, cols, 'c').map(i => i.id), ['3']);
});

test('collectionCounts 计数含子树，非法引用计入未分类', () => {
  const items = [
    { id: '1', collectionId: 'a' },
    { id: '2', collectionId: 'b' },
    { id: '3', collectionId: 'c' },
    { id: '4', collectionId: null },
    { id: '5', collectionId: 'ghost' },
  ];
  const { direct, subtree, unassigned } = collectionCounts(items, tree());
  assert.equal(direct.get('a'), 1);
  assert.equal(direct.get('b'), 1);
  assert.equal(subtree.get('a'), 2);       // a + b
  assert.equal(subtree.get('c'), 1);
  assert.equal(unassigned, 2);             // null + ghost
});

test('sanitizeItemCollections 把非法引用纠正为未分类', () => {
  const items = [{ id: '1', collectionId: 'a' }, { id: '2', collectionId: 'ghost' }, { id: '3', collectionId: null }];
  const changed = sanitizeItemCollections(items, tree());
  assert.equal(changed, true);
  assert.equal(items[1].collectionId, null);
  assert.equal(items[0].collectionId, 'a');
  assert.equal(sanitizeItemCollections(items, tree()), false);   // 再跑一次无变化
});

test('条目归一化带上 collectionId；来自试卷的错题默认未分类', () => {
  assert.equal(normalizeQuestion({ collectionId: 'a' }).collectionId, 'a');
  assert.equal(normalizeQuestion({}).collectionId, null);
  assert.equal(normalizeKp({ collectionId: 'k1' }).collectionId, 'k1');
  assert.equal(normalizeKp({ collectionId: '' }).collectionId, null);
  const paper = normalizePaper({ id: 'p1', questions: [{ id: 'q1', stem: 'x', wrong: 'wrong' }] });
  const [converted] = paperWrongToQuestion(paper, 0);
  assert.equal(converted.collectionId, null);
  assert.equal(converted.fromPaper.paperId, 'p1');
});

/* ===================== 排序（order 字段） ===================== */
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

