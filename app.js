import { CHECKPOINTS, createInitialData, loadData, saveData, clearData, importData, validateData, downloadBackup, appendDecision, recordRouteDecision, download, isDate, checkpointCompletion } from './data.mjs';
import { downloadCalendar } from './reminders.mjs';
import { evaluate, validateBaseline, qualifyGuangdongOffer, qualifyShanghaiOffer, routeTendencies, deriveCareer, deriveEnergy, CAREER_WEIGHTS, financialCapacity, resignBlockers, addMonths, bridgeRenewalErrors } from './rules.mjs';

import { encryptBackup, decodeBackup } from './crypto.mjs';
import { projectCashflow, financeSnapshot, expandCashEvents, CASH_EVENT_TYPES, CASH_CERTAINTIES, CASH_IMPACTS } from './cashflow.mjs';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const insecureOrigin = !window.isSecureContext;
const VIEWS = new Set(['home', 'cashflow', 'feedback', 'offers', 'timeline', 'history', 'settings']);
const FEEDBACK_TABS = ['baseline', 'market', 'finance', 'offer', 'relationship', 'major', 'resign', 'progress', 'light'];
const STATE_LABELS = {
  BASELINE_SETUP: '先填收入和负债', MARKET_TESTING: '在广东和上海投简历', HOLD_AND_SEARCH: '继续上班，同时投简历',
  ROUTE_CHOICE_REQUIRED: '广东和上海都有合适岗位，你来选', GUANGDONG_READY: '已有合适的广东岗位', SHANGHAI_BRIDGE_READY: '可以考虑在上海过渡一段时间',
  NOTICE_AND_HANDOVER: '准备离职和交接', SHANGHAI_BRIDGE_ACTIVE: '先在上海工作，再找广东岗位',
  GUANGDONG_MIGRATION: '正在去广东工作和搬家', GUANGDONG_SETTLING: '已到广东，正在适应',
  DRIFT_REVIEW: '需要重新考虑下一步', STABLE: '已在广东安顿下来'
};
const TAB_LABELS = { baseline: '我的收入、负债和工作情况', market: '我投了简历 / 参加了面试', finance: '我的收入或负债有变化', offer: '我有新岗位 / 招聘消息', relationship: '我和女朋友的安排有变化', major: '我想决定接下来去哪里', resign: '我准备提离职', progress: '我已经入职 / 搬家', light: '其他变化 / 记一件事' };
let data;
let dataError = null;
let currentView = 'home';
let feedbackTab = '';
let editingOfferId = null;
let editingCashEventId = null;
let toastTimer;

try { if (insecureOrigin) throw new Error('个人数据只能在 HTTPS 或本机安全预览中使用。'); data = loadData(); } catch (error) { dataError = error; data = createInitialData(); }

