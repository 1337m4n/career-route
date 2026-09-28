import { CHECKPOINTS, createInitialData, loadData, saveData, clearData, importData, downloadBackup, appendDecision, recordRouteDecision, download, isDate } from './data.mjs';
import { downloadCalendar } from './reminders.mjs';
import { evaluate, validateBaseline, qualifyGuangdongOffer, qualifyShanghaiOffer, deriveCareer, deriveEnergy, CAREER_WEIGHTS, financialCapacity, resignBlockers, addMonths, bridgeRenewalErrors } from './rules.mjs';

import { encryptBackup, decodeBackup } from './crypto.mjs';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const insecureOrigin = !window.isSecureContext;
const VIEWS = new Set(['home', 'feedback', 'offers', 'timeline', 'history', 'settings']);
const FEEDBACK_TABS = ['light', 'major', 'baseline', 'market', 'finance', 'relationship', 'resign'];
const STATE_LABELS = {
  BASELINE_SETUP: '建立事实基线', MARKET_TESTING: '验证两地市场', HOLD_AND_SEARCH: '留岗并继续求职',
  ROUTE_CHOICE_REQUIRED: '两地均成立，由你选择', GUANGDONG_READY: '广东路线具备条件', SHANGHAI_BRIDGE_READY: '上海桥接已达门槛',
  NOTICE_AND_HANDOVER: '通知与交接', SHANGHAI_BRIDGE_ACTIVE: '上海桥接进行中',
  GUANGDONG_MIGRATION: '广东迁移中', GUANGDONG_SETTLING: '广东适应期',
  DRIFT_REVIEW: '需要重新校准', STABLE: '本轮迁移完成'
};
const TAB_LABELS = { light: '轻检查', major: '重大复盘', baseline: '首次基线', market: '每周市场', finance: '每月财务', relationship: '关系时间线', resign: '提离职前检查' };
let data;
let dataError = null;
let currentView = 'home';
let feedbackTab = 'light';
let editingOfferId = null;
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
function nextCheckpoint() { return checkpoints().find(item => item.date >= todayISO()) || checkpoints().at(-1); }
function viewFromHash() { const raw = location.hash.slice(1); return VIEWS.has(raw) ? raw : 'home'; }
function notice(text) { toast.textContent = text; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3900); }
function showView(view, tab) { if (tab && FEEDBACK_TABS.includes(tab)) feedbackTab = tab; if (view === currentView) render(); else location.hash = view; window.scrollTo({ top: 0, behavior: 'instant' }); }
function persistWithDecision(source) {
  const decision = evaluate(data, todayISO());
  data.routeState = decision.routeState;
  data.riskState = decision.riskState;
  data = appendDecision(data, { ...decision, source, at: new Date().toISOString() });
  saveData(data);
  render();
  notice('已保存，并更新当前判断');
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
  return CAREER_WEIGHTS.map(([key,label,weight])=>select('career_'+key,(current && key === 'technologyDepth' ? '过去三个月学到新的可迁移能力' : label)+ ' · '+weight+'%',String(facts?.[key] ?? ''),[['true','有明确依据'],['false','目前没有'],['unknown','未知 / 需要核实']])).join('');
}
function careerOutput(facts = {}) {
  const r=deriveCareer(facts ?? {});
  return `<div class="field full score-output" aria-live="polite" data-career-output>${escapeHTML(careerText(r))}</div>`;
}
function careerText(r) { return r.score == null ? `成长判断：未知（已核实 ${r.coverage}/5 项），不会把缺失材料当作低分或高分。` : `成长判断：${{LOW:'偏低',MEDIUM:'中等',HIGH:'较高'}[r.band]} · ${r.points}/100（路线参考 ${r.score}/5）。权重公开，不是人生总分。`; }
function careerValues(v) { return Object.fromEntries(CAREER_WEIGHTS.map(([key])=>[key,bool(v['career_'+key])])); }
function energyFields(f = {}) {
  return [['workAvoidance','明显抗拒开始工作'],['lowMood','下班后持续低沉'],['restRecovers','休息后能够恢复'],['affectsLife','已影响正常工作或生活'],['expensiveRecovery','频繁依赖高成本方式恢复']].map(([key,label])=>select('energy_'+key,label,String(f?.[key] ?? ''),[['true','是'],['false','否'],['unknown','未知']])).join('');
}
function addFact(type,value,certainty='confirmed',source='user') {
  if (!value?.trim()) return;
  data.facts.push({id:uid(),type,value:value.trim(),certainty,recordedAt:new Date().toISOString(),source,supersedes:null});
}
function renderFiveQuestions(d) {
  const r=data.routeDecision, ps=r.decisionPremises ?? [], latest=data.facts.slice(-3);
  return section('五问校准',`<div class="question-grid"><article><h3>1. 我现在走什么路线？</h3><p>${escapeHTML(STATE_LABELS[d.routeState])}；风险 ${escapeHTML(d.riskState)}。风险提示不会抹掉路线。</p></article><article><h3>2. 当初为什么这样选？</h3>${ps.length ? `<ul class="plain-list">${ps.map(p=>`<li>${escapeHTML(p.text)}</li>`).join('')}</ul>`:'<p>尚未记录正式决策前提。重大复盘时保存 2–5 条。</p>'}</article><article><h3>3. 哪些前提仍成立？</h3>${ps.length ? `<ul class="plain-list">${ps.map(p=>`<li>${escapeHTML(premiseLabels[p.status])}：${escapeHTML(p.text)}</li>`).join('')}</ul>`:'<p>先记录前提；旧存档不会被虚构补齐。</p>'}${r.manualOverride ? `<p class="warning-note">覆盖理由：${escapeHTML(r.manualOverride.reason)}；${dateLabel(r.manualOverride.nextReviewAt)} 复查。</p>`:''}</article><article><h3>4. 最近出现什么新事实？</h3>${latest.length ? `<ul class="plain-list">${latest.map(f=>`<li>${escapeHTML(f.value)}（${escapeHTML({confirmed:'确认',likely:'很可能',rough:'粗略',unknown:'未知'}[f.certainty])}）</li>`).join('')}</ul>`:'<p>还没有单独记录变化；没有变化可一键结束轻检查。</p>'}</article><article><h3>5. 有没有偏航？</h3><p>${d.requiresRedecision ? '原前提、覆盖理由或复盘期限需要重新核实。':'当前未发现需要强制重新决策的前提信号。'} 这不保证路线正确。</p></article></div><details><summary>哪些未知会改变结论？</summary><ul class="plain-list">${d.unknowns.map(t=>`<li>${escapeHTML(t)}</li>`).join('')}${d.changingConditions.map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul></details>`);
}
function renderLightForm() {
  return `<p class="form-intro">先看有没有重要变化。“无重要变化”只记录这次检查，不刷新旧事实、Offer 条款或求职动作日期。</p><div class="btn-row"><button class="btn btn-primary" type="button" data-action="no-change">无重要变化</button><button class="btn btn-secondary" type="button" data-tab="major">需要重大复盘</button></div><form id="light-form">
  ${formSection('有变化时，只记录新的部分',select('factType','事实类别','other',[['offer','新 Offer / 条件变化'],['financial','收入 / 债务 / 现金'],['career','职责 / 技术 / 履历'],['energy','工作体验'],['relationship','关系 / 迁移'],['other','其他']])+
  certaintySelect('certainty','确定程度','confirmed')+textarea('newFact','发生了什么新变化','',{required:true})+textarea('waitReason','新的“再等等”理由','')+input('nextReviewAt','希望提前复盘日',null,{type:'date'}),'记录后立即校准；具体数字变化请到财务、机会或关系页更新。')}
  ${formActions('记录变化并校准')}</form>`;
}
function renderMajorForm() {
  const r=data.routeDecision,d=evaluate(data,todayISO()),ps=r.decisionPremises ?? [];
  const routes=[['MARKET_TESTING','继续验证市场'],['HOLD_AND_SEARCH','留岗继续求职'],['GUANGDONG_READY','选择广东机会'],['SHANGHAI_BRIDGE_READY','选择上海桥接机会']];
  if (data.routeState === 'SHANGHAI_BRIDGE_ACTIVE') routes.push(['SHANGHAI_BRIDGE_ACTIVE','以新收益重新选择上海桥接']);
  return `<p class="form-intro">系统建议：${escapeHTML(STATE_LABELS[d.suggestedRoute])}。先检查旧前提，再决定未来。覆盖建议不能绕过离职安全门。</p><form id="major-form">
  ${formSection('1. 先复查上次前提',ps.length ? ps.map(p=>select('premise_'+p.id,p.text,'',[['valid','仍成立'],['partially_valid','部分成立'],['invalid','已失效'],['unknown','未知']],{full:true})).join('')+'<button type="button" class="btn btn-secondary" data-action="review-premises">只保存前提复查，暂不选新路线</button>':'<p class="field full">尚无正式前提；下面将创建首次决策。</p>')}
  ${r.manualOverride ? formSection('上次覆盖理由复查',`<p class="field full">${escapeHTML(r.manualOverride.reason)}</p>`+select('overrideStillValid','上次覆盖理由现在是否仍成立','',[['true','仍成立'],['false','已失效'],['unknown','未知']])):''}
  ${formSection('2. 新事实与最终选择',textarea('newEvidence','从上次决策以来的新事实 / 未来收益','',{help:'桥接续期必须有新的项目、收入、市场或其他可核实变化；熟悉、情分、奖金不能单独支撑。'})+
    certaintySelect('evidenceCertainty','新事实确定程度','confirmed')+
    select('routeState','我决定的路线',d.suggestedRoute,routes,{required:true})+
    select('offerId','这次选择的机会（留岗可空）',r.offerId ?? '',data.offers.map(o=>[o.id,o.company+' · '+o.city]))+
    textarea('premises','新的 2–5 条核心成立前提','',{required:true,help:'每行一条，记录未来收益与约束，不复制沉没成本。'})+
    input('nextMajorReviewAt','下次重大复盘日',addDays(todayISO(),30),{type:'date',required:true})+
    select('manualOverride','是否主动覆盖系统建议','false',[['false','按系统候选做选择'],['true','覆盖建议，记录例外']],{required:true})+
    textarea('overrideReason','覆盖理由（覆盖时必填）','')+
    input('overrideReviewAt','覆盖理由复查日',null,{type:'date'}))}
  ${data.routeState === 'SHANGHAI_BRIDGE_ACTIVE' ? formSection('3. 桥接重新准入',select('renewalEvidenceType','新的未来收益依据','',[['project','已确认的新高价值项目'],['income','明确的新收入变化'],['market','客观广东市场变化'],['other','新的重要事实']])+
    input('bridgeExitDate','新强制重新决策日',addMonths(todayISO(),6),{type:'date'})+
    input('gdSearchRestartDate','广东求职重启节点',addDays(addMonths(todayISO(),6),-60),{type:'date'}),'旧理由不自动延续。延期必须产生新 Decision；不表示到期裸辞。'):''}
  ${formActions('保存我的决策与前提')}</form>`;
}

