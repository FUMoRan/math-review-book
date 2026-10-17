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
  normalizeQuestion, normalizeKp,
  parseText, parseSearch,
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