function todayISO() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function dateLabel(iso) { if (!iso) return '待定'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(y)}年${Number(m)}月${Number(d)}日`; }
function shortDate(iso) { if (!iso) return '待定'; const [, m, d] = iso.slice(0, 10).split('-'); return `${Number(m)}月${Number(d)}日`; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function money(value) { return value == null || !Number.isFinite(Number(value)) ? '待确认' : `¥ ${Math.round(Number(value)).toLocaleString('zh-CN')}`; }
function num(value) { return value == null || value === '' ? null : Number(value); }
function bool(value) { return value === 'true' ? true : value === 'false' ? false : null; }
function choice(value, option) { return value === option ? 'selected' : ''; }
function checked(value) { return value ? 'checked' : ''; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function addDays(iso, days) { const date = new Date(`${iso}T12:00:00+08:00`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function daysBetween(a, b) { if (!a || !b) return null; return Math.round((Date.parse(`${b}T12:00:00+08:00`) - Date.parse(`${a}T12:00:00+08:00`)) / 86400000); }
function checkpointDate(item) { return data.config?.checkpointOverrides?.[item.id] || item.date; }
function checkpoints() { return CHECKPOINTS.map(item => ({ ...item, date: checkpointDate(item) })).sort((a, b) => a.date.localeCompare(b.date)); }
function nextCheckpoint() { return checkpoints().find(item => !checkpointCompletion(data, item.id)); }
function checkpointState(item) {
  const completedAt = checkpointCompletion(data, item.id);
  return { completedAt, state: completedAt ? 'complete' : item.date < todayISO() ? 'past' : item.date === todayISO() ? 'today' : 'future' };
}
function viewFromHash() { const raw = location.hash.slice(1); return VIEWS.has(raw) ? raw : 'home'; }
function notice(text) { toast.textContent = text; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3900); }
function showView(view, tab) { if (view === 'feedback') feedbackTab = FEEDBACK_TABS.includes(tab) ? tab : ''; if (view === currentView) render(); else location.hash = view; window.scrollTo({ top: 0, behavior: 'instant' }); }
function persistWithDecision(source, message = '已保存，并更新当前判断') {
  const decision = evaluate(data, todayISO());
  data.routeState = decision.routeState;
  data.riskState = decision.riskState;
  data = appendDecision(data, { ...decision, source, at: new Date().toISOString() });
  saveData(data);
  render();
  notice(message);
}
function pageHeader(title, note = '') { return `<header class="page-header"><div><h1>${escapeHTML(title)}</h1><p class="page-date">${dateLabel(todayISO())}</p></div>${note ? `<p class="page-note">${escapeHTML(note)}</p>` : ''}</header>`; }
function section(title, body, lead = '') { return `<section class="section"><h2>${escapeHTML(title)}</h2>${lead ? `<p class="section-lead">${escapeHTML(lead)}</p>` : ''}${body}</section>`; }
function input(name, label, value, options = {}) {
  const { type = 'text', min, max, step, placeholder = '', help = '', required = false, full = false } = options;
  const attrs = [`name="${escapeHTML(name)}"`, `id="${escapeHTML(name)}"`, `type="${type}"`, `value="${escapeHTML(value ?? '')}"`, `placeholder="${escapeHTML(placeholder)}"`];
  if (min != null) attrs.push(`min="${min}"`);
  if (max != null) attrs.push(`max="${max}"`);
  if (step != null) attrs.push(`step="${step}"`);
  if (required) attrs.push('required');
  return `<label class="field ${full ? 'full' : ''}"><span class="field-label ${required ? 'required' : ''}">${escapeHTML(label)}</span><input ${attrs.join(' ')} />${help ? `<span class="field-help">${escapeHTML(help)}</span>` : ''}</label>`;
}
function select(name, label, value, items, options = {}) {
  const { required = false, full = false, help = '' } = options;
  return `<label class="field ${full ? 'full' : ''}"><span class="field-label ${required ? 'required' : ''}">${escapeHTML(label)}</span><select name="${escapeHTML(name)}" ${required ? 'required' : ''}><option value="">请选择</option>${items.map(([v, text]) => `<option value="${escapeHTML(v)}" ${choice(value, v)}>${escapeHTML(text)}</option>`).join('')}</select>${help ? `<span class="field-help">${escapeHTML(help)}</span>` : ''}</label>`;
}
function textarea(name, label, value, options = {}) {
  const { required = false, placeholder = '', full = true, help = '' } = options;
  return `<label class="field ${full ? 'full' : ''}"><span class="field-label ${required ? 'required' : ''}">${escapeHTML(label)}</span><textarea name="${escapeHTML(name)}" placeholder="${escapeHTML(placeholder)}" ${required ? 'required' : ''}>${escapeHTML(value ?? '')}</textarea>${help ? `<span class="field-help">${escapeHTML(help)}</span>` : ''}</label>`;
}
function formSection(title, body, description = '') { return `<section class="form-section"><h2>${escapeHTML(title)}</h2>${description ? `<p>${escapeHTML(description)}</p>` : ''}<div class="form-grid">${body}</div></section>`; }
function formActions(label) { return `<div class="form-actions"><button class="btn btn-primary" type="submit">${escapeHTML(label)}</button><p class="form-error" aria-live="polite"></p></div>`; }

const costChoices = [['unknown','未知'],['low','大概低'],['medium','大概中'],['high','大概高'],['knownAmount','金额已知']];
const premiseLabels = {valid:'仍成立',partially_valid:'部分成立',invalid:'已失效',unknown:'未知'};
function certaintySelect(name,label,value) { return select(name,label,value,[['confirmed','已确认'],['likely','很可能'],['rough','粗略估计'],['unknown','未知']]); }
function careerFields(facts = {}, current = false) {
  return CAREER_WEIGHTS.map(([key,label,weight])=>select('career_'+key,(current && key === 'technologyDepth' ? '过去三个月学到了新技能' : label)+ ' · '+weight+'%',String(facts?.[key] ?? ''),[['true','有明确依据'],['false','目前没有'],['unknown','未知 / 需要核实']])).join('');
}
function careerOutput(facts = {}) {
  const r=deriveCareer(facts ?? {});
  return `<div class="field full score-output" aria-live="polite" data-career-output>${escapeHTML(careerText(r))}</div>`;
}
function careerText(r) { return r.score == null ? `工作成长评分：未知（已核实 ${r.coverage}/5 项），不会把缺失材料当作低分或高分。` : `工作成长评分：${{LOW:'偏低',MEDIUM:'中等',HIGH:'较高'}[r.band]} · ${r.points}/100（参考分 ${r.score}/5）。分数根据下面五项情况计算。`; }
function careerValues(v) { return Object.fromEntries(CAREER_WEIGHTS.map(([key])=>[key,bool(v['career_'+key])])); }
function energyFields(f = {}) {
  return [['workAvoidance','明显抗拒开始工作'],['lowMood','下班后持续低沉'],['restRecovers','休息后能够恢复'],['affectsLife','已影响正常工作或生活'],['expensiveRecovery','频繁依赖高成本方式恢复']].map(([key,label])=>select('energy_'+key,label,String(f?.[key] ?? ''),[['true','是'],['false','否'],['unknown','未知']])).join('');
}
function addFact(type,value,certainty='confirmed',source='user') {
  if (!value?.trim()) return;
  data.facts.push({id:uid(),type,value:value.trim(),certainty,recordedAt:new Date().toISOString(),source,supersedes:null});
}
const syncLabels={financial:'收入和负债数字',offer:'机会列表',career:'工作成长情况',energy:'工作体验',relationship:'关系计划'};
function syncConfirmation(type) {
  const pending=data.checkIns.filter(item=>item.type === 'light' && item.pendingSync && item.factType === type);
  if (!pending.length) return '';
  return `<label class="field full"><span class="field-label">还需更新的${syncLabels[type]}变化（${pending.length} 条）</span><span class="field-help">${pending.map(item=>escapeHTML(item.newFact)).join('<br />')}</span><span><input type="checkbox" name="sync_${type}" value="true" /> 我已逐条核对，上述变化都已反映在这次填写的内容里</span></label>`;
}
function resolvePendingFacts(v,...types) {
  const syncedAt=new Date().toISOString();
  for (const item of data.checkIns) if (item.type === 'light' && item.pendingSync && types.includes(item.factType) && v['sync_'+item.factType] === 'true') {
    item.pendingSync=false;item.syncedAt=syncedAt;
  }
}
function renderFiveQuestions(d) {
  const r=data.routeDecision, ps=r.decisionPremises ?? [], latest=data.facts.slice(-3).reverse(), tendencies=routeTendencies(data,todayISO());
  const baselineReady=validateBaseline(data).valid, selected=data.offers.find(o=>o.id===r.offerId), focusOffer=selected ?? data.offers.at(-1), current=data.baseline;
  const routeName=r.route === 'guangdong' ? '直接广东':r.route === 'shanghai_bridge' ? '上海过渡':null;
  const nextAction=baselineReady ? d.actions[0]?.text || '按期核对事实。':'先填写收入、负债和每月开支。';
  const tendencyRows=tendencies.length ? `<div class="route-tendencies">${tendencies.map(t=>`<div class="route-tendency"><div class="route-tendency-title"><strong>${escapeHTML(t.route)} · 条件匹配 ${t.score}%</strong><span>资料完整度 ${t.checked}/7（${t.confidence}%）</span></div><meter class="route-meter" min="0" max="100" value="${t.score}" aria-label="${escapeHTML(t.route)}匹配分数"></meter><p>${escapeHTML(t.company || '未命名机会')} · ${t.qualified ? '符合目前的选择条件，提离职前还要检查':`尚未达标：${escapeHTML(t.reason || '继续核实关键条件')}`}</p></div>`).join('')}</div><p class="question-note">百分比是各去向独立的条件匹配度，不是成功概率，也不要求相加为 100%；资料完整度只表示 7 项资料是否已填写，不代表资料真实可靠。提离职前，仍需确认录用通知、备用现金和交接时间。</p>`:`<p class="question-note">还没有岗位消息，暂时无法比较广东和上海。${baselineReady ? '有岗位消息时，在“更新近况”里记下来。':'先填基本资料，再记录投简历和面试的进展。'}</p>`;
  const reasons=ps.length ? `<p class="question-result">${r.decidedAt ? dateLabel(r.decidedAt)+'保存的选择':'已保存的选择'}${r.routeState ? `：${escapeHTML(STATE_LABELS[r.routeState] || r.routeState)}`:''}</p>${selected ? `<p>对应机会：${escapeHTML(selected.company)} · ${escapeHTML(selected.city)}</p>`:''}<ul class="plain-list">${ps.map(p=>`<li>${escapeHTML(p.text)}</li>`).join('')}</ul>${r.manualOverride ? `<p class="warning-note">例外理由：${escapeHTML(r.manualOverride.reason)}</p>`:''}`:`<p class="question-result">还没有保存你的选择</p><p>目前系统这样建议，是因为：</p><ul class="plain-list">${d.reasons.map(x=>`<li>${escapeHTML(x.text)}</li>`).join('')}</ul>`;
  const unknowns=d.unknowns.slice(0,2);
  const premises=ps.length ? `<p class="question-result">${ps.filter(p=>p.status==='valid').length}/${ps.length} 条标记为成立</p><ul class="plain-list">${ps.map(p=>`<li><strong>${escapeHTML(premiseLabels[p.status] || '未知')}</strong> · ${escapeHTML(p.text)}<small>（${p.reviewedAt ? `${dateLabel(p.reviewedAt)}确认`:'保存后还没确认过'}）</small></li>`).join('')}</ul>`:'<p class="question-result">还没写下选择的条件</p><p>在“更新近况”里选择“我想决定接下来去哪里”，写下选择的理由。</p>';
  const uncertainty=unknowns.length ? `<p class="question-note">还要确认：${unknowns.map(escapeHTML).join('；')}${d.unknowns.length>2 ? `；另有 ${d.unknowns.length-2} 项` : ''}</p>`:'';
  const factLabels={confirmed:'已确认',likely:'很可能',rough:'粗略估计',unknown:'未知'};
  const facts=latest.length ? `<ul class="plain-list">${latest.map(f=>`<li>${escapeHTML(f.value)}<small> · ${f.recordedAt ? dateLabel(f.recordedAt):'日期未记录'} · ${escapeHTML(factLabels[f.certainty] || '有多确定？未记录')}</small></li>`).join('')}</ul>`:'<p>还没有记录新的变化。</p>';
  const pending=data.checkIns.filter(item=>item.type === 'light' && item.pendingSync);
  const syncTargets={financial:['更新收入和负债','feedback','finance'],offer:['更新岗位信息','offers',null],career:['更新工作情况','feedback','baseline'],energy:['更新工作感受','feedback','baseline'],relationship:['更新女朋友的安排','feedback','relationship']};
  const pendingLinks=[...new Set(pending.map(item=>item.factType))].map(type=>syncTargets[type]).filter(Boolean).map(([label])=>label).join('、');
  const pendingNote=pending.length ? `<div class="inline-alert">有 ${pending.length} 条旧记录只写了文字，具体数字或安排还没更新。请从“更新近况”进入对应内容：${pendingLinks}</div>`:'';
  const fresh=financeSnapshot(data,todayISO()), forecast=projectCashflow(data,todayISO());
  const verifiedSnapshot=fresh.certainty === 'confirmed' && fresh.status === 'fresh';
  const certainFacts=verifiedSnapshot ? `现金 ${money(current.cashBalance)}、月到手 ${money(current.monthlyNetIncome)}（${dateLabel(fresh.date)}用户核对）` :
    '尚无近期已核对的完整财务基准';
  const estimatedFacts=[`月供＋生活费根据月度预算估算：${money(d.finance.required)}`];
  if(forecast.available)estimatedFacts.push(`未来30天谨慎最低现金估算：${money(forecast.periods[0].cautiousLowest)}`);
  const waitingFacts=[
    ...(fresh.status!=='fresh' ? ['可用现金最近的实际日期与金额'] : []),
    ...(forecast.issues.length ? forecast.issues.slice(0,2) : []),
    ...((data.offers??[]).some(o=>o.firstPayDate) ? ['新岗位首薪实际金额与到账情况'] : [])
  ];
  const decisionEvidence=`<details class="evidence-details"><summary>判断依据：已确认、估算与待确认</summary><div class="evidence-groups">
    <p><strong>已确认</strong> ${escapeHTML(certainFacts)}</p>
    <p><strong>估算 / 假设</strong> ${estimatedFacts.map(escapeHTML).join('；')}</p>
    <p><strong>待确认</strong> ${waitingFacts.length ? waitingFacts.map(escapeHTML).join('；'):'当前未列出新的待确认项'}</p>
  </div><button class="text-link" type="button" data-view="cashflow">查看现金流计算细节</button></details>`;
  const snapshot=`<p class="question-note">目前保存的数据：现金 ${money(current.cashBalance)} · 负债 ${money(current.debtBalance)} · 每月剩余 ${money(d.finance.monthlyBalance)}${focusOffer ? `；${selected ? '已选':'最新录入'}机会 ${escapeHTML(focusOffer.city)} / 到手 ${money(focusOffer.monthlyNetIncome)}`:''}；你和女朋友想去的地方${data.partnerPlan.sharedDestinationAligned === true ? '一致':data.partnerPlan.sharedDestinationAligned === false ? '未一致':'未确认'}。</p>`;
  const signals=[...d.blockers,...d.warnings.filter(w=>['yellow','red'].includes(w.level))];
  const driftResult=!baselineReady ? '资料不足，不能判定是否偏离原计划':d.requiresRedecision ? '需要重新考虑原来的选择':d.blockers.length ? '还有条件没确认好，暂不建议提离职':signals.length ? '有几件事需要留意':'目前没有发现明显偏离原计划';
  const difference=data.currentDecisionId && !['NOTICE_AND_HANDOVER','SHANGHAI_BRIDGE_ACTIVE','GUANGDONG_MIGRATION','GUANGDONG_SETTLING','STABLE'].includes(d.routeState) && d.routeState!==d.suggestedRoute ? `<p class="question-note">你的已选去向与当前系统建议不同；这是需要核对的分歧，不自动判错。</p>`:'';
  return section('五个问题，看清当前情况',`<div class="question-grid">
    <article class="question-primary"><h3>1. 我现在在做什么？</h3><p class="question-result">当前动作：${escapeHTML(STATE_LABELS[d.routeState])}${routeName ? ` · 已选方向：${routeName}`:''}</p><p>${data.currentDecisionId ? '这是你上次保存的选择。':'这是根据目前资料给出的建议。'} 系统当前建议：${escapeHTML(STATE_LABELS[d.suggestedRoute])}。</p>${tendencyRows}<p class="question-next">下一步：${escapeHTML(nextAction)}</p></article>
    <article><h3>2. 当初为什么这样选？</h3>${reasons}</article>
    <article><h3>3. 当初的条件现在还成立吗？</h3>${premises}${uncertainty}${r.manualOverride ? `<p class="question-note">例外理由于 ${dateLabel(r.manualOverride.nextReviewAt)} 复查。</p>`:''}</article>
    <article><h3>4. 最近有什么变化？</h3><p class="question-result">${latest.length ? `最近记录 ${latest.length} 条变化`:'尚无新变化记录'}</p>${facts}${pendingNote}${snapshot}</article>
    <article><h3>5. 我的计划有没有走偏？</h3><p class="question-result">${driftResult}</p>${!baselineReady ? '<p>先补齐现金、负债、收入和必要支出，暂不作“没有偏离原计划”的结论。</p>':signals.length ? `<ul class="plain-list">${signals.slice(0,3).map(x=>`<li>${escapeHTML(x.text)}</li>`).join('')}</ul>`:'<p>目前没有发现必须重新选择的情况，按时更新近况就好。</p>'}${difference}${decisionEvidence}<p class="question-next">下一步：${escapeHTML(nextAction)}</p></article>
  </div><details><summary>匹配分数与资料完整度怎么算？</summary><p>匹配分数权重：招聘进展占 20%，工作成长占 25%，收入能否覆盖开支占 20%，城市和时间安排占 20%，是否满足选择条件占 15%。资料完整度表示工资、开支、招聘进展、工作成长、换工作费用、试用期和双方安排等 7 类资料填了多少。</p></details>`);
}
function renderLightForm() {
  return `<p class="form-intro">在这里记下其他变化。如果收入、负债或岗位有变化，请先在上面的菜单选择对应内容，直接更新数字或安排。</p><form id="light-form">
  ${formSection('有变化时，只记录新的部分',select('factType','这件事和什么有关？','other',[['offer','新岗位 / 招聘条件变化'],['financial','收入 / 债务 / 现金'],['career','职责 / 技术 / 履历'],['energy','工作体验'],['relationship','关系 / 搬家'],['other','其他']])+
  certaintySelect('certainty','有多确定？','confirmed')+textarea('newFact','发生了什么新变化','',{required:true})+textarea('waitReason','新的“再等等”理由','')+input('nextReviewAt','希望提前再看一次计划的日期',null,{type:'date'}),'文字记录不会自动改动收入、负债或岗位数字。')}
  ${formActions('记录变化')}</form>`;
}
function renderMajorForm() {
  const r=data.routeDecision,d=evaluate(data,todayISO()),ps=r.decisionPremises ?? [];
  const routes=[['HOLD_AND_SEARCH','继续上班，同时投简历'],['GUANGDONG_READY','选择广东机会'],['SHANGHAI_BRIDGE_READY','选择上海过渡机会']];
  if (data.routeState === 'SHANGHAI_BRIDGE_ACTIVE') routes.push(['SHANGHAI_BRIDGE_ACTIVE','以新收益重新选择上海过渡']);
  return `<p class="form-intro">系统建议：${escapeHTML(STATE_LABELS[d.suggestedRoute])}。先检查旧条件，再决定未来。选择不同于系统建议的岗位，也需要先确认离职条件。</p><form id="major-form">
  ${formSection('1. 先复查上次条件',ps.length ? ps.map(p=>select('premise_'+p.id,p.text,'',[['valid','仍成立'],['partially_valid','部分成立'],['invalid','已失效'],['unknown','未知']],{full:true})).join('')+'<button type="button" class="btn btn-secondary" data-action="review-premises">只保存确认条件，暂不改变去向</button>':'<p class="field full">尚无选择条件；下面将创建第一次选择。</p>')}
  ${r.manualOverride ? formSection('上次选择不同建议的理由',`<p class="field full">${escapeHTML(r.manualOverride.reason)}</p>`+select('overrideStillValid','上次这样选择的理由现在是否仍成立','',[['true','仍成立'],['false','已失效'],['unknown','未知']])):''}
  ${formSection('2. 新事实与最终选择',textarea('newEvidence','最近有什么变化，让你想这样选？','',{help:'想延长留上海的时间，请写明新的好处，例如新项目、新工资或广东招聘情况变化。'})+
    certaintySelect('evidenceCertainty','这些消息有多确定？','confirmed')+
    select('routeState','我决定的去向',d.suggestedRoute === 'MARKET_TESTING' ? 'HOLD_AND_SEARCH':d.suggestedRoute,routes,{required:true})+
    select('offerId','这次选择的机会（继续上班可空）',r.offerId ?? '',data.offers.map(o=>[o.id,o.company+' · '+o.city]))+
    textarea('premises','为什么这样选？写 2–5 条','',{required:true,help:'每行写一条。例如：工资够还贷和生活；岗位能学到云安全；我们都想去广东。'})+
    input('nextMajorReviewAt','哪天再看看这个选择是否合适？',addDays(todayISO(),30),{type:'date',required:true})+
    select('manualOverride','是否选择暂未满足建议条件的岗位？','false',[['false','否，按建议条件选择'],['true','是，我会写明理由']],{required:true})+
    `<div class="field full" data-exception hidden><div class="form-grid">`+textarea('overrideReason','这样选择的理由（选择不同建议时必填）','')+
    input('overrideReviewAt','哪天再确认这个理由？',null,{type:'date'})+'</div></div>')}
  ${data.routeState === 'SHANGHAI_BRIDGE_ACTIVE' ? formSection('3. 继续留在上海的理由',select('renewalEvidenceType','继续留上海，能得到什么新的好处？','',[['project','已确认的新高价值项目'],['income','明确的新收入变化'],['market','广东招聘情况变化'],['other','新的重要事实']])+
    input('bridgeExitDate','最晚哪天重新决定去向？',addMonths(todayISO(),6),{type:'date'})+
    input('gdSearchRestartDate','哪天重新开始投广东岗位？',addDays(addMonths(todayISO(),6),-60),{type:'date'}),'想延长留在上海的时间，需要写明新的理由和日期。到期后重新考虑去向。'):''}
  ${formActions('保存我的选择')}</form>`;
}

function relativeDue(date) { const days = daysBetween(todayISO(), date); return days == null ? '' : days < 0 ? `超过计划日 ${-days} 天` : days === 0 ? '今天' : `${days} 天后`; }

function renderHome() {
  const decision = evaluate(data, todayISO());
  const baselineCheck = validateBaseline(data);
  const hero = baselineCheck.valid ? renderDecisionHero(decision) : renderSetupHero(baselineCheck);
  return pageHeader('今天的判断', '基于事实，做更适合自己的选择') +
    `<section class="section hero-grid">${hero}</section>` +
    renderFiveQuestions(decision) +
    renderCashflowPreview() +
    section('接下来要记住的日期', `<p>下次近况检查：${dateLabel(decision.nextCheckAt)}（${relativeDue(decision.nextCheckAt)}）${nextCheckpoint() ? ` · 下一计划节点：${dateLabel(nextCheckpoint().date)}` : ''}</p>${renderTimelineRail()}<button type="button" class="text-link" data-view="timeline">查看全部节点与完成记录</button>`, '计划日期不代表任务已完成；完成情况以保存的记录为准。') +
    `<section class="section"><details><summary>查看收入、负债和每月剩余的钱</summary>${renderFinanceSummary()}</details></section>`;
}
function renderSetupHero(check) {
  const labels = { debtBalance: '最新负债余额', cashBalance: '可用现金', gdMinNetIncome: '广东最低到手收入', maxLongDistanceDays: '双方异地上限', currentRoleGrowth: '当前岗位能学到什么', energyLevel: '当前精力状态', sharedDestinationAligned: '你和女朋友是否都想去广东？', monthlyNetIncome: '月到手收入', monthlyDebtPayment: '当前月供', monthlyLivingCost: '生活支出', oneOffCostsNext90Days: '未来90天一次性支出', gdMinCareerScore: '广东岗位最低成长分', bridgeMinSixMonthGain: '上海过渡收入要求', bridgeMaxMonths: '上海过渡最长月数', contractNoticeDays: '合同通知期', preferredHandoverDays: '期望交接天数', targetRoles: '目标岗位方向' };
  const missing = (check.missing || []).map(key => key.split('.').at(-1));
  const shortlist = missing.slice(0, 5);
  return `<div><h2 class="hero-title">先记录当下，不必算清未来</h2><p class="hero-copy">已知的先填，未知的留空。系统仍展示目前能确认的部分，只在提离职等重要决定前阻止关键未知。</p><button class="btn btn-primary" type="button" data-view="feedback" data-tab="baseline">更新近况 <span aria-hidden="true">→</span></button></div><div><h3>还需要填写的内容</h3><ul class="status-list">${shortlist.map(key => `<li><span class="status-dot" aria-hidden="true">!</span><span>${escapeHTML(labels[key] || key)}</span><strong>待填写</strong></li>`).join('')}${missing.length > shortlist.length ? `<li><span></span><span>另有 ${missing.length - shortlist.length} 项待填写</span><strong></strong></li>` : ''}</ul></div>`;
}
function renderDecisionHero(d) {
  const risks = [...d.blockers.map(x=>({...x,level:'red'})),...d.warnings.filter(x=>x.level !== 'info')];
  return `<div><div class="decision-banner ${d.level}"><div class="decision-topline"><span class="level ${d.level}">${escapeHTML({GREEN:'当前未发现显著风险',YELLOW:'需要关注',RED:'需要重新考虑下一步',BLOCKED:'离职动作被阻止'}[d.riskState])}</span></div><h2 class="hero-title">${escapeHTML(STATE_LABELS[d.routeState])}</h2><p class="hero-copy">系统建议：${escapeHTML(STATE_LABELS[d.suggestedRoute])}。你可以根据下面的理由和提醒，决定下一步。下次更新近况：${dateLabel(d.nextCheckAt)}。</p></div><button class="btn btn-primary" type="button" data-view="feedback">更新近况 <span aria-hidden="true">→</span></button></div><div><h3>为什么这样建议？</h3><ul class="plain-list">${d.reasons.map(x=>`<li>${escapeHTML(x.text)}</li>`).join('')}</ul>${risks.length ? `<div class="inline-alert ${d.level === 'red' ? 'red':''} spaced-top">${risks.map(x=>escapeHTML(x.text)).join('<br />')}</div>`:''}<p class="note">${d.evidenceCounts.confirmed} 条确认记录 · ${d.evidenceCounts.estimates} 条估计 · ${d.evidenceCounts.unknown} 个未知。</p></div>`;
}

function nextStageButton(state) {
  if (state === 'GUANGDONG_READY' || state === 'SHANGHAI_BRIDGE_READY') return `<button class="btn btn-secondary" type="button" data-view="feedback" data-tab="resign">检查离职条件</button>`;
  if (state === 'NOTICE_AND_HANDOVER') return `<button class="btn btn-secondary" type="button" data-action="started">我已入职</button>`;
  if (state === 'GUANGDONG_MIGRATION') return `<button class="btn btn-secondary" type="button" data-action="moved">搬家已完成</button>`;
  if (state === 'GUANGDONG_SETTLING') return `<button class="btn btn-secondary" type="button" data-action="settled">工作和生活已稳定下来</button>`;
  return '';
}
function renderTimelineRail() {
  const items = checkpoints();
  const pending = items.filter(item => !checkpointCompletion(data, item.id));
  const completed = items.filter(item => checkpointCompletion(data, item.id)).at(-1);
  const selected = [...(completed ? [completed] : []), ...pending.slice(0, completed ? 3 : 4)]
    .filter((item, index, arr) => arr.findIndex(x => x.id === item.id) === index);
  if (!selected.length) return '<p>所有计划节点已完成。可在“重要日期”中查看实际完成日期。</p>';
  const next = pending[0];
  return `<div class="timeline-rail" aria-label="近期关键节点">${selected.map(item => {
    const { completedAt, state } = checkpointState(item);
    const status = completedAt ? `✓ 已完成 · ${shortDate(completedAt)}${completedAt < item.date ? '（提前）' : ''}` :
      state === 'past' ? '日期已过 · 待确认' : '待完成';
    return `<div class="timeline-node ${item.id === next?.id ? 'is-current' : ''} ${completedAt ? 'is-complete' : ''}" aria-label="${escapeHTML(item.label+'，'+status)}">
      <b>${escapeHTML(shortDate(item.date))}</b><span>${escapeHTML(item.label)}</span><small>${escapeHTML(status)}</small>
    </div>`;
  }).join('')}</div>`;
}

function financeFreshnessText() {
  const snapshot=financeSnapshot(data,todayISO());
  const labels={fresh:'近期已更新',aging:'超过7天未核对',stale:'超过30天未核对',unknown:'尚无更新日期',future:'数据日期需核查'};
  return `${snapshot.date ? dateLabel(snapshot.date):'日期未知'} · ${labels[snapshot.status]}${snapshot.age!=null&&snapshot.age>=0 ? '（'+snapshot.age+'天前）':''} · ${CASH_CERTAINTIES[snapshot.certainty]||'确定程度未知'}`;
}
function renderCashflowPreview() {
  const projection=projectCashflow(data,todayISO());
  if(!projection.available)return section('未来资金情况',
    `<p class="cash-muted">30/60/90天预测资料不完整：${escapeHTML(projection.missing.join('、'))}。未知金额不会自动按0元计算。</p><button class="text-link" type="button" data-view="cashflow">补齐资金计划</button>`);
  const first=projection.periods[0];
  const risk=first.firstDeficit ? `按谨慎口径，预计${dateLabel(first.firstDeficit)}前后可能出现缺口` : '未来30天未发现模型内的现金负数';
  return section('未来资金情况',`<div class="cash-preview"><div><strong>${escapeHTML(risk)}</strong><p>30天谨慎最低余额：${money(first.cautiousLowest)}。这是按已录入数据估算，不是银行还款日承诺。</p></div><button class="btn btn-secondary" type="button" data-view="cashflow">查看30/60/90天预测和事件</button></div>
  <p class="note">财务数据：${escapeHTML(financeFreshnessText())}。<span class="muted">尚未确认的奖金不计入谨慎余额。</span></p>`);
}
function renderCashflow() {
  const today=todayISO(), b=data.baseline, projection=projectCashflow(data,today), cfg=data.cashflowSettings ?? {};
  const cards=projection.available ? `<div class="forecast-grid">${projection.periods.map(p=>`<article class="forecast-card ${p.status==='shortfall' ? 'shortfall':''}">
    <h3>未来${p.days}天</h3>
    <strong>${money(p.cautiousEnd)}</strong>
    <p>谨慎期末余额</p>
    <dl><div><dt>期间最低</dt><dd>${money(p.cautiousLowest)}</dd></div>
      <div><dt>最多需补现金</dt><dd>${money(p.gap)}</dd></div>
      <div><dt>首次缺口</dt><dd>${p.firstDeficit ? escapeHTML(shortDate(p.firstDeficit)):'未发现'}</dd></div>
      <div><dt>计入估计收入后</dt><dd>${money(p.scenarioEnd)}</dd></div></dl>
  </article>`).join('')}</div>`:
    `<div class="inline-alert">目前缺少${escapeHTML(projection.missing.join('、'))}，不能生成金额预测。先在“更新近况”补充缺失数字。</div>`;
  const warn=projection.issues.length ? `<details class="cash-issues" open><summary>本次预测需要留意的 ${projection.issues.length} 项</summary><ul class="plain-list">${projection.issues.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul></details>` : '';
  const eventRows=projection.events.map(e=>`<tr><td><strong>${escapeHTML(e.label)}</strong><small>${escapeHTML(CASH_EVENT_TYPES[e.kind]||'其他')} ${e.virtual?'· 来自岗位记录':''}</small></td>
    <td>${escapeHTML(dateLabel(e.date))}</td>
    <td class="num">${e.direction==='milestone'?'只提醒':(e.direction==='in'?'+':'−')+money(e.amount)}</td>
    <td>${escapeHTML(CASH_CERTAINTIES[e.certainty]||'未知')}<small>${escapeHTML(CASH_IMPACTS[e.impact]||'只提醒')}</small></td>
    <td>${e.virtual?'在“岗位比较”中修改':`<button class="text-link" type="button" data-action="edit-cash-event" data-id="${escapeHTML(e.originId)}">编辑</button>`}</td></tr>`).join('');
  const savedEvents=(data.cashEvents ?? []).map(e=>`<li><span>${escapeHTML(e.label)} · ${escapeHTML(dateLabel(e.date))}${e.recurrenceMonths ? ' · 每'+e.recurrenceMonths+'个月':''}${e.completedAt?' · 已完成':''}</span>
      <span><button class="text-link" type="button" data-action="edit-cash-event" data-id="${escapeHTML(e.id)}">修改</button>
      ${!e.recurrenceMonths&&!e.completedAt ? `<button class="text-link" type="button" data-action="finish-cash-event" data-id="${escapeHTML(e.id)}">已支付 / 完成</button>`:''}
      <button class="text-link error-note" type="button" data-action="delete-cash-event" data-id="${escapeHTML(e.id)}">删除</button></span></li>`).join('');
  const e=(data.cashEvents ?? []).find(x=>x.id===editingCashEventId)||{};
  const eventForm=`<form id="cash-event-form"><input type="hidden" name="id" value="${escapeHTML(e.id||'')}"/>
    ${formSection(editingCashEventId?'修改资金事件':'新增一笔资金事件',
      select('kind','事件类型',e.kind??'insurance',Object.entries(CASH_EVENT_TYPES),{required:true})+
      input('label','事项名称',e.label,{required:true,placeholder:'例如季度房租、续保、奖金'})+
      input('date','预计发生日期',e.date,{type:'date',required:true})+
      select('direction','对现金的影响',e.direction??'out',[['out','支出'],['in','收入'],['milestone','只提醒，不计算金额']],{required:true})+
      input('amount','金额（未知可留空）',e.amount,{type:'number',min:0,step:'.01',help:'金额尚不确定可留空，系统会提示预测不完整。'})+
      certaintySelect('certainty','金额或日期有多确定？',e.certainty??'rough')+
      select('impact','如何计入预算',e.impact??'extra',Object.entries(CASH_IMPACTS),{required:true,help:'如果房租已经算在基本生活费里，选择“包含在日常生活预算中”，并填写真实重复周期。'})+
      select('recurrenceMonths','多久发生一次',String(e.recurrenceMonths??0),[['0','仅一次'],['1','每月'],['3','每3个月'],['6','每6个月'],['12','每12个月']],{required:true})+
      input('endDate','重复到哪一天（可空）',e.endDate,{type:'date'})+
      textarea('note','备注、资金来源或待确认事项',e.note,{placeholder:'例如奖金预计在房租前发放，但税后金额仍需确认。'}))}
    ${formActions(editingCashEventId?'保存资金事件修改':'保存资金事件')}
    ${editingCashEventId?'<button class="text-link" type="button" data-action="cancel-cash-edit">取消修改</button>':''}
  </form>`;
  const settings=`<form id="cashflow-settings-form">${formSection('现金流计算方式',
    select('salaryPayDay','现有工作的每月发薪日',cfg.salaryPayDay??'',
      Array.from({length:31},(_,i)=>[String(i+1),'每月'+(i+1)+'日']),{help:'未知可空；未知时工资按日均摊，无法反映发薪日前的真实紧张程度。'})+
    input('incomePauseStart','预计开始没有工资的日期（可空）',cfg.incomePauseStart,{type:'date'})+
    input('incomePauseEnd','预计恢复正常工资的日期（可空）',cfg.incomePauseEnd,{type:'date',help:'仅在收入空档已能合理估计时填写；新工资数额变了仍需更新月到手。'}))}
    ${formActions('保存计算设置')}</form>`;
  return pageHeader('资金计划','用已知事实管理未来30、60、90天')+
    section('资金安全边界',`<p class="section-lead">现金余额来自你最后一次保存的记录：${money(b.cashBalance)}。<strong>${escapeHTML(financeFreshnessText())}</strong>。</p>
      ${cards}${warn}<p class="note">模型默认工资持续、月供和生活费按日均摊。还款日逐笔分散时，真实余额可能比预测更早不足；不能据此承诺一定不会逾期。已出账 / 已支付金额应及时更新可用现金。</p>
      <button class="text-link" type="button" data-view="feedback" data-tab="finance">更新现金、工资和月供</button>`)+
    section('即将发生的资金事件',`<p class="section-lead">车险、季度房租、奖金、搬迁和入职首薪可逐项记账。Offer和首薪日期默认只作提醒，不自动当作已经到账的收入。</p>
      ${eventRows ? `<div class="offer-table-wrap"><table class="offer-table cash-table"><thead><tr><th>事项</th><th>日期</th><th>金额</th><th>依据</th><th>修改</th></tr></thead><tbody>${eventRows}</tbody></table></div>` : '<p class="empty">未来90天还没有已录入的资金事件。</p>'}
      ${savedEvents ? `<details><summary>管理手动记录的事项（包含90天以外）</summary><ul class="cash-manage-list">${savedEvents}</ul></details>`:''}
      ${eventForm}`)+
    section('工资与收入空档',settings)+
    section('计算依据',`<ol class="plain-list">${(projection.assumptions??[]).map(a=>`<li>${escapeHTML(a)}</li>`).join('')}</ol>
      <p class="note">“谨慎余额”排除未确认的额外收入；“计入估计收入后”只是情景推演，不代表奖金或新工资已经到账。</p>`);
}

function renderFinanceSummary() {
  const b=data.baseline, f=financialCapacity(data);
  return `<p class="note">最近财务数据：${escapeHTML(financeFreshnessText())}。建议核对是否已经发生新的还款、奖金或车险支出。</p><dl class="metric-list"><div><dt>月到手</dt><dd>${money(b.monthlyNetIncome)}</dd></div><div><dt>月供 + 基本生活</dt><dd>${money(f.required)}</dd></div><div><dt>每月剩余</dt><dd class="${f.monthlyBalance < 0 ? 'negative':''}">${money(f.monthlyBalance)}</dd></div><div><dt>如果一个月没工资</dt><dd>${{UNKNOWN:'信息不足',COVERED:'可覆盖',TIGHT:'紧张',UNAFFORDABLE:'无法覆盖'}[f.stress]}</dd></div></dl><p class="note">扣除已知大额支出后检查必要开支承受能力，这只能帮助你看备用现金够不够，提离职前还要确认岗位和交接条件。</p>`;
}

function renderFeedback() {
  if (!feedbackTab && !validateBaseline(data).valid) feedbackTab = 'baseline';
  const bodies = { light: renderLightForm, major: renderMajorForm, baseline: renderBaselineForm, market: renderMarketForm, finance: renderFinanceForm, relationship: renderRelationshipForm, resign: renderResignForm, offer: ()=>renderOfferForm(data.offers.find(o=>o.id === editingOfferId) || {}), progress: ()=>section('记录已经完成的事情',nextStageButton(data.routeState) || '<p>目前还在找工作。收到并接受录用通知后，可以先在这里选择“我准备提离职”。</p>') };
  return pageHeader('更新近况', '选这次发生的事，只填相关内容') + section('这次想更新什么？',select('update-topic','选择要更新的内容',feedbackTab,FEEDBACK_TABS.map(key=>[key,TAB_LABELS[key]]),{full:true}) + (validateBaseline(data).valid ? '<button class="text-link" type="button" data-action="no-change">最近没有变化，记录一下就好</button>':'')) + (bodies[feedbackTab] ? bodies[feedbackTab]() : '<p class="form-intro">例如投了简历、收到招聘消息、收入变了，选择对应内容就可以开始填写。</p>');
}
function renderBaselineForm() {
  const b=data.baseline,c=data.config,p=data.partnerPlan;
  const syncFields=['financial','career','energy','relationship'].map(syncConfirmation).join('');
  return `<p class="form-intro">只填今天能确认的信息。未知可以留空；通知期、未来搬迁和对方精确日期不阻止开始使用。</p><form id="baseline-form">
  ${formSection('1. 当前收入和负债',
    ['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost'].map((key,i)=>input(key,['全部负债余额','可用现金','月到手收入','每月还贷金额','基本生活支出'][i],b[key],{type:'number',min:0,step:'.01',help:'不知道可留空，不会被当作 0。'})).join('')+
    input('oneOffCostsNext90Days','尚未分配日期的大额支出汇总',b.oneOffCostsNext90Days,{type:'number',min:0,step:'.01',help:'仅用作未排期提醒，不参与逐日预测。实际支出要在“资金计划”里录入日期，避免重复计算。'})+
    input('financeAsOfDate','现金和债务数字实际对应哪一天？',b.financeAsOfDate ?? todayISO(),{type:'date',required:true,help:'此日期用于判断数据是否过期，不应自动填未来日期。'})+
    certaintySelect('financeCertainty','以上这些数字有多确定？',b.certainty ?? 'unknown'))}
  <details><summary>补充工作、女朋友安排和奖金（可以以后再填）</summary>
  ${formSection('2. 工作成长情况',input('targetRoles','长期目标岗位',data.profile.targetRoles.join('、'),{full:true,help:'允许尚未确定。'})+careerFields(b.careerFacts,true)+textarea('careerEvidence','过去三个月的成长依据',b.careerEvidence,{help:'新技能、真实职责、到别的公司也用得上的成果；可以暂时未知。'})+careerOutput(b.careerFacts))}
  ${formSection('3. 最近两周体验',energyFields(b.energyFacts),'工作体验只用于提醒你复查职业路线，不会单独决定是否离职。')}
  ${formSection('4. 可稍后补充的边界',
    select('sharedDestinationAligned','你和女朋友是否都想去广东？',String(p.sharedDestinationAligned ?? ''),[['true','一致'],['false','暂不一致'],['unknown','尚未确认']])+
    input('nextRelationshipReviewAt','哪天再和女朋友商量？',p.nextRelationshipReviewAt,{type:'date'})+
    input('gdMinNetIncome','个人广东收入底线（可选）',c.gdMinNetIncome,{type:'number',min:0,step:'.01'})+
    input('contractNoticeDays','合同要求提前多少天提离职？',b.contractNoticeDays,{type:'number',min:0,max:365,step:1})+
    input('bonusAmount','已知奖金金额',b.bonusAmount,{type:'number',min:0,step:'.01'})+input('bonusPayDate','奖金预计到账日',b.bonusPayDate,{type:'date'}))}</details>
  ${syncFields ? formSection('确认之前记录的变化',syncFields,'确认之前记录的变化都已填到这次表格里，再勾选下面的选项。') : ''}
  ${formActions('保存基本资料')}</form>`;
}

function renderMarketForm() {
  return `<p class="form-intro">只记录上次保存后新增的简历和面试次数，已经记过的不用再填。</p><form id="market-form">
  ${formSection('上次记录后，新投了多少简历？面试了几次？',['gdApplications','shApplications','gdInterviews','shInterviews','gdFinals','shFinals'].map((key,i)=>input(key,['投了几份广东简历','投了几份上海简历','参加了几次广东面试','参加了几次上海面试','完成了几次广东终面','完成了几次上海终面'][i],0,{type:'number',min:0,step:1})).join(''))}
  <details><summary>这段时间没投简历？记录原因（可选）</summary>${formSection('暂停投简历的原因',
    select('searchPauseReason','暂停原因','',[['planned','主动暂停'],['work','工作周期 / 重保'],['health','健康原因'],['waiting','等待面试结果'],['no_roles','暂无合适岗位'],['motivation','失去动力'],['other','其他']])+
    input('pauseReviewAt','何时复查暂停原因',null,{type:'date'})+
    textarea('pauseNote','原因或等待中的事项','')+
    textarea('marketFeedback','招聘或面试带来的新消息','')+
    textarea('waitReason','新的“再等等”理由','')+
    input('nextAction','接下来准备做什么？','',{full:true}))}</details>
  ${formActions('保存投简历和面试进展')}</form>`;
}

function renderFinanceForm() {
  const b = data.baseline || {};
  return `<p class="form-intro">填最新数字，看看工资是否够还贷和生活。没变化的数字可以保留。</p><form id="finance-form">
    ${formSection('本月实际收入和负债',
      input('debtBalance','最新全部负债余额',b.debtBalance,{type:'number',min:0,step:'.01',required:false})+
      input('cashBalance','最新可用现金',b.cashBalance,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyNetIncome','本月到手收入',b.monthlyNetIncome,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyDebtPayment','本月贷款月供',b.monthlyDebtPayment,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyLivingCost','本月基本生活支出',b.monthlyLivingCost,{type:'number',min:0,step:'.01',required:false})+
      input('oneOffCostsNext90Days','仍未分配日期的大额支出汇总',b.oneOffCostsNext90Days,{type:'number',min:0,step:'.01',help:'只显示提醒，不参与现金流时间轴；已在资金事件中录入的不要重复当作额外支出。'})+
      input('financeAsOfDate','现金余额与月供实际对应的日期',b.financeAsOfDate??todayISO(),{type:'date',required:true})+
      certaintySelect('financeCertainty','以上数据有多确定？',b.certainty??'unknown')+
      input('plannedCashBalance','原计划本月可用现金',null,{type:'number',min:0,step:'.01',help:'可留空；填写后系统检查实际偏差。'})+
      input('plannedDebtBalance','原计划本月负债余额',null,{type:'number',min:0,step:'.01',help:'可留空；填写后系统检查实际偏差。'})+
      textarea('financeNote','变化原因或备注','',{placeholder:'例如月供下降、房租、搬迁费用。'})+syncConfirmation('financial'))}
    ${formActions('保存收入和负债')}</form>`;
}
function renderRelationshipForm() {
  const p=data.partnerPlan,c=data.config;
  return `<p class="form-intro">记录你和女朋友想去哪里、大概何时搬家。时间没定下来可以留空，再约个日期一起商量。</p><form id="relationship-form">
  ${formSection('你和女朋友的安排',
    select('sharedDestinationAligned','你和女朋友是否想去同一个地方？',String(p.sharedDestinationAligned ?? ''),[['true','一致'],['false','暂不一致'],['unknown','未知']])+
    select('moveTimeType','女朋友大概什么时候搬家？',p.moveTimeType,[['exact_date','明确日期'],['month','大致月份'],['date_range','大致时间，例如春节后'],['unknown','目前未知']])+
    input('moveTimeValue','填下预计的时间',p.moveTimeValue,{full:true,placeholder:'2027-03-15 / 2027-03 / 2–4 月 / 春节后'})+
    certaintySelect('certainty','这些安排有多确定？',p.certainty)+
    input('nextRelationshipReviewAt','哪天再和女朋友商量？',p.nextRelationshipReviewAt,{type:'date'})+
    input('maxLongDistanceDays','最多能接受多少天异地？',c.maxLongDistanceDays,{type:'number',min:0,max:730,step:1})+
    input('longDistanceStartDate','异地开始日（如已知）',p.longDistanceStartDate,{type:'date'})+
    input('reunionDate','预计哪天结束异地？（不知道可留空）',p.reunionDate,{type:'date'})+
    input('travelPlan','往返安排',p.travelPlan,{full:true})+
    input('reunionNextAction','接下来一起做什么？',p.reunionNextAction,{full:true})+syncConfirmation('relationship'))}
  ${formActions('保存关系变化')}</form>`;
}

function renderResignForm() {
  const accepted = data.offers.filter(offer => offer.status === 'accepted');
  const selectedId = data.routeDecision?.offerId || accepted[0]?.id || '';
  const b = data.baseline || {};
  const needsReview=evaluate(data,todayISO()).requiresRedecision;
  return `<p class="form-intro">先确认书面录用通知、工资和岗位、交接时间，以及没工资期间的生活费和月供。</p>${needsReview ? '<div class="inline-alert">已选去向的依据需要重新核实。请先在上方选择“我想决定接下来去哪里”，确认原来的选择是否还合适。</div>' : ''}${accepted.length ? '' : '<div class="inline-alert">目前还没有已接受的书面录用通知。收到并接受后，再检查离职条件。</div>'}<form id="resign-form">
    ${formSection('录用通知和交接时间',
      select('offerId','已接受的录用通知',selectedId,accepted.map(offer=>[offer.id,`${offer.company || '未命名公司'} · ${offer.city} · ${offer.role || '岗位待确认'}`]),{required:true})+
      input('contractNoticeDays','合同要求提前多少天提离职？',b.contractNoticeDays,{type:'number',min:0,max:365,step:1,required:true})+
      input('availableHandoverDays','新公司允许的交接天数',b.availableHandoverDays,{type:'number',min:0,max:365,step:1,required:true})+
      input('preferredHandoverDays','你愿意提供的交接天数',b.preferredHandoverDays,{type:'number',min:0,max:365,step:1,required:true})+
      select('termsConfirmed','薪资、岗位、地点、入职日和试用期条件已核实','',[['true','已确认'],['false','尚未确认']],{required:true})+
      select('pendingConditionsClear','背调、审批等还有没有问题？','',[['true','已确认'],['false','尚未确认']],{required:true})+
      input('transitionIncomeGapMonths','预计有几个月没有工资？',null,{type:'number',min:0,max:12,step:'.5',required:true,help:'明确没有空档填 0；未知不能填 0。'})+
      input('handoverCompletion','必要交接资料完成比例（%）',b.handoverCompletion,{type:'number',min:0,max:100,step:1})+
      textarea('handoverNote','待交接关键事项','',{placeholder:'资产与权限、在途事项、流程、联系人、已知风险。'}),
      '合同通知期是下限。如果新公司允许的天数不足，应先协商日期，系统不会建议违反通知期。')}
    ${formActions('检查是否可以提离职')}</form>${data.intent === 'resign' ? '<button class="text-link" type="button" data-action="withdraw-resign">暂时不提离职</button>' : ''}`;
}

function renderOffers() {
  const b = data.baseline || {};
  const baseNet = [b.monthlyNetIncome,b.monthlyLivingCost,b.monthlyDebtPayment].every(x=>x!=null) ? Number(b.monthlyNetIncome)-Number(b.monthlyLivingCost)-Number(b.monthlyDebtPayment) : null;
  const offers = data.offers || [];
  const rows = offers.map(offer => {
    const result = offer.city === '上海' ? qualifyShanghaiOffer(offer,data,todayISO()) : qualifyGuangdongOffer(offer,data,todayISO());
    const gain = result.sixMonthNetGain;
    return `<tr><td><strong>${escapeHTML(offer.company || '未命名公司')}</strong><small>${escapeHTML(offer.city)} · ${escapeHTML(offer.role || '岗位待补')}</small></td><td>${escapeHTML({none:'尚无录用通知',verbal:'口头',written:'书面',accepted:'已接受'}[offer.status] || offer.status)}</td><td class="num">${money(offer.monthlyNetIncome)}</td><td class="num">${money(offer.monthlyLivingCost)}</td><td class="num">${gain == null ? '待计算' : money(gain)}</td><td>${escapeHTML(result.careerScore ?? '未知')}${result.careerScore == null ? '':'/5'}<small>${escapeHTML({IMPROVED:'每月能多剩些钱',SIMILAR:'每月剩的钱差不多',WORSE:'每月剩的钱变少了',UNKNOWN:'收入和开支还不清楚'}[result.trend])}</small></td><td><span class="${result.qualified ? 'qualify' : 'not-qualify'}">${result.qualified ? '值得考虑' : '需核实'}</span><small>${escapeHTML([...(result.reasons || []),...(result.warnings || [])].slice(0,2).map(reason => typeof reason === 'string' ? reason : reason.text).join('；'))}</small></td><td><button class="text-link" type="button" data-action="edit-offer" data-id="${escapeHTML(offer.id)}">编辑</button><br /><button class="text-link error-note" type="button" data-action="delete-offer" data-id="${escapeHTML(offer.id)}">删除</button></td></tr>`;
  }).join('');
  const table = `<div class="offer-table-wrap"><table class="offer-table"><thead><tr><th>公司 / 岗位</th><th>状态</th><th>月到手</th><th>当地月生活费</th><th>半年比现在多剩的钱</th><th>成长</th><th>是否值得考虑</th><th>操作</th></tr></thead><tbody><tr><td><strong>当前岗位</strong><small>维持收入并继续寻找</small></td><td>在职</td><td class="num">${money(b.monthlyNetIncome)}</td><td class="num">${money(b.monthlyLivingCost)}</td><td class="num">基准</td><td>${escapeHTML(b.currentRoleGrowth ?? '—')}/5</td><td>${baseNet == null ? '待补基本资料' : `每月剩余 ${money(baseNet)}`}</td><td></td></tr>${rows}</tbody></table></div>`;
  return pageHeader('岗位比较', '先比较岗位和工资，再优化奖金和日期') +
    '<button class="btn btn-primary" type="button" data-action="new-offer">更新近况：新增岗位</button>' +
    section('现在的工作和新岗位', table, '比较工资、开支和能学到什么。口头消息也能先记录；提离职前需要接受书面录用通知。');
}
function renderOfferForm(o) {
  const c = data.config || {}, d = data.routeDecision || {};
  const cityItems = [['广州','广州'],['深圳','深圳'],['广东其他','广东其他'],['上海','上海']];
  const pendingOffer=syncConfirmation('offer');
  return `<form id="offer-form"><input type="hidden" name="id" value="${escapeHTML(o.id || '')}" />
    ${formSection('岗位与条件',
      input('company','公司名称',o.company,{required:true})+
      select('city','城市',o.city,cityItems,{required:true})+
      input('role','岗位名称',o.role,{required:true})+
      select('workMode','在哪里工作？',o.workMode,[['onsite','公司办公'],['hybrid','公司和家里都可以'],['remote','远程']],{required:true})+
      select('status','招聘进展',o.status,[['none','尚无正式结果'],['verbal','口头录用消息'],['written','书面录用通知'],['accepted','已接受书面录用通知']],{required:true})+
      input('grossIncome','月税前收入',o.grossIncome,{type:'number',min:0,step:'.01'})+
      input('monthlyNetIncome','预计月到手',o.monthlyNetIncome,{type:'number',min:0,step:'.01'})+
      input('monthlyLivingCost','当地预计月生活费',o.monthlyLivingCost,{type:'number',min:0,step:'.01',help:'含租住、通勤与基本生活。请按城市重新估算。'})+
      input('bonusGuaranteed','已确定奖金',o.bonusGuaranteed,{type:'number',min:0,step:'.01',help:'不确定的奖金不要计入月收入。'})+
      certaintySelect('certainty','岗位与待遇信息有多确定？',o.certainty ?? 'rough'))}
    <details><summary>补充试用期和搬家费用（知道后再填）</summary>
    ${formSection('试用期和换工作要花的钱',
      input('probationRate','试用期工资比例（%）',o.probationRate,{type:'number',min:0,max:100,step:1})+
      input('probationMonths','试用期月数',o.probationMonths,{type:'number',min:0,max:6,step:1,help:'没有试用期填 0；有试用期请填实际月数。'})+
      input('probationNetIncome','试用期预计月到手',o.probationNetIncome,{type:'number',min:0,step:'.01',help:'若已知，优先填实际预计到手。'})+
      input('monthlyCommuteCost','月通勤费用',o.monthlyCommuteCost,{type:'number',min:0,step:'.01'})+
      select('relocationState','搬家费用是否知道了？',o.relocationState ?? (o.relocationCost == null ? 'unknown':'knownAmount'),costChoices)+
      input('relocationCost','搬家需要多少钱？',o.relocationCost,{type:'number',min:0,step:'.01',help:'仅选择“金额已知”时计入计算；其他档位不换算成金额。'})+
      select('switchingState','其他换工作费用是否知道了？',o.switchingState ?? (o.switchingCost == null ? 'unknown':'knownAmount'),costChoices)+
      input('switchingCost','其他换工作费用是多少钱？',o.switchingCost,{type:'number',min:0,step:'.01'})+
      '')}</details>
    ${formSection('这份工作能学到什么？什么时候入职？',
      careerFields(o.careerFacts)+careerOutput(o.careerFacts)+
      textarea('growthReason','岗位材料与成长依据',o.growthReason,{placeholder:'可以粘贴招聘说明，记录职责、用到的技术、能做出的成果。',help:'按你确认的五项情况计算分数。岗位文字和截图目前只作为参考资料。'})+
      input('startDate','预计入职日',o.startDate,{type:'date'})+
      input('responseDueDate','最晚答复日',o.responseDueDate,{type:'date'})+
      input('firstPayDate','预计第一笔工资到账日',o.firstPayDate,{type:'date',help:'这里只记录日期，不自动把新岗位工资算成已到账现金。'})+
      select('canDelayStart','能否延后入职',String(o.canDelayStart ?? ''),[['true','可以协商'],['false','不能']],{})+
      textarea('risks','主要风险',o.risks,{placeholder:'例如试用期、业务稳定性、工作强度。'})+
      select('reversibility','若不合适，离开这份工作要付出的代价',o.reversibility,[['low','低'],['medium','中'],['high','高']],{}))}
    <div data-shanghai-plan ${o.city === '上海' ? '':'hidden'}>${formSection('上海过渡期限',
      input('bridgeExitDate','最晚哪天重新决定是否留上海？',o.bridgeExitDate || d.bridgeExitDate,{type:'date',help:'请选入职后六个月内的日期，看看是否继续留上海。'})+
      input('gdSearchRestartDate','哪天重新投广东岗位？',o.gdSearchRestartDate || d.gdSearchRestartDate,{type:'date',help:'至少提前 60 天开始投广东岗位，给找工作留时间。'}),
      '先在上海过渡时，需要约定重新投广东岗位和再次决定去向的日期。')}</div>
    ${pendingOffer ? formSection('确认之前记录的岗位变化',pendingOffer,'请核对机会列表中的全部相关变化，不只核对当前岗位。') : ''}
    ${formActions(editingOfferId ? '保存修改并更新结果' : '保存机会并更新结果')}
    ${editingOfferId ? '<button type="button" class="text-link" data-action="cancel-edit">取消编辑</button>' : ''}</form>`;
}

function renderTimeline() {
  const items = checkpoints(), today = todayISO();
  const list = `<ol class="full-timeline">${items.map(item => {
    const { completedAt, state } = checkpointState(item);
    const status = completedAt ? `✓ 已完成 · ${dateLabel(completedAt)}${completedAt < item.date ? '（提前完成）' : ''}` :
      state === 'past' ? '计划日期已过，尚未确认完成' : state === 'today' ? '今天计划完成' : '待完成';
    return `<li class="${completedAt ? 'is-complete' : ''}">
      <time datetime="${escapeHTML(item.date)}">${escapeHTML(shortDate(item.date))}</time>
      <div><b>${escapeHTML(item.label)} · ${item.type === 'major' ? '重新考虑去向':'记录近况'}</b>
        <p>${escapeHTML(item.description || '')}</p><p class="checkpoint-status ${completedAt ? 'complete' : state}">${escapeHTML(status)}</p></div>
      <div class="checkpoint-controls">
        <label for="done_${item.id}">实际完成日期</label>
        <input id="done_${item.id}" name="completed_${item.id}" type="date" value="${escapeHTML(completedAt || today)}" max="${escapeHTML(today)}" aria-label="${escapeHTML(item.label)}的实际完成日期"/>
        <button type="button" class="btn btn-secondary" data-action="complete-checkpoint" data-id="${escapeHTML(item.id)}">${completedAt ? '修改日期' : '标记完成'}</button>
        ${completedAt ? `<button type="button" class="text-link" data-action="reopen-checkpoint" data-id="${escapeHTML(item.id)}">撤销完成</button>` : ''}
      </div></li>`;
  }).join('')}</ol>`;
  const bridge = data.routeDecision?.bridgeExitDate ? `<div class="inline-alert spaced-top">你的上海过渡计划：${escapeHTML(dateLabel(data.routeDecision.gdSearchRestartDate))} 重新投广东岗位；${escapeHTML(dateLabel(data.routeDecision.bridgeExitDate))} 做强制重新决定下一步。实际入职后的六个月上限仍需单独检查。</div>` : '';
  const moneyEvents=expandCashEvents(data,today,90).slice(0,8);
  const moneySchedule=moneyEvents.length ? moneyEvents.map(e=>`<li><time datetime="${escapeHTML(e.date)}">${escapeHTML(shortDate(e.date))}</time>
     <span>${escapeHTML(e.label)} · ${escapeHTML(CASH_CERTAINTIES[e.certainty]||'未知')}${e.direction==='milestone'?' · 仅提醒':` · ${e.direction==='in'?'+':'−'}${money(e.amount)}`}</span></li>`).join('') :
     '<li>还没有录入未来90天的资金事件。</li>';
  return pageHeader('重要日期', '关键节点提醒') + section('2026 年 9 月 — 2027 年 6 月', `<div class="btn-row calendar-actions"><button type="button" class="btn btn-primary" data-action="export-calendar">下载提醒，导入手机日历</button></div>
  <p class="note">对已经完成的事项填写实际日期（允许提前完成），点击“标记完成”。系统会保存对勾和日期，刷新后仍有效；仅到日期不会自动算作完成。</p>
  ${list}${bridge}<p class="note">重新下载的日历会排除已完成节点；此前导入的日历事件不会自动删除。个人数据只保存在当前浏览器。</p>`) +
    section('未来90天资金事件',`<ul class="cash-date-list">${moneySchedule}</ul>
      <button class="text-link" type="button" data-view="cashflow">查看金额、确定程度和资金预测</button>`);
}
function renderHistory() {
  const formal=[...data.decisions].reverse(),history=[...data.decisionHistory].reverse();
  const decisions=formal.map(d=>`<article class="history-entry"><time>${dateLabel(d.decidedAt)}</time><div><h2>${escapeHTML(STATE_LABELS[d.routeState])}</h2><ul class="plain-list">${d.decisionPremises.map(p=>`<li>${escapeHTML(p.text)}</li>`).join('')}</ul><p>下次重新考虑去向：${dateLabel(d.nextMajorReviewAt)}</p>${d.manualOverride ? `<p class="warning-note">我这样选的理由：${escapeHTML(d.manualOverride.reason)}；${dateLabel(d.manualOverride.nextReviewAt)} 复查。</p>`:''}<details><summary>看看当时的收入、负债和岗位</summary><pre class="snapshot">${escapeHTML(`当时可用现金：${money(d.recordedBaseline?.cashBalance)}\n当时负债：${money(d.recordedBaseline?.debtBalance)}\n月到手收入：${money(d.recordedBaseline?.monthlyNetIncome)}\n当时岗位：${(d.recordedOffers ?? []).map(o=>o.company+' · '+o.city).join('；') || '没有记录'}\n系统建议：${STATE_LABELS[d.systemSuggestion] || '没有记录'}\n待确认：${(d.unknowns ?? []).join('；') || '没有记录'}`)}</pre></details></div></article>`).join('');
  const logs=history.map(d=>`<article class="history-entry"><time>${escapeHTML((d.at || '').replace('T',' ').slice(0,16))}<br />${escapeHTML(d.source)}</time><div><h2>${escapeHTML(STATE_LABELS[d.routeState ?? d.state] ?? d.state)} · ${escapeHTML({GREEN:'目前没有发现明显风险',YELLOW:'有需要注意的事',RED:'需要重新考虑',BLOCKED:'暂时不能提离职',green:'目前没有发现明显风险',yellow:'有需要注意的事',red:'需要重新考虑'}[d.riskState ?? d.level] ?? '查看当时的提醒')}</h2><p>${escapeHTML(d.reasons?.map(r=>r.text ?? r).join('；'))}</p><p>${escapeHTML([...(d.blockers ?? []),...(d.warnings ?? [])].map(r=>r.text).join('；'))}</p></div></article>`).join('');
  return pageHeader('我的记录','回看你当时的选择、理由和情况')+section('我保存的选择',decisions || '<p class="empty">还没有保存过自己的选择。可以在“更新近况”里选择“我想决定接下来去哪里”。</p>')+section('检查与系统判定记录',logs || '<p class="empty">尚无检查记录。</p>');
}

function renderSettings() {
  const c=data.config,entries=checkpoints().map(cp=>input('cp_'+cp.id,cp.label,cp.date,{type:'date',required:true,help:cp.type === 'major' ? '重新考虑去向':'记录近况'})).join('');
  return pageHeader('设置与数据','这里可以调整收入要求和提醒日期')+
  section('判断标准',`<form id="settings-form"><div class="form-grid">
  ${input('gdMinNetIncome','个人广东收入底线（可未知）',c.gdMinNetIncome,{type:'number',min:0,step:'.01'})}
  ${input('gdMinCareerScore','广东成长分数要求（1–5）',c.gdMinCareerScore,{type:'number',min:1,max:5,step:'.1',required:true})}
  ${input('bridgeMinSixMonthGain','上海半年比现在多剩的钱参考线',c.bridgeMinSixMonthGain,{type:'number',min:0,step:1,required:true,help:'不是绝对门槛；工作能明显学到更多，也可以考虑上海过渡。'})}
  ${input('bridgeMaxMonths','先留在上海多久，再决定去向？（月）',c.bridgeMaxMonths,{type:'number',min:1,max:6,step:1,required:true})}
  ${input('maxLongDistanceDays','最多能接受多少天异地？',c.maxLongDistanceDays,{type:'number',min:0,max:730,step:1})}
  ${input('driftNoActionDays','多久没投简历或面试时提醒我？（天）',c.driftNoActionDays,{type:'number',min:1,max:90,step:1,required:true})}
  ${input('planVarianceWarningRate','现金或负债和原计划相差多少时提醒我？（%）',Math.round(c.planVarianceWarningRate*100),{type:'number',min:1,max:100,step:1,required:true})}
  </div>${formSection('提醒日期',entries)}${formActions('保存设置')}</form>`)+
  section('下载带密码的备份',`<div class="privacy-callout">记录保存在这台设备的浏览器里，不会上传到 GitHub。共用设备的人可能看到记录。关闭浏览器不会丢失，但清理网站数据或换设备后，需要用备份恢复。密码只保护下载的备份，不会给浏览器里的记录加锁；忘记密码就无法恢复备份。</div><form id="backup-form">${formSection('给备份文件设个密码',input('password','密码（至少 12 个字符）','',{type:'password',required:true})+input('passwordConfirm','再输入一次密码','',{type:'password',required:true}))}${formActions('下载带密码的备份')}</form><button class="text-link error-note" type="button" data-action="export-backup">下载不带密码的备份</button>`)+
  section('恢复备份或清空记录',`<div class="form-grid">${input('import-password','备份文件的密码','',{type:'password',full:true})}</div><div class="btn-row"><label class="btn btn-secondary" for="import-file">选择备份文件</label><input id="import-file" class="visually-hidden" type="file" accept=".json,application/json" /><button class="btn btn-danger" type="button" data-action="clear-data">清空本机数据</button></div><p class="note">导入前先备份当前记录。验证、解密或写入失败不会替换原数据；也可以导入以前下载的备份。</p>`);
}

function renderRecovery() {
  if (insecureOrigin) {
    app.innerHTML = pageHeader('需要安全连接') + section('暂时无法填写','<p>当前入口不是安全连接。请使用证书有效的 HTTPS 地址；不要绕过浏览器证书警告。原有存档未读取或改写，本页不提供个人数据录入。</p>');
    return;
  }
  app.innerHTML = pageHeader('需要恢复本地数据') + `<section class="section"><div class="inline-alert red">检测到本地存档无法读取。为了避免覆盖原记录，系统已停止自动保存。你可以导入先前备份，或在确认旧记录无法恢复后重新开始。</div><div class="form-grid">${input('import-password','备份文件的密码','',{type:'password',full:true})}</div><div class="btn-row"><label class="btn btn-primary" for="import-file">导入备份文件</label><input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" /><button class="btn btn-danger" type="button" data-action="clear-data">删除损坏存档并重建</button></div></section>`;
}
function render() {
  currentView = viewFromHash();
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  if (dataError) { renderRecovery(); return; }
  const pages = { home: renderHome, cashflow: renderCashflow, feedback: renderFeedback, offers: renderOffers, timeline: renderTimeline, history: renderHistory, settings: renderSettings };
  app.innerHTML = pages[currentView]();
  document.title = `${{home:'今日判断',cashflow:'资金计划',feedback:'更新近况',offers:'岗位比较',timeline:'重要日期',history:'我的记录',settings:'设置与数据'}[currentView]} · 工作与搬家计划`;
}

function getForm(form) { return Object.fromEntries(new FormData(form)); }
function saveBaseline(form) {
  const v=getForm(form),facts=careerValues(v);
  Object.assign(data.baseline,Object.fromEntries(['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost','contractNoticeDays','bonusAmount'].map(key=>[key,num(v[key])])),{oneOffCostsNext90Days:num(v.oneOffCostsNext90Days) ?? 0,careerFacts:facts,currentRoleGrowth:deriveCareer(facts).score,careerEvidence:v.careerEvidence.trim(),certainty:v.financeCertainty,financeAsOfDate:v.financeAsOfDate,financeUpdatedAt:new Date().toISOString(),energyFacts:Object.fromEntries(['workAvoidance','lowMood','restRecovers','affectsLife','expensiveRecovery'].map(key=>[key,bool(v['energy_'+key])])),bonusPayDate:v.bonusPayDate || null});
  data.config.gdMinNetIncome=num(v.gdMinNetIncome);
  data.partnerPlan.sharedDestinationAligned=bool(v.sharedDestinationAligned);
  data.partnerPlan.nextRelationshipReviewAt=v.nextRelationshipReviewAt || null;
  data.profile.targetRoles=v.targetRoles.split(/[、,，]/).map(x=>x.trim()).filter(Boolean);
  resolvePendingFacts(v,'financial','career','energy','relationship');
  addFact('other','更新首次基本资料；未知内容未补成数值。',v.financeCertainty);
  persistWithDecision('基本资料');showView('home');
}

function saveMarket(form) {
  const v=getForm(form),entry={id:uid(),type:'market',createdAt:new Date().toISOString(),...Object.fromEntries(['gdApplications','shApplications','gdInterviews','shInterviews','gdFinals','shFinals'].map(key=>[key,num(v[key]) ?? 0])),searchPauseReason:v.searchPauseReason || null,pauseReviewAt:v.pauseReviewAt || null,pauseNote:v.pauseNote.trim(),marketFeedback:v.marketFeedback.trim(),waitReason:v.waitReason.trim(),nextAction:v.nextAction.trim()};
  if (Object.values(entry).some((value)=>typeof value === 'number' && value > 0)) entry.searchActionAt=todayISO();
  data.checkIns.push(entry);addFact('career',entry.marketFeedback);
  persistWithDecision('求职动作 / 暂停原因');showView('home');
}

function saveFinance(form) {
  const v = getForm(form);
  const entry = { id:uid(), type:'finance', createdAt:new Date().toISOString(),
    financeAsOfDate:v.financeAsOfDate,certainty:v.financeCertainty,
    debtBalance:num(v.debtBalance),cashBalance:num(v.cashBalance),monthlyNetIncome:num(v.monthlyNetIncome),
    monthlyDebtPayment:num(v.monthlyDebtPayment),monthlyLivingCost:num(v.monthlyLivingCost),
    oneOffCostsNext90Days:num(v.oneOffCostsNext90Days) ?? 0, plannedCashBalance:num(v.plannedCashBalance),
    plannedDebtBalance:num(v.plannedDebtBalance), note:v.financeNote.trim() };
  data.checkIns.push(entry);
  addFact('financial','更新当前收入和负债数值；未录入数值仍为未知。');
  for (const key of ['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost','oneOffCostsNext90Days']) data.baseline[key]=entry[key];
  data.baseline.financeAsOfDate=v.financeAsOfDate;
  data.baseline.financeUpdatedAt=new Date().toISOString();
  data.baseline.certainty=v.financeCertainty;
  resolvePendingFacts(v,'financial');
  persistWithDecision('每月收入和负债反馈');
  showView('home');
}
function saveRelationship(form) {
  const v=getForm(form),plan={sharedDestinationAligned:bool(v.sharedDestinationAligned),moveTimeType:v.moveTimeType || 'unknown',moveTimeValue:v.moveTimeType === 'unknown' ? null:v.moveTimeValue.trim() || null,certainty:v.certainty,maxLongDistanceDays:num(v.maxLongDistanceDays),nextRelationshipReviewAt:v.nextRelationshipReviewAt || null,longDistanceStartDate:v.longDistanceStartDate || null,reunionDate:v.reunionDate || null,travelPlan:v.travelPlan.trim(),reunionNextAction:v.reunionNextAction.trim()};
  if (plan.moveTimeType === 'exact_date' && plan.moveTimeValue && !isDate(plan.moveTimeValue)) throw new Error('明确日期请使用有效 YYYY-MM-DD；自然语言请选“范围”。');
  if (plan.moveTimeType === 'month' && plan.moveTimeValue && !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.moveTimeValue)) throw new Error('大致月份请使用 YYYY-MM。');
  if (plan.longDistanceStartDate && plan.reunionDate && daysBetween(plan.longDistanceStartDate,plan.reunionDate)<0) throw new Error('汇合日不能早于异地开始日。');
  Object.assign(data.partnerPlan,plan);data.config.maxLongDistanceDays=plan.maxLongDistanceDays;
  data.checkIns.push({id:uid(),type:'relationship',createdAt:new Date().toISOString(),...plan});
  addFact('relationship','关系计划更新：'+(plan.moveTimeValue || '精确时间仍未知')+'；下次共同讨论 '+(plan.nextRelationshipReviewAt || '待约定'),plan.certainty);
  resolvePendingFacts(v,'relationship');
  persistWithDecision('关系变化');showView('home');
}

