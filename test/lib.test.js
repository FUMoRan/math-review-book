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
  normalizeQuestion, normalizeKp, normalizePaperQuestion, normalizePaper, mergeSeedPapers, paperWrongToQuestion, nextUnmarked,
  cleanAiText, setPaperSteps,
  paperProgress, answerVisible,
  sortItems, materializeOrder, reorderItems,
  parseText, parsePaper, parseSearch,
  normalizeCollection, settleCollections, collectionChildren, collectionSubtreeIds,
  collectionPath, flattenCollections, addCollection, renameCollection,
  canMoveCollection, moveCollection, deleteCollection,
  filterItemsByCollection, collectionCounts, sanitizeItemCollections,
  parseAiJson, normTag, mergeSuggestTags, resolveCollectionPath, applyOrganizePlan, pickKpIds, planRowOf,
  planKpTaxonomy, applyKpLinks, applyKpExplain, kpUsage, normalizeKpTaxonomy, sampleEvenly,
  clampMaxTokens, MAX_TOKENS_DEF,
  kpsMissingContent, fillKpContent, applyKpSink,
  clusterBySimilarity, groupStats,
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

test('normalizePaperQuestion 保留合法配图 id，过滤空值', () => {
  const q = normalizePaperQuestion({ stem: 'x', images: ['a', '', null, 0, 'b'] });
  assert.deepEqual(q.images, ['a', 'b']);
  assert.deepEqual(normalizePaperQuestion({}).images, []);
});

test('normalizePaperQuestion 保留解题步骤，非字符串归空', () => {
  assert.equal(normalizePaperQuestion({ steps: '第 1 步' }).steps, '第 1 步');
  assert.equal(normalizePaperQuestion({ steps: 123 }).steps, '');
  assert.equal(normalizePaperQuestion({}).steps, '');
});

test('cleanAiText 去掉围栏与首尾空白', () => {
  assert.equal(cleanAiText('  \n第 1 步  \n'), '第 1 步');
  assert.equal(cleanAiText('```\n第 1 步\n```'), '第 1 步');
  assert.equal(cleanAiText('```markdown\n第 1 步\n```'), '第 1 步');
  assert.equal(cleanAiText('中间```不算'), '中间```不算');
  assert.equal(cleanAiText(null), '');
});

test('setPaperSteps 只改对应题且不改原数组', () => {
  const qs = [
    { id: 'a', stem: 'x', steps: '' },
    { id: 'b', stem: 'y', steps: '' },
  ];
  const r = setPaperSteps(qs, 'b', '```\n第 1 步\n```');
  assert.equal(r.changed, true);
  assert.equal(r.questions[0].steps, '');
  assert.equal(r.questions[1].steps, '第 1 步');
  // 原对象不被修改
  assert.equal(qs[1].steps, '');
  // 内容相同视为未变
  assert.equal(setPaperSteps(r.questions, 'b', '第 1 步').changed, false);
  // 未知 id 不产生改动
  assert.equal(setPaperSteps(qs, 'zzz', 'x').changed, false);
  assert.deepEqual(setPaperSteps(null, 'a', 'x').questions, []);
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

test('paperWrongToQuestion 把题目配图一并带到错题', () => {
  const paper = normalizePaper({ id: 'p1', questions: [{ id: 'q1', stem: 'a', wrong: 'wrong', images: ['imgA', 'imgB'] }] });
  const [converted] = paperWrongToQuestion(paper, 0);
  assert.deepEqual(converted.images, ['imgA', 'imgB']);
  assert.deepEqual(paperWrongToQuestion(normalizePaper({ questions: [{ stem: 'x', wrong: 'wrong' }] }), 0)[0].images, []);
});

test('paperWrongToQuestion 无错题时返回空数组', () => {
  const paper = normalizePaper({ questions: [{ stem: 'a', wrong: 'right' }] });
  assert.deepEqual(paperWrongToQuestion(paper, 0), []);
});

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
  // maxNew=2：'导数'、'单调性' 两个新标签占满额度，'拉格朗日' 被截断
  assert.deepEqual(mergeSuggestTags(['极限'], ['导数', ' 单调性 ', '拉格朗日'], vocab, 2), ['极限', '导数', '单调性']);
  assert.deepEqual(mergeSuggestTags(['极限'], ['导数', ' 单调性 ', '拉格朗日'], vocab, 3), ['极限', '导数', '单调性', '拉格朗日']);
  assert.deepEqual(mergeSuggestTags([], ['a', 'b', 'c'], [], 2), ['a', 'b']);
  assert.deepEqual(mergeSuggestTags(['导数'], ['导数', '#导数'], [], 3), ['导数']);
  assert.deepEqual(mergeSuggestTags(['x'], [], [], 3), ['x']);
});