function relativeDue(date) { const days = daysBetween(todayISO(), date); return days == null ? '' : days < 0 ? `已逾期 ${-days} 天` : days === 0 ? '今天' : `${days} 天后`; }

function renderHome() {
  const decision = evaluate(data, todayISO());
  const baselineCheck = validateBaseline(data);
  const next = nextCheckpoint();
  const hero = baselineCheck.valid ? renderDecisionHero(decision) : renderSetupHero(baselineCheck);
  return pageHeader('今天的判断', '基于事实，做更适合自己的选择') +
    `<section class="section hero-grid">${hero}</section>` +
    renderFiveQuestions(decision) +
    section('接下来的关键节点', renderTimelineRail(), '复盘日要求更新判断，不要求到点离职。') +
    `<section class="section split-grid"><div><h2>已知财务基线</h2>${renderFinanceSummary()}</div><div><h2>接下来</h2>${renderActions(decision, baselineCheck.valid)}</div></section>` +
    `<section class="section"><h2>下次检查</h2><p class="lead">${next ? `${escapeHTML(dateLabel(next.date))} · ${escapeHTML(next.label)}（${escapeHTML(relativeDue(next.date))}）` : '暂无计划节点'}</p><button type="button" class="text-link" data-view="timeline">查看完整时间线</button></section>`;
}
function renderSetupHero(check) {
  const labels = { debtBalance: '最新负债余额', cashBalance: '可用现金', gdMinNetIncome: '广东最低到手收入', maxLongDistanceDays: '双方异地上限', currentRoleGrowth: '当前岗位成长性', energyLevel: '当前精力状态', sharedDestinationAligned: '双方最终方向', monthlyNetIncome: '月到手收入', monthlyDebtPayment: '当前月供', monthlyLivingCost: '生活支出', oneOffCostsNext90Days: '未来90天一次性支出', gdMinCareerScore: '广东岗位最低成长分', bridgeMinSixMonthGain: '上海桥接财务门槛', bridgeMaxMonths: '上海桥接最长月数', contractNoticeDays: '合同通知期', preferredHandoverDays: '期望交接天数', targetRoles: '目标岗位方向' };
  const missing = (check.missing || []).map(key => key.split('.').at(-1));
  const shortlist = missing.slice(0, 5);
  return `<div><h2 class="hero-title">先记录当下，不必算清未来</h2><p class="hero-copy">已知的先填，未知的留空。系统仍展示目前能确认的部分，只在不可逆行动前阻止关键未知。</p><button class="btn btn-primary" type="button" data-view="feedback" data-tab="baseline">完成首次基线 <span aria-hidden="true">→</span></button></div><div><h3>关键事实填写状态</h3><ul class="status-list">${shortlist.map(key => `<li><span class="status-dot" aria-hidden="true">!</span><span>${escapeHTML(labels[key] || key)}</span><strong>待填写</strong></li>`).join('')}${missing.length > shortlist.length ? `<li><span></span><span>另有 ${missing.length - shortlist.length} 项待填写</span><strong></strong></li>` : ''}</ul></div>`;
}
function renderDecisionHero(d) {
  const risks = [...d.blockers.map(x=>({...x,level:'red'})),...d.warnings.filter(x=>x.level !== 'info')];
  return `<div><div class="decision-banner ${d.level}"><div class="decision-topline"><span class="level ${d.level}">${escapeHTML({GREEN:'当前未发现显著风险',YELLOW:'需要关注',RED:'需要重新校准',BLOCKED:'离职动作被阻止'}[d.riskState])}</span></div><h2 class="hero-title">${escapeHTML(STATE_LABELS[d.routeState])}</h2><p class="hero-copy">系统建议：${escapeHTML(STATE_LABELS[d.suggestedRoute])}。路线和风险独立，选择权始终由你保留。下次检查：${dateLabel(d.nextCheckAt)}。</p></div><div class="btn-row"><button class="btn btn-primary" type="button" data-view="feedback" data-tab="${d.requiresRedecision ? 'major':'light'}">${d.requiresRedecision ? '重大复盘':'轻检查'}</button><button class="btn btn-secondary" type="button" data-view="feedback" data-tab="major">保存我的路线选择</button>${nextStageButton(d.routeState)}${data.intent === 'resign' ? '<button class="btn btn-quiet" type="button" data-action="withdraw-resign">暂不提离职</button>':''}</div></div><div><h3>规则依据与行动边界</h3><ul class="plain-list">${d.reasons.map(x=>`<li><span class="rule-code">${x.code}</span>${escapeHTML(x.text)}</li>`).join('')}</ul>${risks.length ? `<div class="inline-alert ${d.level === 'red' ? 'red':''} spaced-top">${risks.map(x=>escapeHTML(x.text)).join('<br />')}</div>`:''}<p class="note">${d.evidenceCounts.confirmed} 条确认记录 · ${d.evidenceCounts.estimates} 条估计 · ${d.evidenceCounts.unknown} 个未知。数量不是可信概率。</p></div>`;
}