function saveResign(form) {
  const v=getForm(form),offer=data.offers.find(o=>o.id === v.offerId);
  if (!offer) throw new Error('请先记录并接受书面录用通知。');
  if ((data.routeDecision.decisionPremises ?? []).length < 2) throw new Error('先做重新考虑去向，保存选择与至少两条条件，再检查离职。');
  if (data.routeDecision.offerId !== offer.id) throw new Error('这不是你在重新考虑去向中选择的机会。先更新去向与条件，不用离职表单静默换去向。');
  Object.assign(data.baseline,{contractNoticeDays:num(v.contractNoticeDays),availableHandoverDays:num(v.availableHandoverDays),preferredHandoverDays:num(v.preferredHandoverDays),handoverCompletion:num(v.handoverCompletion)});
  Object.assign(offer,{termsConfirmed:bool(v.termsConfirmed),pendingConditionsClear:bool(v.pendingConditionsClear),transitionIncomeGapMonths:num(v.transitionIncomeGapMonths)});
  data.routeDecision.offerId=offer.id;data.intent='resign';
  const blockers=resignBlockers(offer,data,todayISO());
  if (!blockers.length) {
    data.routeState='NOTICE_AND_HANDOVER';data.routeDecision.route=offer.city === '上海' ? 'shanghai_bridge':'guangdong';
    data.routeDecision.bridgeExitDate=offer.bridgeExitDate;data.routeDecision.gdSearchRestartDate=offer.gdSearchRestartDate;
    delete data.intent;
  }
  data.checkIns.push({id:uid(),type:'resign',createdAt:new Date().toISOString(),offerId:offer.id,blockers,handoverNote:v.handoverNote.trim()});
  persistWithDecision('离职安全检查');showView('home');
}

