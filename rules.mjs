import { CHECKPOINTS, isDate } from './data.mjs';
const DAY = 86400000;
const ACTIVE = new Set(['NOTICE_AND_HANDOVER','SHANGHAI_BRIDGE_ACTIVE','GUANGDONG_MIGRATION','GUANGDONG_SETTLING','STABLE']);
const SEARCH = new Set(['MARKET_TESTING','HOLD_AND_SEARCH','SHANGHAI_BRIDGE_ACTIVE']);
const number = v => typeof v === 'number' && Number.isFinite(v);
const nonnegative = v => number(v) && v >= 0;
const issue = (code,text) => ({code,text});
const days = (a,b) => isDate(a) && isDate(b) ? Math.round((Date.parse(b)-Date.parse(a))/DAY) : null;
const addDays = (d,n) => new Date(Date.parse(d)+n*DAY).toISOString().slice(0,10);
export function addMonths(date,months) {
  const start = new Date(date+'T00:00:00Z'), end = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+months,1));
  end.setUTCDate(Math.min(start.getUTCDate(),new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate()));
  return end.toISOString().slice(0,10);
}
export const CAREER_WEIGHTS = [
  ['technologyDepth','技术深度 / 新能力',25],['responsibility','复杂责任 / 所有权',25],
  ['transferability','跨公司可迁移性',20],['targetFit','长期方向匹配',20],['outcomes','可证明的履历成果',10],
];
export function deriveCareer(facts = {}) {
  const known = CAREER_WEIGHTS.filter(([key])=>typeof facts[key] === 'boolean');
  // ponytail: Only confirmed questionnaire facts; semantic text/screenshot analysis requires a separately authorized service.
  if (known.length !== 5) return {band:'UNKNOWN',score:null,points:null,coverage:known.length,total:5};
  const points = known.reduce((sum,[key,,weight])=>sum+(facts[key] ? weight:0),0);
  return {band:points >= 70 ? 'HIGH':points >= 40 ? 'MEDIUM':'LOW',score:Math.round((1+points/25)*10)/10,points,coverage:5,total:5};
}
export function deriveEnergy(f = {}) {
  if (f.affectsLife === true || (f.restRecovers === false && f.workAvoidance === true && f.lowMood === true)) return 'HIGH_RISK';
  if (f.workAvoidance === true || f.lowMood === true || f.restRecovers === false || f.expensiveRecovery === true) return 'STRAINED';
  return ['workAvoidance','lowMood','restRecovers','affectsLife'].every(k=>typeof f[k] === 'boolean') ? 'STABLE':'UNKNOWN';
}
export function bridgeRenewalErrors(v,today) {
  const errors=[];
  if (!['project','income','market','other'].includes(v.renewalEvidenceType) || !['confirmed','likely'].includes(v.evidenceCertainty) || typeof v.newEvidence !== 'string' || v.newEvidence.trim().length < 12) errors.push('需新的项目、收入、市场或重要事实证据；旧习惯、奖金不能单独续期。');
  if (!isDate(v.bridgeExitDate) || v.bridgeExitDate <= today || v.bridgeExitDate > addMonths(today,6) || !isDate(v.gdSearchRestartDate) || days(v.gdSearchRestartDate,v.bridgeExitDate) < 60) errors.push('新重新决策日需在六个月内，求职重启提前至少 60 天。');
  if (!isDate(v.nextMajorReviewAt) || v.nextMajorReviewAt <= today || v.nextMajorReviewAt > v.bridgeExitDate) errors.push('重大复盘日需在今天之后且不晚于桥接重新决策日。');
  return errors;
}
function careerScore(item) {
  if (item?.careerFacts && Object.keys(item.careerFacts).length) return deriveCareer(item.careerFacts).score;
  return number(item?.careerScore) ? item.careerScore:item?.currentRoleGrowth;
}
export function financialCapacity(data) {
  const b = data.baseline ?? {};
  const required = nonnegative(b.monthlyDebtPayment) && nonnegative(b.monthlyLivingCost) ? b.monthlyDebtPayment+b.monthlyLivingCost:null;
  const monthlyBalance = required !== null && nonnegative(b.monthlyNetIncome) ? b.monthlyNetIncome-required:null;
  const available = nonnegative(b.cashBalance) && nonnegative(b.oneOffCostsNext90Days) ? b.cashBalance-b.oneOffCostsNext90Days:null;
  return {required,monthlyBalance,available,stress:required === null || available === null ? 'UNKNOWN':available < required ? 'UNAFFORDABLE':available < required*1.2 ? 'TIGHT':'COVERED'};
}
export function validateBaseline(data) {
  const missing = ['debtBalance','cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost'].filter(k=>!nonnegative(data?.baseline?.[k])).map(k=>'baseline.'+k);
  return {valid:missing.length === 0,missing};
}
export function offerMoney(o,data) {
  const current = financialCapacity(data), living = o?.monthlyLivingCost, payment = data.baseline?.monthlyDebtPayment;
  const monthlyBalance = nonnegative(o?.monthlyNetIncome) && nonnegative(living) && nonnegative(payment) ? o.monthlyNetIncome-living-payment:null;
  const improvement = monthlyBalance !== null && current.monthlyBalance !== null ? monthlyBalance-current.monthlyBalance:null;
  const threshold = Math.max(1000,(data.baseline?.monthlyNetIncome ?? 0)*0.1);
  const trend = improvement === null ? 'UNKNOWN':improvement >= threshold ? 'IMPROVED':improvement <= -threshold ? 'WORSE':'SIMILAR';
  const costsKnown = nonnegative(o?.relocationCost) && nonnegative(o?.switchingCost);
  const probationKnown = o?.probationMonths === 0 || (nonnegative(o?.probationMonths) && (nonnegative(o?.probationNetIncome) || nonnegative(o?.probationRate)));
  const probationIncome = nonnegative(o?.probationNetIncome) ? o.probationNetIncome:nonnegative(o?.probationRate) ? o.monthlyNetIncome*o.probationRate/100:null;
  const probationBalance = o?.probationMonths > 0 && probationIncome !== null && nonnegative(living) && nonnegative(payment) ? probationIncome-living-payment:monthlyBalance;
  const sixMonthNetGain = improvement !== null && costsKnown && probationKnown ? 6*improvement-o.relocationCost-o.switchingCost-Math.min(6,o.probationMonths)*(o.monthlyNetIncome-(probationIncome ?? o.monthlyNetIncome)):null;
  return {monthlyBalance,improvement,trend,costsKnown,probationKnown,probationBalance,sixMonthNetGain,affordable:monthlyBalance !== null && monthlyBalance >= 0 && current.available !== null && current.available >= 0 && (probationBalance === null || probationBalance >= 0)};
}
function offerAssessment(o,data,kind) {
  const reasons = [], warnings = [], m = offerMoney(o,data), score = careerScore(o), prior = careerScore(data.baseline), code = kind === 'gd' ? 'R02':'R03';
  if (!['written','accepted'].includes(o?.status)) reasons.push(issue(code,'可比较口头机会；进入 READY 前需书面 Offer。'));
  if ((o?.careerFacts?.targetFit ?? o?.targetAligned) !== true) reasons.push(issue(code,'长期方向匹配尚未确认。'));
  if (!m.affordable) reasons.push(issue(code,m.monthlyBalance === null ? '当地或当前必要支出尚未知，需确认基本承受能力。':'必要现金流尚不可承受。'));
  if (!m.costsKnown) warnings.push(issue('U01','搬迁 / 切换成本未知：不否决路线，离职前需确认。'));
  if (!m.probationKnown) warnings.push(issue('U02','试用期待遇未知，离职前需确认。'));
  if (!isDate(o?.startDate)) warnings.push(issue('U03','入职日未知，离职前需确认。'));
  if (kind === 'gd') {
    if (!(data.profile?.targetCities ?? ['广州','深圳']).includes(o?.city) && o?.city !== '广东其他') reasons.push(issue(code,'不在广东目标城市范围。'));
    if (!number(score) || score < (data.config?.gdMinCareerScore ?? 3)) reasons.push(issue(code,'职业事实不足或未达到个人成长参考线。'));
    if (data.config?.gdMinNetIncome > 0 && (!number(o?.monthlyNetIncome) || o.monthlyNetIncome < data.config.gdMinNetIncome)) reasons.push(issue(code,'低于你已确认的广东收入底线。'));
    if (m.trend === 'WORSE') reasons.push(issue(code,'必要现金流明显恶化，需重新比较或记录例外。'));
  } else {
    if (o?.city !== '上海') reasons.push(issue(code,'桥接岗位必须在上海。'));
    const upgraded = number(score) && score >= 3.8 && (!number(prior) || score-prior >= 1);
    const nonregression = number(score) && number(prior) && score >= prior;
    if (!((m.trend === 'IMPROVED' && nonregression && (m.sixMonthNetGain === null || m.sixMonthNetGain > 0)) || (upgraded && m.affordable))) reasons.push(issue(code,'需财务明显改善且职业不退步，或职业明显升级且财务可承受。'));
    const review = o?.bridgeExitDate ?? data.routeDecision?.bridgeExitDate, restart = o?.gdSearchRestartDate ?? data.routeDecision?.gdSearchRestartDate;
    if (!isDate(review) || !isDate(o?.startDate) || review <= o.startDate || review > addMonths(o.startDate,data.config?.bridgeMaxMonths ?? 6)) reasons.push(issue(code,'需入职后六个月内的重新决策日，不是强制离职日。'));
    if (!isDate(restart) || !isDate(review) || days(restart,review) < 60) reasons.push(issue(code,'广东求职重启需早于重新决策日至少 60 天。'));
    if (number(m.sixMonthNetGain) && m.sixMonthNetGain < (data.config?.bridgeMinSixMonthGain ?? 30000)) warnings.push(issue('B02','半年净改善低于参考线；明确职业升级仍可支撑桥接。'));
  }
  return {qualified:reasons.length === 0,reasons,warnings,careerScore:score,...m};
}
export const qualifyGuangdongOffer = (o,data)=>offerAssessment(o,data,'gd');
export const qualifyShanghaiOffer = (o,data)=>offerAssessment(o,data,'sh');
export function resignBlockers(o,data,today) {
  const b = [];
  if (o?.status !== 'accepted') b.push(issue('R01','必须正式接受书面 Offer。'));
  if (o?.termsConfirmed !== true) b.push(issue('R01','需确认薪资、岗位、地点、入职日和试用期条款。'));
  if (o?.pendingConditionsClear !== true) b.push(issue('R01','背调 / 审批等剩余条件尚未确认可接受。'));
  if (!isDate(o?.startDate)) b.push(issue('R01','入职日未确认。'));
  const notice = data.baseline?.contractNoticeDays;
  if (!(o?.noticeAgreementConfirmed === true || (nonnegative(notice) && isDate(o?.startDate) && days(today,o.startDate) >= notice && nonnegative(data.baseline?.availableHandoverDays) && data.baseline.availableHandoverDays >= notice))) b.push(issue('NOTICE_CONFLICT','通知期与入职 / 交接窗口未确认一致，先协商。'));
  const m = offerMoney(o,data), base = financialCapacity(data);
  if (!m.costsKnown || !m.probationKnown || !nonnegative(o?.transitionIncomeGapMonths)) b.push(issue('F02','离职前需确认切换成本、试用期和收入空档；未知不能当作 0。'));
  const required = nonnegative(o?.monthlyLivingCost) && nonnegative(data.baseline?.monthlyDebtPayment) ? o.monthlyLivingCost+data.baseline.monthlyDebtPayment:null;
  const liquidity = base.available !== null && m.costsKnown && nonnegative(o?.transitionIncomeGapMonths) && base.required !== null ? base.available-o.relocationCost-o.switchingCost-o.transitionIncomeGapMonths*base.required:null;
  if (!m.affordable || liquidity === null || required === null || liquidity < Math.max(required,Math.max(0,-(m.probationBalance ?? 0))*3)) b.push(issue('F01','切换后的必要支出安全垫尚未通过；一个月压力测试不是离职许可。'));
  return b;
}
function lastSearchDate(data) {
  const dates = (data.checkIns ?? []).filter(r=>r.type === 'market' && !r.noChange && ['gdApplications','shApplications','gdInterviews','shInterviews','gdFinals','shFinals'].some(k=>r[k] > 0)).map(r=>r.searchActionAt ?? r.createdAt?.slice(0,10)).filter(isDate);
  if (isDate(data.lastSearchActionAt)) dates.push(data.lastSearchActionAt);
  return dates.sort().at(-1) ?? (isDate(data.profile?.startDate) ? [data.profile.startDate,'2026-10-11'].sort().at(-1):null);
}
function warningsFor(data,today) {
  const w = [], p = data.partnerPlan ?? {}, r = data.routeDecision ?? {}, state = data.routeState, f = financialCapacity(data);
  if (p.sharedDestinationAligned === false) w.push({code:'R06',level:'yellow',text:'共同方向不一致，先讨论方向，不强求同日离职。'});
  else if (isDate(p.longDistanceStartDate) && p.longDistanceStartDate <= today && !isDate(p.reunionDate)) {
    const progressing = p.sharedDestinationAligned === true && isDate(p.nextRelationshipReviewAt) && p.nextRelationshipReviewAt >= today;
    w.push({code:'R06',level:progressing ? 'info':'yellow',text:progressing ? '汇合日未知，但共同方向和下次讨论节点仍在推进。':'异地已开始且缺少下一次讨论节点，请约定复盘。'});
  } else if (!isDate(p.reunionDate)) w.push({code:'R06',level:'info',text:'精确迁移日期未知，不自动判为偏航。'});
  if (isDate(p.reunionDate) && isDate(p.longDistanceStartDate) && nonnegative(data.config?.maxLongDistanceDays) && days(p.longDistanceStartDate,p.reunionDate) > data.config.maxLongDistanceDays) w.push({code:'R06',level:'yellow',text:'异地计划超过双方认可边界，需要共同复查。'});
  if (f.available !== null && f.monthlyBalance !== null && f.available+Math.min(0,f.monthlyBalance)*2 < 0) w.push({code:'F01',level:'red',text:'现金无法覆盖未来两个月必要缺口，应立即制定应对方案。'});
  else if (['UNAFFORDABLE','TIGHT'].includes(f.stress)) w.push({code:'F04',level:'yellow',text:'一个月无工资压力测试：'+(f.stress === 'TIGHT' ? '紧张。':'无法覆盖必要支出。')});
  const last = lastSearchDate(data), cycle = data.config?.driftNoActionDays ?? 14;
  const searching = SEARCH.has(state) && (state !== 'SHANGHAI_BRIDGE_ACTIVE' || (isDate(r.gdSearchRestartDate) && today >= r.gdSearchRestartDate));
  if (searching && isDate(last) && days(last,today) >= cycle) {
    const reviews = (data.checkIns ?? []).filter(x=>x.type === 'market' && x.searchPauseReason && x.createdAt?.slice(0,10) > last).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)), latest = reviews.at(-1);
    const reasonable = latest && ['planned','work','health','waiting','no_roles','other'].includes(latest.searchPauseReason) && isDate(latest.pauseReviewAt) && latest.pauseReviewAt >= today && (latest.searchPauseReason !== 'other' || latest.pauseNote?.trim());
    const repeated = reviews.length >= 2 && days(reviews[0].createdAt.slice(0,10),latest.createdAt.slice(0,10)) >= cycle;
    w.push({code:'D01',level:reasonable && !repeated ? 'info':latest ? 'yellow':'info',text:!latest ? cycle+' 天无动作：先记录原因，不直接判偏航。':reasonable && !repeated ? '已有合理暂停原因与复查日，不判偏航。':'暂停跨多个周期或没有可复查原因，需要缩小下一步。'});
  }
  const recent = (data.checkIns ?? []).filter(x=>x.type === 'market').slice(-2);
  if (recent.length === 2 && recent.every(x=>x.waitReason?.trim())) w.push({code:'D03',level:'yellow',text:'连续出现“再等等”，请核对新的未来收益证据。'});
  if (deriveEnergy(data.baseline?.energyFacts) === 'HIGH_RISK' || data.healthSafetyAffected) w.push({code:'E01',level:'yellow',text:'工作体验显示生活受到明显消耗，建议缩短复盘周期；并非医疗判断。'});
  const finance = (data.checkIns ?? []).filter(x=>x.type === 'finance').at(-1);
  if (finance && ['CashBalance','DebtBalance'].some(k=>finance['planned'+k] > 0 && nonnegative(finance[k[0].toLowerCase()+k.slice(1)]) && Math.abs(finance[k[0].toLowerCase()+k.slice(1)]-finance['planned'+k])/finance['planned'+k] > (data.config?.planVarianceWarningRate ?? 0.1))) w.push({code:'D02',level:'yellow',text:'财务事实偏离原计划，需要复查。'});
  const premises = r.decisionPremises ?? [], invalid = premises.filter(x=>x.importance !== 'supporting' && x.status === 'invalid');
  if (invalid.length) {
    const at = invalid.map(x=>x.invalidSince ?? x.reviewedAt).filter(isDate).sort()[0];
    w.push({code:'P01',level:invalid.length >= Math.ceil(premises.length/2) && isDate(at) && days(at,today) >= 28 ? 'red':'yellow',text:invalid.length+' 条核心前提失效，原路线需用新事实重新证明。'});
  } else if (premises.some(x=>['partially_valid','unknown'].includes(x.status))) w.push({code:'P02',level:'yellow',text:'部分前提不再完全成立或未知，需要重大复盘。'});
  if (r.manualOverride && (r.manualOverride.stillValid === false || (isDate(r.manualOverride.nextReviewAt) && today >= r.manualOverride.nextReviewAt))) w.push({code:'O02',level:'yellow',text:'上次覆盖建议的理由已失效或到复查日。'});
  if (data.currentDecisionId && isDate(r.nextMajorReviewAt) && today >= r.nextMajorReviewAt) w.push({code:'T01',level:'yellow',text:'重大复盘日已到，先复查前提，不自动离职。'});
  return w;
}
function knowledge(data) {
  const facts = [...(data.facts ?? [])], b = data.baseline ?? {}, unknowns = [];
  for (const key of ['cashBalance','debtBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost']) facts.push({type:'financial',value:key+': '+(b[key] ?? '未知'),certainty:b[key] == null ? 'unknown':(b.certainty ?? 'confirmed')});
  if (!data.partnerPlan?.moveTimeValue) unknowns.push('对方精确迁移时间未知，不否决路线。');
  for (const o of data.offers ?? []) {
    if (!nonnegative(o.relocationCost)) unknowns.push((o.company || '机会')+'：搬迁成本未知，离职前需确认。');
    if (careerScore(o) == null) unknowns.push((o.company || '机会')+'：职业事实尚不完整。');
  }
  return {facts,unknowns,evidenceCounts:{confirmed:facts.filter(f=>f.certainty === 'confirmed').length,estimates:facts.filter(f=>['rough','likely'].includes(f.certainty)).length,unknown:facts.filter(f=>f.certainty === 'unknown').length+unknowns.length}};
}
export function evaluate(data,today) {
  if (!isDate(today)) throw new TypeError('today must be YYYY-MM-DD');
  const r = data.routeDecision ?? {}, actual = data.routeState ?? data.currentState ?? 'BASELINE_SETUP', offers = data.offers ?? [];
  const gd = offers.filter(o=>qualifyGuangdongOffer(o,data).qualified), sh = offers.filter(o=>qualifyShanghaiOffer(o,data).qualified);
  const suggestedRoute = gd.length && sh.length ? 'ROUTE_CHOICE_REQUIRED':gd.length ? 'GUANGDONG_READY':sh.length ? 'SHANGHAI_BRIDGE_READY':!validateBaseline(data).valid ? 'BASELINE_SETUP':today < (data.config?.checkpointOverrides?.december_decision ?? '2026-12-15') && actual !== 'HOLD_AND_SEARCH' ? 'MARKET_TESTING':'HOLD_AND_SEARCH';
  const routeState = ACTIVE.has(actual) || data.currentDecisionId ? actual:suggestedRoute;
  const selected = offers.find(o=>o.id === r.offerId), blockers = data.intent === 'resign' ? resignBlockers(selected,data,today):[], warnings = warningsFor({...data,routeState},today);
  const fixedBridgeDate = data.config?.checkpointOverrides?.bridge_review ?? '2027-06-01';
  const dueBridge = routeState === 'SHANGHAI_BRIDGE_ACTIVE' && ((isDate(r.bridgeExitDate) && today >= r.bridgeExitDate) || (today >= fixedBridgeDate && (!isDate(r.decidedAt) || r.decidedAt < fixedBridgeDate)));
  if (dueBridge) warnings.push({code:'R09',level:'yellow',text:'上海桥接已到强制重新决策日；旧理由不能自动续期，也不要求裸辞。'});
  const riskState = blockers.length ? 'BLOCKED':warnings.some(w=>w.level === 'red') ? 'RED':warnings.some(w=>w.level === 'yellow') ? 'YELLOW':'GREEN';
  const reasons = suggestedRoute === 'ROUTE_CHOICE_REQUIRED' ? [issue('R04','两地路线均成立：并列比较，由你选择，不按代码顺序选。')]:gd.length ? [issue('R02','广东满足职业和基本财务条件；未知成本在行动前确认。')]:sh.length ? [issue('R03','上海满足双维度准入；30,000 元仅为参考线。')]:[issue('R01','没有已达条件的书面机会，保留收入与选择权并继续验证。')];
  for (const o of [...gd,...sh]) warnings.push(...(o.city === '上海' ? qualifyShanghaiOffer(o,data):qualifyGuangdongOffer(o,data)).warnings.map(w=>({...w,level:'info'})));
  if (gd.some(o=>data.baseline?.bonusAmount > 0 && isDate(data.baseline?.bonusPayDate) && isDate(o.startDate) && o.startDate < data.baseline.bonusPayDate && o.canDelayStart === false)) reasons.push(issue('R05','等待奖金会错过合格机会；奖金不覆盖长期路线。'));
  const requiresRedecision = dueBridge || warnings.some(w=>['P01','P02','O02','T01'].includes(w.code));
  const nextDates = [addDays(today,['RED','BLOCKED'].includes(riskState) ? 1:7),r.nextMajorReviewAt,r.manualOverride?.nextReviewAt,data.partnerPlan?.nextRelationshipReviewAt,r.gdSearchRestartDate,r.bridgeExitDate,...(data.checkIns ?? []).map(c=>c.nextReviewAt ?? c.pauseReviewAt),...CHECKPOINTS.map(cp=>data.config?.checkpointOverrides?.[cp.id] ?? cp.date),...offers.map(o=>o.responseDueDate)].filter(d=>isDate(d) && d > today).sort();
  const actions = blockers.length ? blockers.slice(0,3).map(b=>({text:b.text,dueDate:today})):requiresRedecision ? [{text:'逐条复查原前提，用新事实做一次重大决策。',dueDate:today}]:[{text:suggestedRoute === 'ROUTE_CHOICE_REQUIRED' ? '比较两地机会，保存选择与 2–5 条前提。':'记录新事实，或完成“无重要变化”轻检查。',dueDate:addDays(today,7)}];
  return {routeState,riskState,suggestedRoute,state:routeState,level:riskState === 'GREEN' ? 'green':['RED','BLOCKED'].includes(riskState) ? 'red':'yellow',reasons,warnings,blockers,actions,nextCheckAt:nextDates[0],requiresRedecision,premiseReview:r.decisionPremises ?? [],candidates:{guangdong:gd.map(o=>o.id),shanghai:sh.map(o=>o.id)},finance:financialCapacity(data),...knowledge(data),changingConditions:['出现符合职业与基本财务要求的新书面 Offer','原核心前提失效，或出现新的未来收益证据','收入、关系方向或工作体验出现明显变化']};
}