function nextStageButton(state) {
  if (state === 'GUANGDONG_READY' || state === 'SHANGHAI_BRIDGE_READY') return `<button class="btn btn-secondary" type="button" data-view="feedback" data-tab="resign">检查离职条件</button>`;
  if (state === 'NOTICE_AND_HANDOVER') return `<button class="btn btn-secondary" type="button" data-action="started">我已入职</button>`;
  if (state === 'GUANGDONG_MIGRATION') return `<button class="btn btn-secondary" type="button" data-action="moved">迁移已完成</button>`;
  if (state === 'GUANGDONG_SETTLING') return `<button class="btn btn-secondary" type="button" data-action="settled">完成适应期复盘</button>`;
  return '';
}
function renderTimelineRail() {
  const items = checkpoints();
  const next = nextCheckpoint();
  const selected = [items[0], ...items.filter(item => item.date >= todayISO()).slice(0, 3)].filter(Boolean).filter((item, index, arr) => arr.findIndex(x => x.id === item.id) === index).slice(0, 4);
  return `<div class="timeline-rail" aria-label="近期关键节点">${selected.map(item => `<div class="timeline-node ${item.id === next?.id ? 'is-current' : ''}"><b>${escapeHTML(shortDate(item.date))}</b><span>${escapeHTML(item.label)}</span></div>`).join('')}</div>`;
}
function renderFinanceSummary() {
  const b=data.baseline, f=financialCapacity(data);
  return `<dl class="metric-list"><div><dt>月到手</dt><dd>${money(b.monthlyNetIncome)}</dd></div><div><dt>月供 + 基本生活</dt><dd>${money(f.required)}</dd></div><div><dt>月度差额</dt><dd class="${f.monthlyBalance < 0 ? 'negative':''}">${money(f.monthlyBalance)}</dd></div><div><dt>一个月无工资测试</dt><dd>${{UNKNOWN:'信息不足',COVERED:'可覆盖',TIGHT:'紧张',UNAFFORDABLE:'无法覆盖'}[f.stress]}</dd></div></dl><p class="note">扣除已知大额支出后检查必要开支承受能力，不预测未来，也不单独构成离职许可。</p>`;
}

function renderActions(decision, baselineValid) {
  const fallback = [{ text: '完成首次基线信息填写', dueDate: nextCheckpoint()?.date }, { text: '核实当前负债与现金', dueDate: nextCheckpoint()?.date }, { text: '在关键节点前更新信息', dueDate: nextCheckpoint()?.date }];
  const actions = baselineValid ? (decision.actions || []) : fallback;
  return `<ol class="task-list">${actions.slice(0, 3).map(item => `<li><b>${escapeHTML(item.text)}</b><span>${item.dueDate ? `截止 ${escapeHTML(dateLabel(item.dueDate))}` : '在下一次复盘前完成'}</span></li>`).join('')}</ol>`;
}

function renderFeedback() {
  const tabs = FEEDBACK_TABS.map(tab => `<button class="tab ${feedbackTab === tab ? 'active' : ''}" type="button" data-tab="${tab}" aria-selected="${feedbackTab === tab}">${TAB_LABELS[tab]}</button>`).join('');
  const bodies = { light: renderLightForm, major: renderMajorForm, baseline: renderBaselineForm, market: renderMarketForm, finance: renderFinanceForm, relationship: renderRelationshipForm, resign: renderResignForm };
  return pageHeader('填写反馈', '每次反馈后立即更新路线') + `<div class="tabs" role="tablist" aria-label="反馈类型">${tabs}</div>${bodies[feedbackTab]()}`;
}
function renderBaselineForm() {
  const b=data.baseline,c=data.config,p=data.partnerPlan;
  return `<p class="form-intro">只填今天能确认的信息。未知可以留空；通知期、未来搬迁和对方精确日期不阻止初始化。</p><form id="baseline-form">
  ${formSection('1. 当前财务',
    ['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost'].map((key,i)=>input(key,['全部负债余额','可用现金','月到手收入','月债务支出','基本生活支出'][i],b[key],{type:'number',min:0,step:'.01',help:'不知道可留空，不会被当作 0。'})).join('')+
    input('oneOffCostsNext90Days','已明确知道的大额支出',b.oneOffCostsNext90Days,{type:'number',min:0,step:'.01',help:'只填已知；未来搬家等暂无依据的成本不用猜。'})+
    certaintySelect('financeCertainty','以上财务信息确定程度',b.certainty ?? 'confirmed'))}
  ${formSection('2. 职业事实',input('targetRoles','长期目标岗位',data.profile.targetRoles.join('、'),{full:true,help:'允许尚未确定。'})+careerFields(b.careerFacts,true)+textarea('careerEvidence','过去三个月的成长依据',b.careerEvidence,{help:'新技能、真实职责、可迁移成果；可以暂时未知。'})+careerOutput(b.careerFacts))}
  ${formSection('3. 最近两周体验',energyFields(b.energyFacts),'体验只用于提醒，不是心理或医疗诊断。')}
  ${formSection('4. 可稍后补充的边界',
    select('sharedDestinationAligned','双方最终方向',String(p.sharedDestinationAligned ?? ''),[['true','一致'],['false','暂不一致'],['unknown','尚未确认']])+
    input('nextRelationshipReviewAt','下一次共同讨论日',p.nextRelationshipReviewAt,{type:'date'})+
    input('gdMinNetIncome','个人广东收入底线（可选）',c.gdMinNetIncome,{type:'number',min:0,step:'.01'})+
    input('contractNoticeDays','合同通知期（天）',b.contractNoticeDays,{type:'number',min:0,max:365,step:1})+
    input('bonusAmount','已知奖金金额',b.bonusAmount,{type:'number',min:0,step:'.01'})+input('bonusPayDate','奖金预计到账日',b.bonusPayDate,{type:'date'}))}
  ${formActions('保存已知事实')}</form>`;
}