function saveOffer(form) {
  const v=getForm(form),existing=data.offers.find(o=>o.id === v.id),facts=careerValues(v),score=deriveCareer(facts);
  const offer={...existing,id:v.id || uid(),company:v.company.trim(),city:v.city,role:v.role.trim(),workMode:v.workMode,status:v.status,grossIncome:num(v.grossIncome),monthlyNetIncome:num(v.monthlyNetIncome),monthlyLivingCost:num(v.monthlyLivingCost),bonusGuaranteed:num(v.bonusGuaranteed),probationRate:num(v.probationRate),probationMonths:num(v.probationMonths),probationNetIncome:num(v.probationNetIncome),monthlyCommuteCost:num(v.monthlyCommuteCost),relocationState:v.relocationState,switchingState:v.switchingState,relocationCost:v.relocationState === 'knownAmount' ? num(v.relocationCost):null,switchingCost:v.switchingState === 'knownAmount' ? num(v.switchingCost):null,careerFacts:facts,careerScore:score.score,careerAssessment:{...score,method:'observable-facts-v1',assessedAt:new Date().toISOString()},targetAligned:facts.targetFit,growthReason:v.growthReason.trim(),certainty:v.certainty,startDate:v.startDate || null,responseDueDate:v.responseDueDate || null,firstPayDate:v.firstPayDate || null,updatedAt:new Date().toISOString(),canDelayStart:bool(v.canDelayStart),risks:v.risks.trim(),reversibility:v.reversibility || null,bridgeExitDate:v.bridgeExitDate || null,gdSearchRestartDate:v.gdSearchRestartDate || null};
  for (const key of ['relocation','switching']) if (offer[key+'State'] === 'knownAmount' && offer[key+'Cost'] == null) throw new Error('选择金额已知后，请填写对应金额；明确没有成本填 0。');
  const critical=['status','company','city','role','workMode','grossIncome','bonusGuaranteed','monthlyNetIncome','monthlyLivingCost','startDate','firstPayDate','probationRate','probationMonths','probationNetIncome','relocationCost','switchingCost'];
  if (existing && critical.some(k=>existing[k] !== offer[k])) {offer.termsConfirmed=false;offer.pendingConditionsClear=false;}
  if (existing) Object.assign(existing,offer);else data.offers.push(offer);
  addFact('offer',(existing ? '机会条件更新：':'新增机会：')+offer.company+' / '+offer.role+' / '+offer.city,offer.certainty);
  resolvePendingFacts(v,'offer');
  editingOfferId=null;persistWithDecision(existing ? '修改岗位信息（关键条件需重新确认）':'新增岗位');
  showView('offers');
}