/* ===================== AI 整理：路径解析与应用计划 ===================== */
test('resolveCollectionPath 逐级创建，重复调用复用同一节点', () => {
  let cols = [];
  const r1 = resolveCollectionPath(cols, '高等数学/极限', 1000);
  cols = r1.cols;
  assert.equal(cols.length, 2);
  assert.equal(collectionPath(cols, r1.id).map(c => c.name).join('/'), '高等数学/极限');

  const r2 = resolveCollectionPath(cols, '高等数学/极限', 2000);
  assert.equal(r2.cols.length, 2);
  assert.equal(r2.id, r1.id);

  const r3 = resolveCollectionPath(r2.cols, '高等数学> 导数', 3000);
  assert.equal(r3.cols.length, 3);
  assert.equal(r3.id, r3.cols.find(c => c.name === '导数').id);
});

test('resolveCollectionPath 空路径返回 id=null 且不改动合集', () => {
  assert.deepEqual(resolveCollectionPath([], '', 1), { cols: [], id: null });
  assert.equal(resolveCollectionPath([], '   ', 1).id, null);
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
  assert.equal(r.cols.length, 4);
  assert.deepEqual(r.items[1].tags, ['行列式']);

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

test('applyOrganizePlan 把 kpIds 合并进已有挂载（去重、忽略非字符串）', () => {
  const items = [
    normalizeQuestion({ id: 'q1', stem: 'a' }),
    normalizeQuestion({ id: 'q2', stem: 'b', kpIds: ['k1'] }),
  ];
  const r = applyOrganizePlan(items, [
    { id: 'q1', kpIds: ['k9'] },
    { id: 'q2', kpIds: ['k9'] },
  ], { cols: [] });
  assert.deepEqual(r.items[0].kpIds, ['k9']);
  assert.deepEqual(r.items[1].kpIds, ['k1', 'k9']);
  assert.equal(r.changed, 2);
  // 重复给出同一个 id 不产生重复项，也不计改动
  const r2 = applyOrganizePlan(items, [{ id: 'q2', kpIds: ['k1', 'k1', '', null, 3] }], { cols: [] });
  assert.deepEqual(r2.items[1].kpIds, ['k1']);
  assert.equal(r2.changed, 0);
});

/* ===================== 知识点讲解补全 ===================== */
test('kpsMissingContent 只挑出讲解为空的知识点', () => {
  const list = [
    { id: 'a', title: '导数定义', content: '' },
    { id: 'b', title: '中值定理', content: '已有讲解' },
    { id: 'c', title: '极限', content: '   ' },
    { id: 'd', title: '行列式' },
    null,
  ];
  assert.deepEqual(kpsMissingContent(list).map(x => x.id), ['a', 'c', 'd']);
  assert.deepEqual(kpsMissingContent(null), []);
});

test('fillKpContent 只补空讲解，已有内容不被覆盖', () => {
  const now = 12345;
  const list = [
    normalizeKp({ id: 'a', title: '导数定义', content: '' }),
    normalizeKp({ id: 'b', title: '中值定理', content: '原有讲解' }),
    normalizeKp({ id: 'c', title: '极限' }),
  ];
  const r = fillKpContent(list, [
    { id: 'a', content: '  第 1 步：定义 $f\'(x)$。  ' },
    { id: 'b', content: 'AI 新讲解' },
    { id: 'c', content: '第 1 步：极限的定义。' },
  ], now);
  assert.equal(r.changed, 2);
  assert.equal(r.items[0].content, '第 1 步：定义 $f\'(x)$。');
  assert.equal(r.items[0].updatedAt, now);
  assert.equal(r.items[1].content, '原有讲解');
  assert.equal(r.items[2].content, '第 1 步：极限的定义。');
  // 纯函数：不改动入参
  assert.equal(list[0].content, '');
  assert.equal(list[0].updatedAt !== now, true);
});

test('fillKpContent 忽略未知 id、空内容与重复项', () => {
  const list = [normalizeKp({ id: 'a', title: '极限' })];
  const r = fillKpContent(list, [
    { id: 'x', content: '无关内容' },
    { id: 'a', content: '   ' },
    { id: 'a', content: '第一份' },
    { id: 'a', content: '第二份' },
  ]);
  assert.equal(r.changed, 1);
  assert.equal(r.items[0].content, '第二份');
});

/* ===================== 错题沉淀到知识库 ===================== */
test('applyKpSink 新建知识点并回链错题', () => {
  const kps = [normalizeKp({ id: 'k1', title: '极限', content: '已有讲解' })];
  const r = applyKpSink(kps, [
    { id: 'q1', kpTitle: '中值定理', kpExplain: '第 1 步：罗尔定理。', tags: ['微分', ' '] },
  ], 2000);
  assert.equal(r.created, 1);
  assert.equal(r.filled, 0);
  assert.equal(r.changed, 1);
  assert.equal(r.kps.length, 2);
  const nk = r.kps[1];
  assert.equal(nk.title, '中值定理');
  assert.equal(nk.content, '第 1 步：罗尔定理。');
  assert.deepEqual(nk.tags, ['微分']);
  assert.equal(nk.createdAt, 2000);
  assert.equal(nk.collectionId, null);
  assert.deepEqual(r.links, [{ qid: 'q1', kpId: nk.id }]);
  // 纯函数：不改动入参
  assert.equal(kps.length, 1);
});

test('applyKpSink 同名只补空讲解，不覆盖已有内容', () => {
  const kps = [
    normalizeKp({ id: 'k1', title: '极限', content: '' }),
    normalizeKp({ id: 'k2', title: '导数', content: '原有讲解' }),
  ];
  const r = applyKpSink(kps, [
    { id: 'q1', kpTitle: ' 极限 ', kpExplain: '新的极限讲解' },
    { id: 'q2', kpTitle: '导数', kpExplain: '新的导数讲解' },
  ], 3000);
  assert.equal(r.created, 0);
  assert.equal(r.filled, 1);
  assert.equal(r.kps[0].content, '新的极限讲解');
  assert.equal(r.kps[0].id, 'k1');
  assert.equal(r.kps[1].content, '原有讲解');
  assert.deepEqual(r.links.map(l => l.kpId), ['k1', 'k2']);
});

test('applyKpSink 同批同名只建一个，并忽略缺标题或缺讲解', () => {
  const r = applyKpSink([], [
    { id: 'q1', kpTitle: '洛必达法则', kpExplain: '第一份' },
    { id: 'q2', kpTitle: '洛必达法则', kpExplain: '第二份' },
    { id: 'q3', kpTitle: '', kpExplain: '没有标题' },
    { id: 'q4', kpTitle: '夹逼定理', kpExplain: '   ' },
  ], 4000);
  assert.equal(r.created, 1);
  assert.equal(r.kps.length, 1);
  assert.equal(r.kps[0].content, '第一份');
  assert.deepEqual(r.links.map(l => l.qid), ['q1', 'q2']);
  assert.equal(r.links[0].kpId, r.links[1].kpId);
});

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

/* ===================== 知识点体系：计划与应用 ===================== */
const TAX = [
  { subject: '高等数学', chapter: '极限', topics: [{ title: '夹逼定理', kpId: null }, { title: '单调有界准则', kpId: null }, { title: '两个重要极限', kpId: null }] },
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

/* ===================== 考点体系 JSON 的容错归一 ===================== */
test('normalizeKpTaxonomy 认标准结构，并把非法项过滤掉', () => {
  const out = normalizeKpTaxonomy([
    { subject: '高等数学', chapter: '极限', topics: [{ title: '夹逼定理', kpId: null }] },
    { subject: '', chapter: '空学科', topics: [{ title: 'x' }] },
    { subject: '高等数学', chapter: '空考点', topics: [] },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, '高等数学');
  assert.equal(out[0].chapter, '极限');
  assert.deepEqual(out[0].topics, [{ title: '夹逼定理', kpId: null }]);
});

test('normalizeKpTaxonomy 兼容被对象包一层、学科下再套 chapters', () => {
  const wrapped = normalizeKpTaxonomy({
    subjects: [
      { subject: '线性代数', chapters: [
        { name: '行列式', topics: [{ name: '范德蒙德行列式' }, '按行展开'] },
      ] },
    ],
  });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].chapter, '行列式');
  assert.deepEqual(wrapped[0].topics.map(t => t.title), ['范德蒙德行列式', '按行展开']);
  assert.equal(wrapped[0].topics[0].kpId, null);

  // 只含一个数组字段的对象也能认出来
  const only = normalizeKpTaxonomy({ result: [{ subject: '概率论', chapter: '分布', topics: ['正态分布'] }] });
  assert.equal(only.length, 1);
  assert.equal(only[0].topics[0].title, '正态分布');
});

test('normalizeKpTaxonomy 兼容中文字段名与 kp_id，并保留复用 id', () => {
  const out = normalizeKpTaxonomy([
    { 学科: '高等数学', 章节: '中值定理', 考点: [{ 名称: '罗尔定理', kp_id: 'k9' }] },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { subject: '高等数学', chapter: '中值定理', topics: [{ title: '罗尔定理', kpId: 'k9' }] });
});

test('normalizeKpTaxonomy 对 null / 字符串 / 空对象返回空数组', () => {
  assert.deepEqual(normalizeKpTaxonomy(null), []);
  assert.deepEqual(normalizeKpTaxonomy('not json'), []);
  assert.deepEqual(normalizeKpTaxonomy({}), []);
  assert.deepEqual(normalizeKpTaxonomy([{ foo: 1 }]), []);
});

/* ===================== 均匀抽样（大题量下体系步的输入上限） ===================== */
test('sampleEvenly 超限时均匀取 max 个，覆盖首尾且不重不漏', () => {
  const items = Array.from({ length: 400 }, (_, i) => i);
  const out = sampleEvenly(items, 80);
  assert.equal(out.length, 80);
  assert.equal(out[0], 0);            // 首
  assert.equal(out[79], 395);         // 末（400/80=5，索引 79*5=395）
  assert.equal(new Set(out).size, 80); // 无重复
  for (let i = 1; i < out.length; i++) assert.ok(out[i] > out[i - 1]);
  // 分布均匀：相邻取样间隔只可能是 5
  for (let i = 1; i < out.length; i++) assert.equal(out[i] - out[i - 1], 5);
});

test('sampleEvenly 不足上限时原样返回，且不改动入参', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const out = sampleEvenly(items, 80);
  assert.deepEqual(out, items);
  assert.notEqual(out, items);        // 副本
  assert.deepEqual(sampleEvenly(items, 2), items);
});

test('sampleEvenly 对非法上限返回空数组', () => {
  assert.deepEqual(sampleEvenly([1, 2, 3], 0), []);
  assert.deepEqual(sampleEvenly([1, 2, 3], -1), []);
  assert.deepEqual(sampleEvenly([1, 2, 3], NaN), []);
  assert.deepEqual(sampleEvenly(null, 10), []);
});

/* ===================== 用户自定义的输出上限 ===================== */
test('clampMaxTokens 空值与非法值回落到 4096', () => {
  assert.equal(MAX_TOKENS_DEF, 4096);
  assert.equal(clampMaxTokens(''), 4096);
  assert.equal(clampMaxTokens(undefined), 4096);
  assert.equal(clampMaxTokens(null), 4096);
  assert.equal(clampMaxTokens(0), 4096);
  assert.equal(clampMaxTokens('abc'), 4096);
  assert.equal(clampMaxTokens(NaN), 4096);
});

test('clampMaxTokens 保留合法值并取整', () => {
  assert.equal(clampMaxTokens(8192), 8192);
  assert.equal(clampMaxTokens('8192'), 8192);
  assert.equal(clampMaxTokens('16384'), 16384);
  assert.equal(clampMaxTokens(8000.9), 8000);
});

test('clampMaxTokens 越界按边界夹住', () => {
  assert.equal(clampMaxTokens(100), 256);        // 低于下限
  assert.equal(clampMaxTokens(999999), 65536);   // 高于上限
  assert.equal(clampMaxTokens(-5), 4096);        // 负数视为非法
});

/* ===================== 试卷：答案显隐 ===================== */
test('answerVisible 判分模式恒可见，重做模式按揭示状态', () => {
  assert.equal(answerVisible('grade', false, new Set(), 'q1'), true);
  assert.equal(answerVisible('redo', true, new Set(), 'q1'), true);
  assert.equal(answerVisible('redo', false, new Set(['q1']), 'q1'), true);
  assert.equal(answerVisible('redo', false, new Set(['q1']), 'q2'), false);
  assert.equal(answerVisible('redo', false, new Set(), 'q1'), false);
});

test('answerVisible 兼容数组形式的已揭示列表', () => {
  assert.equal(answerVisible('redo', false, ['q1', 'q3'], 'q3'), true);
  assert.equal(answerVisible('redo', false, [], 'q1'), false);
  assert.equal(answerVisible('redo', false, null, 'q1'), false);
});

/* ===================== AI 整理：维度映射 ===================== */
test('pickKpIds 只保留库里存在的 id，去重并最多 3 个', () => {
  const valid = new Set(['k1', 'k2', 'k3', 'k4']);
  assert.deepEqual(pickKpIds(['k1', 'k1', 'k9', 'k2'], valid), ['k1', 'k2']);
  assert.deepEqual(pickKpIds(['k1', 'k2', 'k3', 'k4'], valid), ['k1', 'k2', 'k3']);
  assert.deepEqual(pickKpIds(['k9', 42, null], valid), []);
  assert.deepEqual(pickKpIds(null, valid), []);
  assert.deepEqual(pickKpIds(['k1'], ['k1', 'k2']), ['k1']);   // 数组形式的库
});

test('planRowOf 只映射勾选的维度，未勾选字段不出现', () => {
  const e = { id: 'q1', tags: ['极限', '  '], collectionPath: '高等数学/极限', kpIds: ['k1', 'kx'], knowledge: '考点' };
  const only = planRowOf(e, { tags: true }, ['k1']);
  assert.deepEqual(only, { id: 'q1', tags: ['极限'] });       // 空白标签被过滤，其余维度不写
  const all = planRowOf(e, { tags: true, collection: true, link: true, knowledge: true }, ['k1']);
  assert.deepEqual(all, {
    id: 'q1', tags: ['极限'], collectionPath: '高等数学/极限', kpIds: ['k1'], knowledge: '考点',
  });
});

test('planRowOf 对非法入参与缺失字段安全', () => {
  assert.equal(planRowOf(null, { tags: true }), null);
  assert.equal(planRowOf('x', { tags: true }), null);
  assert.deepEqual(planRowOf({ id: 'q1' }, { tags: true, link: true, knowledge: true }), { id: 'q1' });
  // 模型把 collectionPath 写成数组时应丢弃，不能落成 "[object Object]"
  assert.deepEqual(planRowOf({ id: 'q1', collectionPath: ['a'] }, { collection: true }), { id: 'q1' });
});