function renderMarketForm() {
  return `<p class="form-intro">记录真实求职动作；没有动作时先记录原因，不用为了填表制造投递。</p><form id="market-form">
  ${formSection('本周期实际行动',['gdApplications','shApplications','gdInterviews','shInterviews','gdFinals','shFinals'].map((key,i)=>input(key,['广东有效投递','上海有效投递','广东面试','上海面试','广东终面','上海终面'][i],0,{type:'number',min:0,step:1})).join(''))}
  ${formSection('如果暂停，为什么',
    select('searchPauseReason','暂停原因','',[['planned','主动暂停'],['work','工作周期 / 重保'],['health','健康原因'],['waiting','等待面试结果'],['no_roles','暂无合适岗位'],['motivation','失去动力'],['other','其他']])+
    input('pauseReviewAt','何时复查暂停原因',null,{type:'date'})+
    textarea('pauseNote','原因或等待中的事项','')+
    textarea('marketFeedback','新市场事实','')+
    textarea('waitReason','新的“再等等”理由','')+
    input('nextAction','下一步最小动作','',{full:true}))}
  ${formActions('保存求职反馈')}</form>`;
}

function renderFinanceForm() {
  const b = data.baseline || {};
  return `<p class="form-intro">每月更新真实数字。系统用新数据重算现金流和路线风险。</p><form id="finance-form">
    ${formSection('本月实际财务',
      input('debtBalance','最新全部负债余额',b.debtBalance,{type:'number',min:0,step:'.01',required:false})+
      input('cashBalance','最新可用现金',b.cashBalance,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyNetIncome','本月到手收入',b.monthlyNetIncome,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyDebtPayment','本月贷款月供',b.monthlyDebtPayment,{type:'number',min:0,step:'.01',required:false})+
      input('monthlyLivingCost','本月基本生活支出',b.monthlyLivingCost,{type:'number',min:0,step:'.01',required:false})+
      input('oneOffCostsNext90Days','未来90天已知一次性支出',b.oneOffCostsNext90Days,{type:'number',min:0,step:'.01',required:false})+
      input('plannedCashBalance','原计划本月可用现金',null,{type:'number',min:0,step:'.01',help:'可留空；填写后系统检查实际偏差。'})+
      input('plannedDebtBalance','原计划本月负债余额',null,{type:'number',min:0,step:'.01',help:'可留空；填写后系统检查实际偏差。'})+
      textarea('financeNote','变化原因或备注','',{placeholder:'例如月供下降、房租、搬迁费用。'}))}
    ${formActions('保存财务反馈')}</form>`;
}
function renderRelationshipForm() {
  const p=data.partnerPlan,c=data.config;
  return `<p class="form-intro">同步方向而不是日期。日期未知不等于偏航，重点是是否持续推进、是否约定下一次讨论。</p><form id="relationship-form">
  ${formSection('共同方向与时间表达',
    select('sharedDestinationAligned','最终目的地是否一致',String(p.sharedDestinationAligned ?? ''),[['true','一致'],['false','暂不一致'],['unknown','未知']])+
    select('moveTimeType','对方迁移时间类型',p.moveTimeType,[['exact_date','明确日期'],['month','大致月份'],['date_range','时间范围 / 自然语言'],['unknown','目前未知']])+
    input('moveTimeValue','时间内容',p.moveTimeValue,{full:true,placeholder:'2027-03-15 / 2027-03 / 2–4 月 / 春节后'})+
    certaintySelect('certainty','上述计划确定程度',p.certainty)+
    input('nextRelationshipReviewAt','下次共同讨论日',p.nextRelationshipReviewAt,{type:'date'})+
    input('maxLongDistanceDays','双方认可异地边界（天，可选）',c.maxLongDistanceDays,{type:'number',min:0,max:730,step:1})+
    input('longDistanceStartDate','异地开始日（如已知）',p.longDistanceStartDate,{type:'date'})+
    input('reunionDate','精确汇合日（可未知）',p.reunionDate,{type:'date'})+
    input('travelPlan','往返安排',p.travelPlan,{full:true})+
    input('reunionNextAction','下一次推动计划的动作',p.reunionNextAction,{full:true}))}
  ${formActions('保存关系变化')}</form>`;
}

function renderResignForm() {
  const accepted = data.offers.filter(offer => offer.status === 'accepted');
  const selectedId = data.routeDecision?.offerId || accepted[0]?.id || '';
  const b = data.baseline || {};
  return `<p class="form-intro">只有已接受书面 Offer、关键条件、通知期和过渡财务都确认后，才能进入通知与交接；路线覆盖不能绕过安全门。</p>${accepted.length ? '' : '<div class="inline-alert">目前没有“已接受”的 Offer。你仍可填写检查项，但系统会拦截正式提离职。</div>'}<form id="resign-form">
    ${formSection('Offer 与通知期',
      select('offerId','已接受的 Offer',selectedId,accepted.map(offer=>[offer.id,`${offer.company || '未命名公司'} · ${offer.city} · ${offer.role || '岗位待确认'}`]),{required:true})+
      input('contractNoticeDays','合同通知期（天）',b.contractNoticeDays,{type:'number',min:0,max:365,step:1,required:true})+
      input('availableHandoverDays','新公司允许的交接天数',b.availableHandoverDays,{type:'number',min:0,max:365,step:1,required:true})+
      input('preferredHandoverDays','你愿意提供的交接天数',b.preferredHandoverDays,{type:'number',min:0,max:365,step:1,required:true})+
      select('termsConfirmed','薪资、岗位、地点、入职日和试用期条件已核实','',[['true','已确认'],['false','尚未确认']],{required:true})+
      select('pendingConditionsClear','背调等剩余条件可接受','',[['true','已确认'],['false','尚未确认']],{required:true})+
      input('transitionIncomeGapMonths','预计收入空档（月）',null,{type:'number',min:0,max:12,step:'.5',required:true,help:'明确没有空档填 0；未知不能填 0。'})+
      input('handoverCompletion','必要交接资料完成比例（%）',b.handoverCompletion,{type:'number',min:0,max:100,step:1})+
      textarea('handoverNote','待交接关键事项','',{placeholder:'资产与权限、在途事项、流程、联系人、已知风险。'}),
      '合同通知期是下限。如果新公司允许的天数不足，应先协商日期，系统不会建议违反通知期。')}
    ${formActions('检查是否可以提离职')}</form>`;
}