function saveCashflowSettings(form) {
  const v=getForm(form);
  data.cashflowSettings={
    salaryPayDay:num(v.salaryPayDay),
    incomePauseStart:v.incomePauseStart || null,
    incomePauseEnd:v.incomePauseEnd || null,
  };
  validateData(data); // Catch invalid gaps before any write.
  persistWithDecision('资金模型设置','工资到账日和收入空档已更新。');
  showView('cashflow');
}
function saveCashEvent(form) {
  const v=getForm(form);
  const existing=data.cashEvents.find(e=>e.id===v.id);
  const event={...existing,id:existing?.id ?? uid(),kind:v.kind,label:v.label.trim(),date:v.date,
    endDate:v.endDate||null,direction:v.direction,impact:v.impact,
    amount:num(v.amount),recurrenceMonths:Number(v.recurrenceMonths??0),
    certainty:v.certainty,note:v.note.trim(),completedAt:existing?.completedAt??null};
  if(existing)Object.assign(existing,event);else data.cashEvents.push(event);
  validateData(data);
  editingCashEventId=null;
  persistWithDecision(existing?'调整资金事件':'新增资金事件','资金事件已保存，预测已重新计算。');
  showView('cashflow');
}

function saveSettings(form) {
  const v=getForm(form);
  data.config={...data.config,gdMinNetIncome:num(v.gdMinNetIncome),gdMinCareerScore:num(v.gdMinCareerScore),
    bridgeMinSixMonthGain:num(v.bridgeMinSixMonthGain),bridgeMaxMonths:num(v.bridgeMaxMonths),
    maxLongDistanceDays:num(v.maxLongDistanceDays),driftNoActionDays:num(v.driftNoActionDays),
    planVarianceWarningRate:num(v.planVarianceWarningRate)/100,
    checkpointOverrides:Object.fromEntries(CHECKPOINTS.map(item=>[item.id,v[`cp_${item.id}`]]))};
  data.partnerPlan.maxLongDistanceDays=data.config.maxLongDistanceDays;
  persistWithDecision('修改规则设置');
}


