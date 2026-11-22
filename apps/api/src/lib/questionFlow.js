// Послідовність питань категорії з умовами (2026-11-21, правка Олексія про унісекс-костюми: «спершу чоловік чи дівчина; чоловік — зріст і вага як завжди, жінка — чотири обміри»).
// Власник описує це в категорії: питання по порядку, у кожного — що спитати, які відповіді допустимі і за якої умови питання задається
// («відповідь на попереднє питання дорівнює цьому або цьому значенню»). Розмір за обмірами — таблиця `sizing`.
// Формат Category.questionFlow:
//   { questions: [ { id, ask, kind: 'options'|'numbers'|'legacy',
//                    options: [{ value, aliases: [..] }],          // kind=options — допустимі відповіді (aliases — як ще можуть написати)
//                    fields: ['Зріст','Груди','Талія','Стегна'],   // kind=numbers — які числа чекаємо, у цьому порядку
//                    showIf: { question: '<id попереднього>', in: ['жінка'] } }, … ],
//     sizing: { when: { question, in:[..] }, from: '<id питання з числами>', params: [{ key, field }], chart: [{ size, ranges: { <key>: [min,max] } }],
//               rule: { splitSpread: 2, top: ['<key>'], bottom: ['<key>',…], okText, splitText } } }
// kind='legacy' — далі працює звичайний збір параметрів категорії (requiredParams: зріст і вага).
const { ValidationError } = require('@crm/errors');

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const idOf = (v, i) => str(v, 40).replace(/[^a-zA-Z0-9_]/g, '') || ('q' + (i + 1));

function normalizeQuestionFlow(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('questionFlow: очікується обʼєкт { questions: [...] }');
  const questions = Array.isArray(raw.questions) ? raw.questions.slice(0, 12) : [];
  if (!questions.length) return null;
  const seen = new Set(); const out = [];
  questions.forEach((q, i) => {
    const id = idOf(q && q.id, i);
    if (seen.has(id)) throw new ValidationError('questionFlow: повторюється id «' + id + '»');
    const kind = ['options', 'numbers', 'legacy'].includes(q && q.kind) ? q.kind : 'options';
    const item = { id, kind, ask: str(q && q.ask, 700) };
    if (kind !== 'legacy' && !item.ask) throw new ValidationError('questionFlow: у питання «' + id + '» не написано, що спитати');
    if (kind === 'options') {
      item.options = (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o === 'string' ? { value: str(o, 60), aliases: [] } : { value: str(o && o.value, 60), aliases: (Array.isArray(o && o.aliases) ? o.aliases : []).map((a) => str(a, 60)).filter(Boolean).slice(0, 30) })).filter((o) => o.value).slice(0, 12);
      if (item.options.length < 2) throw new ValidationError('questionFlow: у питання «' + id + '» мають бути щонайменше два варіанти відповіді');
    }
    if (kind === 'numbers') {
      item.fields = (Array.isArray(q.fields) ? q.fields : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 8);
      if (item.fields.length < 1) throw new ValidationError('questionFlow: у питання «' + id + '» вкажіть, які числа чекаємо');
    }
    if (q && q.showIf && q.showIf.question) {
      if (!seen.has(str(q.showIf.question, 40))) throw new ValidationError('questionFlow: умова питання «' + id + '» посилається на питання, якого ще нема вище');
      item.showIf = { question: str(q.showIf.question, 40), in: (Array.isArray(q.showIf.in) ? q.showIf.in : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12) };
      if (!item.showIf.in.length) throw new ValidationError('questionFlow: у умові питання «' + id + '» вкажіть значення відповіді');
    }
    seen.add(id); out.push(item);
  });
  const flow = { questions: out };
  const sz = raw.sizing;
  if (sz && typeof sz === 'object') {
    const chart = (Array.isArray(sz.chart) ? sz.chart : []).slice(0, 20).map((r) => ({ size: str(r && r.size, 12), ranges: Object.fromEntries(Object.entries((r && r.ranges) || {}).slice(0, 8).map(([k, v]) => [str(k, 30), [Number(v && v[0]), Number(v && v[1])]])) })).filter((r) => r.size);
    for (const r of chart) for (const [k, v] of Object.entries(r.ranges)) if (!(Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[0] <= v[1])) throw new ValidationError('questionFlow: у таблиці розмірів «' + r.size + '» некоректний діапазон «' + k + '»');
    flow.sizing = {
      when: sz.when && sz.when.question ? { question: str(sz.when.question, 40), in: (Array.isArray(sz.when.in) ? sz.when.in : []).map((x) => str(x, 60)).filter(Boolean) } : null,
      from: str(sz.from, 40), params: (Array.isArray(sz.params) ? sz.params : []).slice(0, 8).map((p) => ({ key: str(p && p.key, 30), field: str(p && p.field, 40) })).filter((p) => p.key && p.field),
      chart,
      rule: { splitSpread: Number(sz.rule && sz.rule.splitSpread) || 2, top: (Array.isArray(sz.rule && sz.rule.top) ? sz.rule.top : []).map((x) => str(x, 30)), bottom: (Array.isArray(sz.rule && sz.rule.bottom) ? sz.rule.bottom : []).map((x) => str(x, 30)), okText: str(sz.rule && sz.rule.okText, 500), splitText: str(sz.rule && sz.rule.splitText, 900) },
    };
  }
  return flow;
}

module.exports = { normalizeQuestionFlow };