function renderOffers() {
  const b = data.baseline || {};
  const baseNet = [b.monthlyNetIncome,b.monthlyLivingCost,b.monthlyDebtPayment].every(x=>x!=null) ? Number(b.monthlyNetIncome)-Number(b.monthlyLivingCost)-Number(b.monthlyDebtPayment) : null;
  const offers = data.offers || [];
  const rows = offers.map(offer => {
    const result = offer.city === '上海' ? qualifyShanghaiOffer(offer,data) : qualifyGuangdongOffer(offer,data);
    const gain = result.sixMonthNetGain;
    return `<tr><td><strong>${escapeHTML(offer.company || '未命名公司')}</strong><small>${escapeHTML(offer.city)} · ${escapeHTML(offer.role || '岗位待补')}</small></td><td>${escapeHTML({none:'尚无Offer',verbal:'口头',written:'书面',accepted:'已接受'}[offer.status] || offer.status)}</td><td class="num">${money(offer.monthlyNetIncome)}</td><td class="num">${money(offer.monthlyLivingCost)}</td><td class="num">${gain == null ? '待计算' : money(gain)}</td><td>${escapeHTML(result.careerScore ?? '未知')}${result.careerScore == null ? '':'/5'}<small>${escapeHTML({IMPROVED:'财务明显改善',SIMILAR:'财务大致持平',WORSE:'财务明显恶化',UNKNOWN:'财务方向未知'}[result.trend])}</small></td><td><span class="${result.qualified ? 'qualify' : 'not-qualify'}">${result.qualified ? '路线候选' : '需核实'}</span><small>${escapeHTML([...(result.reasons || []),...(result.warnings || [])].slice(0,2).map(reason => typeof reason === 'string' ? reason : reason.text).join('；'))}</small></td><td><button class="text-link" type="button" data-action="edit-offer" data-id="${escapeHTML(offer.id)}">编辑</button><br /><button class="text-link error-note" type="button" data-action="delete-offer" data-id="${escapeHTML(offer.id)}">删除</button></td></tr>`;
  }).join('');
  const table = `<div class="offer-table-wrap"><table class="offer-table"><thead><tr><th>路线 / 岗位</th><th>状态</th><th>月到手</th><th>当地月生活费</th><th>半年净改善</th><th>成长</th><th>规则结果</th><th>操作</th></tr></thead><tbody><tr><td><strong>当前岗位</strong><small>维持收入并继续寻找</small></td><td>在职</td><td class="num">${money(b.monthlyNetIncome)}</td><td class="num">${money(b.monthlyLivingCost)}</td><td class="num">基准</td><td>${escapeHTML(b.currentRoleGrowth ?? '—')}/5</td><td>${baseNet == null ? '待补基线' : `月差额 ${money(baseNet)}`}</td><td></td></tr>${rows}</tbody></table></div>`;
  const current = offers.find(item => item.id === editingOfferId) || {};
  return pageHeader('机会比较', '先验证路线，再优化奖金和日期') +
    section('当前选择与机会', table, '先看财务改善方向和职业事实。只在成本、试用期数据足够时显示半年金额；任何总分都不能自动替你选路线。') +
    section(editingOfferId ? '编辑机会' : '记录新机会', renderOfferForm(current), '口头信息也可以记录；书面 Offer 才能进入 READY；口头信息可提前比较，不得正式离职。');
}
function renderOfferForm(o) {
  const c = data.config || {}, d = data.routeDecision || {};
  const cityItems = [['广州','广州'],['深圳','深圳'],['广东其他','广东其他'],['上海','上海']];
  return `<form id="offer-form"><input type="hidden" name="id" value="${escapeHTML(o.id || '')}" />
    ${formSection('岗位与条件',
      input('company','公司名称',o.company,{required:true})+
      select('city','城市',o.city,cityItems,{required:true})+
      input('role','岗位名称',o.role,{required:true})+
      select('workMode','工作模式',o.workMode,[['onsite','现场'],['hybrid','混合'],['remote','远程']],{required:true})+
      select('status','Offer 状态',o.status,[['none','尚无正式结果'],['verbal','口头意向'],['written','书面 Offer'],['accepted','已接受书面 Offer']],{required:true})+
      input('grossIncome','月税前收入',o.grossIncome,{type:'number',min:0,step:'.01'})+
      input('monthlyNetIncome','预计月到手',o.monthlyNetIncome,{type:'number',min:0,step:'.01'})+
      input('monthlyLivingCost','当地预计月生活费',o.monthlyLivingCost,{type:'number',min:0,step:'.01',help:'含租住、通勤与基本生活。请按城市重新估算。'})+
      input('bonusGuaranteed','已确定奖金',o.bonusGuaranteed,{type:'number',min:0,step:'.01',help:'不确定的奖金不要计入月收入。'})+
      input('probationRate','试用期工资比例（%）',o.probationRate,{type:'number',min:0,max:100,step:1})+
      input('probationMonths','试用期月数',o.probationMonths,{type:'number',min:0,max:6,step:1,help:'无试用期折扣请填 0。'})+
      input('probationNetIncome','试用期预计月到手',o.probationNetIncome,{type:'number',min:0,step:'.01',help:'若已知，优先填实际预计到手。'})+
      input('monthlyCommuteCost','月通勤费用',o.monthlyCommuteCost,{type:'number',min:0,step:'.01'})+
      select('relocationState','搬迁成本信息状态',o.relocationState ?? (o.relocationCost == null ? 'unknown':'knownAmount'),costChoices)+
      input('relocationCost','明确搬迁金额',o.relocationCost,{type:'number',min:0,step:'.01',help:'仅选择“金额已知”时计入计算；其他档位不换算成金额。'})+
      select('switchingState','其他切换成本状态',o.switchingState ?? (o.switchingCost == null ? 'unknown':'knownAmount'),costChoices)+
      input('switchingCost','明确切换金额',o.switchingCost,{type:'number',min:0,step:'.01'})+
      certaintySelect('certainty','岗位与待遇信息确定程度',o.certainty ?? 'rough'))}
    ${formSection('职业价值与时机',
      careerFields(o.careerFacts)+careerOutput(o.careerFacts)+
      textarea('growthReason','岗位材料与成长依据',o.growthReason,{placeholder:'工作名称、岗位职责、技术范围、可积累的履历；只记录材料，不在本地假装语义理解。',help:'MVP 由你核实上方事实后自动计算；文字 / 截图语义分析尚未接入外部服务。'})+
      input('startDate','预计入职日',o.startDate,{type:'date'})+
      input('responseDueDate','最晚答复日',o.responseDueDate,{type:'date'})+
      select('canDelayStart','能否延后入职',String(o.canDelayStart ?? ''),[['true','可以协商'],['false','不能']],{})+
      textarea('risks','主要风险',o.risks,{placeholder:'例如试用期、业务稳定性、工作强度。'})+
      select('reversibility','若不合适，退出成本',o.reversibility,[['low','低'],['medium','中'],['high','高']],{}))}
    ${formSection('上海桥接期限',
      input('bridgeExitDate','桥接强制重新决策日',o.bridgeExitDate || d.bridgeExitDate,{type:'date',help:'上海路线必须在入职后六个月内复盘。'})+
      input('gdSearchRestartDate','重新启动广东求职日',o.gdSearchRestartDate || d.gdSearchRestartDate,{type:'date',help:'至少比桥接重新决策日早 60 天。'}),
      '仅上海岗位需要填写。2027 年 6 月是固定复盘点，实际入职日起六个月也是独立上限。')}
    ${formActions(editingOfferId ? '保存修改并重算' : '保存机会并重算')}
    ${editingOfferId ? '<button type="button" class="text-link" data-action="cancel-edit">取消编辑</button>' : ''}</form>`;
}