function saveLight(form) {
  const v=getForm(form);addFact(v.factType,v.newFact,v.certainty);
  const pendingSync=['financial','offer','career','energy','relationship'].includes(v.factType);
  data.checkIns.push({id:uid(),type:'light',factType:v.factType,pendingSync,createdAt:new Date().toISOString(),newFact:v.newFact.trim(),waitReason:v.waitReason.trim(),nextReviewAt:v.nextReviewAt || null});
  persistWithDecision('新事实事件',pendingSync ? '变化已记录；文字尚未填到相关表格，请更新对应表单。':'变化已记录；自由文字不会自动改变规则判断，请核对结论。');showView('home');
}
function reviewPremises(v) {
  const ps=data.routeDecision.decisionPremises ?? [];
  if (ps.some(p=>!v['premise_'+p.id])) throw new Error('先逐条确认旧条件的当前状态。');
  for (const p of ps) {
    const status=v['premise_'+p.id];
    if (status === 'invalid' && p.status !== 'invalid') p.invalidSince=todayISO();
    if (status !== 'invalid') delete p.invalidSince;
    p.status=status;p.reviewedAt=todayISO();
  }
  const override=data.routeDecision.manualOverride;
  if (override && !v.overrideStillValid) throw new Error('请复查上次这样选择的理由是否仍成立。');
  if (override) {override.stillValid=bool(v.overrideStillValid);override.reviewedAt=todayISO();}
  data.checkIns.push({id:uid(),type:'premise_review',createdAt:new Date().toISOString(),decisionId:data.currentDecisionId,premiseReviews:structuredClone(ps),overrideStillValid:override?.stillValid ?? null});
}
function saveMajor(form) {
  const v=getForm(form),oldDecision=data.routeDecision,d=evaluate(data,todayISO());
  reviewPremises(v);
  const premises=v.premises.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
  if (premises.length < 2 || premises.length > 5) throw new Error('请每行一条，填写 2–5 条新重要条件。');
  if (v.nextMajorReviewAt <= todayISO()) throw new Error('哪天再看看这个选择是否合适？需在今天之后。');
  const override=v.manualOverride === 'true',o=data.offers.find(x=>x.id === v.offerId);
  if (['GUANGDONG_READY','SHANGHAI_BRIDGE_READY'].includes(v.routeState)) {
    if (!o || (v.routeState === 'GUANGDONG_READY' ? o.city === '上海':o.city !== '上海')) throw new Error('请选择与去向一致的机会。');
    const assessed=o.city === '上海' ? qualifyShanghaiOffer(o,data,todayISO()):qualifyGuangdongOffer(o,data,todayISO());
    if (!assessed.qualified && !override) throw new Error('这份机会尚未达到参考条件；如仍决定选它，请记录这样选择的理由。');
  }
  if (override && (!v.overrideReason.trim() || !v.overrideReviewAt || v.overrideReviewAt <= todayISO())) throw new Error('覆盖建议需明确理由和未来复查日。');
  let bridgeExitDate=o?.bridgeExitDate ?? oldDecision.bridgeExitDate,gdSearchRestartDate=o?.gdSearchRestartDate ?? oldDecision.gdSearchRestartDate;
  if (v.routeState === 'SHANGHAI_BRIDGE_ACTIVE') {
    const renewalErrors=bridgeRenewalErrors(v,todayISO());
    if (renewalErrors.length) throw new Error(renewalErrors.join('；'));
    bridgeExitDate=v.bridgeExitDate;gdSearchRestartDate=v.gdSearchRestartDate;
  }
  addFact('other',v.newEvidence,v.evidenceCertainty);
  const item={id:uid(),routeState:v.routeState,route:v.routeState.startsWith('SHANGHAI') ? 'shanghai_bridge':v.routeState === 'GUANGDONG_READY' ? 'guangdong':'hold',offerId:o?.id ?? null,decidedAt:todayISO(),decisionPremises:premises.map(text=>({id:uid(),text,importance:'core',status:'valid',createdAt:todayISO()})),nextMajorReviewAt:v.nextMajorReviewAt,manualOverride:override ? {reason:v.overrideReason.trim(),overrideAt:todayISO(),nextReviewAt:v.overrideReviewAt}:null,unknowns:d.unknowns,bridgeExitDate,gdSearchRestartDate,newEvidence:v.newEvidence.trim(),renewalEvidenceType:v.renewalEvidenceType || null,systemSuggestion:d.suggestedRoute,reasons:premises};
  data=recordRouteDecision(data,item);delete data.intent;
  persistWithDecision('用户重大决策');showView('home');
}
async function saveBackup(form) {
  const v=getForm(form);
  if (v.password !== v.passwordConfirm) throw new Error('两次口令不一致。');
  const text=await encryptBackup(JSON.stringify(data),v.password);
  download(text,'career-route-encrypted-'+todayISO()+'.json','application/json;charset=utf-8');
  form.reset();notice('加密备份已下载；请保存口令，遗失无法恢复');
}

document.addEventListener('submit',async event=>{
  const form=event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const handlers={ 'light-form':saveLight,'major-form':saveMajor,'backup-form':saveBackup,'baseline-form':saveBaseline,'market-form':saveMarket,'finance-form':saveFinance,
    'relationship-form':saveRelationship,'resign-form':saveResign,'offer-form':saveOffer,'settings-form':saveSettings,
    'cash-event-form':saveCashEvent,'cashflow-settings-form':saveCashflowSettings };
  const before=structuredClone(data);
  try { await handlers[form.getAttribute('id')]?.(form); } catch (error) { data=before; const target=form.querySelector('.form-error'); if (target) target.textContent=error.message; else notice(error.message); }
});

document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-view]');
  if (!target) return;
  if (target.dataset.view) { showView(target.dataset.view,target.dataset.tab); return; }
  if (target.dataset.tab) { feedbackTab=target.dataset.tab; render(); return; }
  const action=target.dataset.action;
  if (!action) return;
  const before=structuredClone(data);
  try {
    if (['edit-cash-event','delete-cash-event','finish-cash-event','cancel-cash-edit'].includes(action)) {
      if(action==='cancel-cash-edit'){editingCashEventId=null;render();return;}
      const item=data.cashEvents.find(e=>e.id===target.dataset.id);
      if(!item)throw new Error('没有找到这笔资金事项。');
      if(action==='edit-cash-event'){editingCashEventId=item.id;render();return;}
      if(action==='delete-cash-event'){
        if(!confirm('删除这条资金事项及其后续重复记录？此操作不能撤销。'))return;
        data.cashEvents=data.cashEvents.filter(e=>e.id!==item.id);
        editingCashEventId=null;
        persistWithDecision('删除资金事件','资金事件已删除，预测已重新计算。');
        return;
      }
      if(action==='finish-cash-event'){
        if(item.recurrenceMonths)throw new Error('周期事件不能整体标记支付；请修改下次日期或保留重复计划。');
        if(!confirm('确认已经发生？完成后请同步更新现金余额，避免资金预测沿用支付前的余额。'))return;
        item.completedAt=todayISO();
        persistWithDecision('确认资金事项完成','已记录事项完成；请同步更新可用现金。');
        return;
      }
    }
    if (action === 'complete-checkpoint' || action === 'reopen-checkpoint') {
      const id = target.dataset.id;
      if (!CHECKPOINTS.some(item => item.id === id)) throw new Error('未知计划节点。');
      const completedAt = action === 'complete-checkpoint' ?
        app.querySelector('[name="completed_'+id+'"]')?.value : null;
      if (action === 'complete-checkpoint' && (!isDate(completedAt) || completedAt > todayISO())) {
        throw new Error('请填写有效的完成日期，不能晚于今天。');
      }
      data.config.checkpointCompletions = { ...data.config.checkpointCompletions, [id]:completedAt };
      persistWithDecision('计划节点状态更新', completedAt ? '已保存完成状态和实际日期。' : '已撤销完成状态，节点恢复待办。');
      return;
    }
    if (action==='no-change') { data.checkIns.push({id:uid(),type:'light',noChange:true,createdAt:new Date().toISOString()}); persistWithDecision('记录近况：没有变化','已记录，之前填写的情况保持不变。'); showView('home'); return; }
    if (action==='review-premises') { reviewPremises(getForm(target.closest('form')));persistWithDecision('确认条件');return; }
    if (action==='export-backup') { if (!confirm('明文备份包含你的负债、收入、关系和我的记录。确定关闭导出加密吗？')) return; notice(`备份已下载：${downloadBackup(data)}`); return; }
    if (action==='export-calendar') { downloadCalendar(data); notice('日历文件已下载，请导入你的日历应用'); return; }
    if (action==='clear-data') {
      if (!confirm('此操作会删除当前浏览器的全部去向记录。建议先导出备份。确认删除吗？')) return;
      clearData(data,{recovery:Boolean(dataError)}); data=loadData(); dataError=null; editingOfferId=null; render(); notice('本机数据已清空'); return;
    }
    if (action==='new-offer') { editingOfferId=null;showView('feedback','offer');return; }
    if (action==='edit-offer') { editingOfferId=target.dataset.id; showView('feedback','offer'); return; }
    if (action==='cancel-edit') { editingOfferId=null; showView('offers'); return; }
    if (action==='delete-offer') {
      const offer=data.offers.find(item=>item.id===target.dataset.id);
      if (!offer || !confirm(`删除“${offer.company}”这条机会记录？该操作不能撤销。`)) return;
      data.offers=data.offers.filter(item=>item.id!==offer.id);
      if (data.routeDecision.offerId===offer.id) data.routeDecision={...data.routeDecision,offerId:null,route:null};
      persistWithDecision('删除岗位'); return;
    }
    if (action==='withdraw-resign') { delete data.intent; persistWithDecision('暂不提离职'); return; }
    if (action==='started') {
      const offer=data.offers.find(item=>item.id===data.routeDecision.offerId);
      if (!offer) throw new Error('请先确认对应的录用通知。');
      data.routeDecision.startedAt=todayISO(); delete data.intent;
      data.routeState=data.routeDecision.route==='shanghai_bridge'?'SHANGHAI_BRIDGE_ACTIVE':'GUANGDONG_MIGRATION';
      persistWithDecision('确认入职'); return;
    }
    if (action==='moved') { data.routeState='GUANGDONG_SETTLING'; data.routeDecision.movedAt=todayISO(); persistWithDecision('确认搬家完成'); return; }
    if (action==='settled') {
      if (daysBetween(data.routeDecision.movedAt || todayISO(),todayISO())<90) throw new Error('搬家后满 90 天再完成本轮适应期再看一次计划。');
      if (!confirm('确认已完成工作、收入和开支和关系再看一次计划，并结束本轮搬家？')) return;
      data.routeState='STABLE';persistWithDecision('工作和生活已稳定下来');return;
    }
  } catch (error) { data=before;notice(error.message); }
});