function renderTimeline() {
  const items = checkpoints();
  const today = todayISO();
  const list = `<ol class="full-timeline">${items.map(item => `<li><time datetime="${escapeHTML(item.date)}">${escapeHTML(shortDate(item.date))}</time><div><b>${escapeHTML(item.label)} · ${item.type === 'major' ? '重大复盘':'轻检查'}</b><p>${escapeHTML(item.description || '')}</p></div><span class="${item.date < today ? 'past' : item.date === today ? 'today' : ''}">${escapeHTML(relativeDue(item.date))}</span></li>`).join('')}</ol>`;
  const bridge = data.routeDecision?.bridgeExitDate ? `<div class="inline-alert spaced-top">你的上海桥接计划：${escapeHTML(dateLabel(data.routeDecision.gdSearchRestartDate))} 重启广东求职；${escapeHTML(dateLabel(data.routeDecision.bridgeExitDate))} 做强制重新决策。实际入职后的六个月上限仍需单独检查。</div>` : '';
  return pageHeader('时间线', '关键节点提醒') + section('2026 年 9 月 — 2027 年 6 月', `<div class="btn-row calendar-actions"><button type="button" class="btn btn-primary" data-action="export-calendar">下载日历提醒 .ics</button></div>${list}${bridge}<p class="note">导入手机或电脑日历后，日历应用负责到期提醒。站内提醒仅在打开页面时显示。事件标题不含你的财务和关系数据。</p>`);
}
function renderHistory() {
  const formal=[...data.decisions].reverse(),history=[...data.decisionHistory].reverse();
  const decisions=formal.map(d=>`<article class="history-entry"><time>${dateLabel(d.decidedAt)}</time><div><h2>${escapeHTML(STATE_LABELS[d.routeState])}</h2><ul class="plain-list">${d.decisionPremises.map(p=>`<li>${escapeHTML(p.text)}</li>`).join('')}</ul><p>下次重大复盘：${dateLabel(d.nextMajorReviewAt)}</p>${d.manualOverride ? `<p class="warning-note">主动覆盖：${escapeHTML(d.manualOverride.reason)}；${dateLabel(d.manualOverride.nextReviewAt)} 复查。</p>`:''}<details><summary>当时事实、未知和完整依据</summary><pre class="snapshot">${escapeHTML(JSON.stringify({事实:d.facts,未知:d.unknowns,财务:d.recordedBaseline,关系:d.recordedPartnerPlan,机会:d.recordedOffers,系统建议:d.systemSuggestion},null,2))}</pre></details></div></article>`).join('');
  const logs=history.map(d=>`<article class="history-entry"><time>${escapeHTML((d.at || '').replace('T',' ').slice(0,16))}<br />${escapeHTML(d.source)}</time><div><h2>${escapeHTML(STATE_LABELS[d.routeState ?? d.state] ?? d.state)} · ${escapeHTML(d.riskState ?? d.level)}</h2><p>${escapeHTML(d.reasons?.map(r=>r.text ?? r).join('；'))}</p><p>${escapeHTML([...(d.blockers ?? []),...(d.warnings ?? [])].map(r=>r.text).join('；'))}</p></div></article>`).join('');
  return pageHeader('决策档案','保存当时的事实与未知，不用事后结果重写旧理由')+section('我的重大决策',decisions || '<p class="empty">尚未创建正式决策。重大复盘时记录 2–5 条核心前提。</p>')+section('检查与系统判定记录',logs || '<p class="empty">尚无检查记录。</p>');
}

function renderSettings() {
  const c=data.config,entries=checkpoints().map(cp=>input('cp_'+cp.id,cp.label,cp.date,{type:'date',required:true,help:cp.type === 'major' ? '重大复盘':'轻检查'})).join('');
  return pageHeader('设置与数据','个人参考线可以调整，安全门不被路线覆盖绕过')+
  section('规则参考线',`<form id="settings-form"><div class="form-grid">
  ${input('gdMinNetIncome','个人广东收入底线（可未知）',c.gdMinNetIncome,{type:'number',min:0,step:'.01'})}
  ${input('gdMinCareerScore','广东成长参考线（1–5）',c.gdMinCareerScore,{type:'number',min:1,max:5,step:'.1',required:true})}
  ${input('bridgeMinSixMonthGain','上海半年净改善参考线',c.bridgeMinSixMonthGain,{type:'number',min:0,step:1,required:true,help:'不是绝对门槛；职业明确升级也可支撑桥接。'})}
  ${input('bridgeMaxMonths','桥接重新决策上限（月）',c.bridgeMaxMonths,{type:'number',min:1,max:6,step:1,required:true})}
  ${input('maxLongDistanceDays','双方认可异地边界（可未知）',c.maxLongDistanceDays,{type:'number',min:0,max:730,step:1})}
  ${input('driftNoActionDays','求职无动作询问周期（天）',c.driftNoActionDays,{type:'number',min:1,max:90,step:1,required:true})}
  ${input('planVarianceWarningRate','财务偏差提醒比例（%）',Math.round(c.planVarianceWarningRate*100),{type:'number',min:1,max:100,step:1,required:true})}
  </div>${formSection('固定复盘节点',entries)}${formActions('保存设置')}</form>`)+
  section('加密导出（默认）',`<div class="privacy-callout">本机存储仍是明文，加密只保护导出的文件，不防御同源脚本。优先使用独立的 career.1337m4n.beer。关闭浏览器不丢记录，但清理网站数据、换域名或换设备不会自动迁移。导出后保存口令；忘记口令无法恢复。</div><form id="backup-form">${formSection('设置此次备份口令',input('password','口令（至少 12 字符）','',{type:'password',required:true})+input('passwordConfirm','重复口令','',{type:'password',required:true}))}${formActions('下载加密 JSON 备份')}</form><button class="text-link error-note" type="button" data-action="export-backup">明确关闭加密，导出明文（有风险）</button>`)+
  section('导入与本地存储',`<div class="form-grid">${input('import-password','加密备份口令（仅用于本次解密）','',{type:'password',full:true})}</div><div class="btn-row"><label class="btn btn-secondary" for="import-file">选择 JSON 备份</label><input id="import-file" class="visually-hidden" type="file" accept=".json,application/json" /><button class="btn btn-danger" type="button" data-action="clear-data">清空本机数据</button></div><p class="note">导入前先备份当前记录。验证、解密或写入失败不会替换原数据；也支持旧 v1 明文备份迁移。</p>`);
}

function renderRecovery() {
  if (insecureOrigin) {
    app.innerHTML = pageHeader('需要安全连接') + section('暂不能录入个人数据','<p>当前入口不是安全连接。请使用证书有效的 HTTPS 地址；不要绕过浏览器证书警告。原有存档未读取或改写，本页不提供个人数据录入。</p>');
    return;
  }
  app.innerHTML = pageHeader('需要恢复本地数据') + `<section class="section"><div class="inline-alert red">检测到本地存档无法读取。为了避免覆盖原记录，系统已停止自动保存。你可以导入先前备份，或在确认旧记录无法恢复后重新开始。</div><div class="form-grid">${input('import-password','加密备份口令','',{type:'password',full:true})}</div><div class="btn-row"><label class="btn btn-primary" for="import-file">导入 JSON 备份</label><input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" /><button class="btn btn-danger" type="button" data-action="clear-data">删除损坏存档并重建</button></div></section>`;
}
function render() {
  currentView = viewFromHash();
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  if (dataError) { renderRecovery(); return; }
  const pages = { home: renderHome, feedback: renderFeedback, offers: renderOffers, timeline: renderTimeline, history: renderHistory, settings: renderSettings };
  app.innerHTML = pages[currentView]();
  document.title = `${{home:'今日判断',feedback:'填写反馈',offers:'机会比较',timeline:'时间线',history:'决策记录',settings:'设置与数据'}[currentView]} · 路线校准`;
}

function getForm(form) { return Object.fromEntries(new FormData(form)); }
function saveBaseline(form) {
  const v=getForm(form),facts=careerValues(v);
  Object.assign(data.baseline,Object.fromEntries(['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost','contractNoticeDays','bonusAmount'].map(key=>[key,num(v[key])])),{oneOffCostsNext90Days:num(v.oneOffCostsNext90Days) ?? 0,careerFacts:facts,currentRoleGrowth:deriveCareer(facts).score,careerEvidence:v.careerEvidence.trim(),certainty:v.financeCertainty,energyFacts:Object.fromEntries(['workAvoidance','lowMood','restRecovers','affectsLife','expensiveRecovery'].map(key=>[key,bool(v['energy_'+key])])),bonusPayDate:v.bonusPayDate || null});
  data.config.gdMinNetIncome=num(v.gdMinNetIncome);
  data.partnerPlan.sharedDestinationAligned=bool(v.sharedDestinationAligned);
  data.partnerPlan.nextRelationshipReviewAt=v.nextRelationshipReviewAt || null;
  data.profile.targetRoles=v.targetRoles.split(/[、,，]/).map(x=>x.trim()).filter(Boolean);
  addFact('other','更新首次事实基线；未知内容未补成数值。',v.financeCertainty);
  persistWithDecision('首次基线');showView('home');
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
    debtBalance:num(v.debtBalance),cashBalance:num(v.cashBalance),monthlyNetIncome:num(v.monthlyNetIncome),
    monthlyDebtPayment:num(v.monthlyDebtPayment),monthlyLivingCost:num(v.monthlyLivingCost),
    oneOffCostsNext90Days:num(v.oneOffCostsNext90Days) ?? 0, plannedCashBalance:num(v.plannedCashBalance),
    plannedDebtBalance:num(v.plannedDebtBalance), note:v.financeNote.trim() };
  data.checkIns.push(entry);
  addFact('financial','更新当前财务数值；未录入数值仍为未知。');
  for (const key of ['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost','oneOffCostsNext90Days']) data.baseline[key]=entry[key];
  persistWithDecision('每月财务反馈');
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
  persistWithDecision('关系变化');showView('home');
}