document.addEventListener('change',async event=>{
  if(event.target.name==='kind' && event.target.closest('#cash-event-form')){
    const v=event.target.value,form=event.target.closest('form');
    const defaults={insurance:['out','extra','0'],rent:['out','living','3'],bonus:['in','extra','0'],
      offer:['milestone','milestone','0'],first_pay:['milestone','milestone','0'],moving:['out','extra','0'],other:['out','extra','0']};
    const [direction,impact,repeat]=defaults[v]??defaults.other;
    form.querySelector('[name="direction"]').value=direction;
    form.querySelector('[name="impact"]').value=impact;
    form.querySelector('[name="recurrenceMonths"]').value=repeat;
    return;
  }
  if(event.target.name==='direction' && event.target.closest('#cash-event-form')){
    const form=event.target.closest('form'),milestone=event.target.value==='milestone';
    if(milestone)form.querySelector('[name="impact"]').value='milestone';
    else if(form.querySelector('[name="impact"]').value==='milestone')form.querySelector('[name="impact"]').value='extra';
    return;
  }
  if (event.target.name === 'update-topic') { feedbackTab=event.target.value;editingOfferId=null;render();return; }
  if (event.target.name === 'city') { const plan=event.target.closest('form').querySelector('[data-shanghai-plan]');if(plan) plan.hidden=event.target.value !== '上海';return; }
  if (event.target.name === 'manualOverride') { event.target.closest('form').querySelector('[data-exception]').hidden=event.target.value !== 'true';return; }
  if (event.target.name?.startsWith('career_')) { const form=event.target.closest('form');const output=form.querySelector('[data-career-output]'); if (output) output.textContent=careerText(deriveCareer(careerValues(getForm(form))));return; }
  if (event.target.id!=='import-file') return;
  const file=event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10000000) throw new Error('备份超过 10 MB 限制。');
    const raw=await decodeBackup(await file.text(),document.querySelector('#import-password')?.value ?? '');
    if (!dataError && !confirm('导入会替换当前浏览器里的全部记录。已导出当前备份吗？确认继续？')) return;
    const previous={data,dataError,editingOfferId};
    try {
      data=validateData(JSON.parse(raw));dataError=null;editingOfferId=null;
      render(); // First prove that this backup can be displayed without replacing the stored archive.
      data=importData(raw,previous.data,{recovery:Boolean(previous.dataError)});
      render();notice('备份导入成功');
    } catch (error) {
      data=previous.data;dataError=previous.dataError;editingOfferId=previous.editingOfferId;
      render();throw error;
    }
  } catch (error) { notice(`导入失败：${error.message}`); }
  finally { event.target.value=''; }
});

window.addEventListener('hashchange',render);
render();