function saveResign(form) {
  const v=getForm(form),offer=data.offers.find(o=>o.id === v.offerId);
  if (!offer) throw new Error('请先记录并接受书面 Offer。');
  if ((data.routeDecision.decisionPremises ?? []).length < 2) throw new Error('先做重大复盘，保存选择与至少两条前提，再检查离职。');
  if (data.routeDecision.offerId !== offer.id) throw new Error('这不是你在重大复盘中选择的机会。先更新路线与前提，不用离职表单静默换路线。');
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
  const offer={...existing,id:v.id || uid(),company:v.company.trim(),city:v.city,role:v.role.trim(),workMode:v.workMode,status:v.status,grossIncome:num(v.grossIncome),monthlyNetIncome:num(v.monthlyNetIncome),monthlyLivingCost:num(v.monthlyLivingCost),bonusGuaranteed:num(v.bonusGuaranteed),probationRate:num(v.probationRate),probationMonths:num(v.probationMonths),probationNetIncome:num(v.probationNetIncome),monthlyCommuteCost:num(v.monthlyCommuteCost),relocationState:v.relocationState,switchingState:v.switchingState,relocationCost:v.relocationState === 'knownAmount' ? num(v.relocationCost):null,switchingCost:v.switchingState === 'knownAmount' ? num(v.switchingCost):null,careerFacts:facts,careerScore:score.score,careerAssessment:{...score,method:'observable-facts-v1',assessedAt:new Date().toISOString()},targetAligned:facts.targetFit,growthReason:v.growthReason.trim(),certainty:v.certainty,startDate:v.startDate || null,responseDueDate:v.responseDueDate || null,canDelayStart:bool(v.canDelayStart),risks:v.risks.trim(),reversibility:v.reversibility || null,bridgeExitDate:v.bridgeExitDate || null,gdSearchRestartDate:v.gdSearchRestartDate || null};
  for (const key of ['relocation','switching']) if (offer[key+'State'] === 'knownAmount' && offer[key+'Cost'] == null) throw new Error('选择金额已知后，请填写对应金额；明确没有成本填 0。');
  const critical=['status','company','city','role','workMode','grossIncome','bonusGuaranteed','monthlyNetIncome','monthlyLivingCost','startDate','probationRate','probationMonths','probationNetIncome','relocationCost','switchingCost'];
  if (existing && critical.some(k=>existing[k] !== offer[k])) {offer.termsConfirmed=false;offer.pendingConditionsClear=false;}
  if (existing) Object.assign(existing,offer);else data.offers.push(offer);
  addFact('offer',(existing ? '机会条件更新：':'新增机会：')+offer.company+' / '+offer.role+' / '+offer.city,offer.certainty);
  editingOfferId=null;persistWithDecision(existing ? '修改 Offer（关键条件需重新确认）':'新增 Offer');
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
  data.checkIns.push({id:uid(),type:'light',createdAt:new Date().toISOString(),newFact:v.newFact.trim(),waitReason:v.waitReason.trim(),nextReviewAt:v.nextReviewAt || null});
  persistWithDecision('新事实事件');showView('home');
}
function reviewPremises(v) {
  const ps=data.routeDecision.decisionPremises ?? [];
  if (ps.some(p=>!v['premise_'+p.id])) throw new Error('先逐条确认旧前提的当前状态。');
  for (const p of ps) {
    const status=v['premise_'+p.id];
    if (status === 'invalid' && p.status !== 'invalid') p.invalidSince=todayISO();
    if (status !== 'invalid') delete p.invalidSince;
    p.status=status;p.reviewedAt=todayISO();
  }
  const override=data.routeDecision.manualOverride;
  if (override && !v.overrideStillValid) throw new Error('请复查上次覆盖理由是否仍成立。');
  if (override) {override.stillValid=bool(v.overrideStillValid);override.reviewedAt=todayISO();}
  data.checkIns.push({id:uid(),type:'premise_review',createdAt:new Date().toISOString(),decisionId:data.currentDecisionId,premiseReviews:structuredClone(ps),overrideStillValid:override?.stillValid ?? null});
}
function saveMajor(form) {
  const v=getForm(form),oldDecision=data.routeDecision,d=evaluate(data,todayISO());
  reviewPremises(v);
  const premises=v.premises.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
  if (premises.length < 2 || premises.length > 5) throw new Error('请每行一条，填写 2–5 条新核心前提。');
  if (v.nextMajorReviewAt <= todayISO()) throw new Error('下次重大复盘日需在今天之后。');
  const override=v.manualOverride === 'true',o=data.offers.find(x=>x.id === v.offerId);
  if (['GUANGDONG_READY','SHANGHAI_BRIDGE_READY'].includes(v.routeState)) {
    if (!o || (v.routeState === 'GUANGDONG_READY' ? o.city === '上海':o.city !== '上海')) throw new Error('请选择与路线一致的机会。');
    const assessed=o.city === '上海' ? qualifyShanghaiOffer(o,data):qualifyGuangdongOffer(o,data);
    if (!assessed.qualified && !override) throw new Error('这份机会尚未达到参考条件；如仍决定选它，请记录覆盖理由。');
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
    'relationship-form':saveRelationship,'resign-form':saveResign,'offer-form':saveOffer,'settings-form':saveSettings };
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
    if (action==='no-change') { data.checkIns.push({id:uid(),type:'light',noChange:true,createdAt:new Date().toISOString()}); persistWithDecision('轻检查：无重要变化'); return; }
    if (action==='review-premises') { reviewPremises(getForm(target.closest('form')));persistWithDecision('前提复查');return; }
    if (action==='export-backup') { if (!confirm('明文备份包含你的负债、收入、关系和决策记录。确定关闭导出加密吗？')) return; notice(`备份已下载：${downloadBackup(data)}`); return; }
    if (action==='export-calendar') { downloadCalendar(data); notice('日历文件已下载，请导入你的日历应用'); return; }
    if (action==='clear-data') {
      if (!confirm('此操作会删除当前浏览器的全部路线记录。建议先导出备份。确认删除吗？')) return;
      clearData(); data=createInitialData(); dataError=null; editingOfferId=null; render(); notice('本机数据已清空'); return;
    }
    if (action==='edit-offer') { editingOfferId=target.dataset.id; showView('offers'); document.querySelector('#offer-form')?.scrollIntoView({behavior:'smooth'}); return; }
    if (action==='cancel-edit') { editingOfferId=null; render(); return; }
    if (action==='delete-offer') {
      const offer=data.offers.find(item=>item.id===target.dataset.id);
      if (!offer || !confirm(`删除“${offer.company}”这条机会记录？该操作不能撤销。`)) return;
      data.offers=data.offers.filter(item=>item.id!==offer.id);
      if (data.routeDecision.offerId===offer.id) data.routeDecision={...data.routeDecision,offerId:null,route:null};
      persistWithDecision('删除 Offer'); return;
    }
    if (action==='withdraw-resign') { delete data.intent; persistWithDecision('暂不提离职'); return; }
    if (action==='started') {
      const offer=data.offers.find(item=>item.id===data.routeDecision.offerId);
      if (!offer) throw new Error('请先确认对应的 Offer。');
      data.routeDecision.startedAt=todayISO(); delete data.intent;
      data.routeState=data.routeDecision.route==='shanghai_bridge'?'SHANGHAI_BRIDGE_ACTIVE':'GUANGDONG_MIGRATION';
      persistWithDecision('确认入职'); return;
    }
    if (action==='moved') { data.routeState='GUANGDONG_SETTLING'; data.routeDecision.movedAt=todayISO(); persistWithDecision('确认迁移完成'); return; }
    if (action==='settled') {
      if (daysBetween(data.routeDecision.movedAt || todayISO(),todayISO())<90) throw new Error('迁移后满 90 天再完成本轮适应期复盘。');
      if (!confirm('确认已完成工作、现金流和关系复盘，并结束本轮迁移？')) return;
      data.routeState='STABLE';persistWithDecision('完成适应期复盘');return;
    }
  } catch (error) { data=before;notice(error.message); }
});

document.addEventListener('change',async event=>{
  if (event.target.name?.startsWith('career_')) { const form=event.target.closest('form');const output=form.querySelector('[data-career-output]'); if (output) output.textContent=careerText(deriveCareer(careerValues(getForm(form))));return; }
  if (event.target.id!=='import-file') return;
  const file=event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10000000) throw new Error('备份超过 10 MB 限制。');
    const raw=await decodeBackup(await file.text(),document.querySelector('#import-password')?.value ?? '');
    if (!dataError && !confirm('导入会替换当前浏览器里的全部记录。已导出当前备份吗？确认继续？')) return;
    data=importData(raw);document.querySelector('#import-password')?.setAttribute('value','');dataError=null;editingOfferId=null;render();notice('备份导入成功');
  } catch (error) { notice(`导入失败：${error.message}`); }
  finally { event.target.value=''; }
});

window.addEventListener('hashchange',render);
render();
