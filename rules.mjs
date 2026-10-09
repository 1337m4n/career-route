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
  ['technologyDepth','能学到新的技术',25],['responsibility','能独立负责更重要的工作',25],
  ['transferability','这些经验到别的公司也用得上',20],['targetFit','符合我长期想做的工作',20],['outcomes','能做出写进简历的成果',10],
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
  if (!['project','income','market','other'].includes(v.renewalEvidenceType) || !['confirmed','likely'].includes(v.evidenceCertainty) || typeof v.newEvidence !== 'string' || v.newEvidence.trim().length < 12) errors.push('请写明继续留上海的新好处，例如新项目、新收入或广东招聘情况变化。');
  if (!isDate(v.bridgeExitDate) || v.bridgeExitDate <= today || v.bridgeExitDate > addMonths(today,6) || !isDate(v.gdSearchRestartDate) || v.gdSearchRestartDate < today || days(v.gdSearchRestartDate,v.bridgeExitDate) < 60) errors.push('再次决定去向的日期需在未来六个月内；重新投广东岗位不能早于今天，并需至少提前 60 天。');
  if (!isDate(v.nextMajorReviewAt) || v.nextMajorReviewAt <= today || v.nextMajorReviewAt > v.bridgeExitDate) errors.push('下次看计划的日期需在今天之后，并且不晚于最晚重新决定去向的日期。');
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
function offerAssessment(o,data,kind,today) {
  const reasons = [], warnings = [], m = offerMoney(o,data), score = careerScore(o), prior = careerScore(data.baseline), code = kind === 'gd' ? 'R02':'R03';
  if (!['written','accepted'].includes(o?.status)) reasons.push(issue(code,'口头录用消息可以先比较；准备换工作前，需要书面录用通知。'));
  if (isDate(today) && isDate(o?.responseDueDate) && o.responseDueDate < today && o.status !== 'accepted') reasons.push(issue('R08','书面机会答复期限已过，先向公司重新确认是否仍有效。'));
  if (isDate(today) && isDate(o?.startDate) && o.startDate < today) reasons.push(issue('R08','原定入职日已过，先确认并更新入职安排。'));
  if ((o?.careerFacts?.targetFit ?? o?.targetAligned) !== true) reasons.push(issue(code,'还没确认这个岗位是否符合你长期想做的工作。'));
  if (!m.affordable) reasons.push(issue(code,m.monthlyBalance === null ? '当地或当前必要支出尚未知，请先补齐工资、月供和生活费。':'工资还不够还贷和生活。'));
  if (!m.costsKnown) warnings.push(issue('U01','搬迁 / 换工作费用未知：不否决去向，离职前需确认。'));
  if (!m.probationKnown) warnings.push(issue('U02','试用期待遇未知，离职前需确认。'));
  if (!isDate(o?.startDate)) warnings.push(issue('U03','入职日未知，离职前需确认。'));
  if (kind === 'gd') {
    if (!(data.profile?.targetCities ?? ['广州','深圳']).includes(o?.city) && o?.city !== '广东其他') reasons.push(issue(code,'不在广东目标城市范围。'));
    if (!number(score) || score < (data.config?.gdMinCareerScore ?? 3)) reasons.push(issue(code,'工作成长情况不足或未达到个人成长分数要求。'));
    if (data.config?.gdMinNetIncome > 0 && (!number(o?.monthlyNetIncome) || o.monthlyNetIncome < data.config.gdMinNetIncome)) reasons.push(issue(code,'低于你已确认的广东收入底线。'));
    if (m.trend === 'WORSE') reasons.push(issue(code,'工资扣掉还贷和生活费后，剩的钱明显变少，需重新比较或记录例外。'));
  } else {
    if (o?.city !== '上海') reasons.push(issue(code,'过渡岗位必须在上海。'));
    const upgraded = number(score) && score >= 3.8 && (!number(prior) || score-prior >= 1);
    const nonregression = number(score) && number(prior) && score >= prior;
    if (!((m.trend === 'IMPROVED' && nonregression && (m.sixMonthNetGain === null || m.sixMonthNetGain > 0)) || (upgraded && m.affordable))) reasons.push(issue(code,'上海过渡需要满足一项：每月剩的钱更多、工作成长不变差；或者工作成长明显提高、工资够还贷和生活。'));
    const review = o?.bridgeExitDate ?? data.routeDecision?.bridgeExitDate, restart = o?.gdSearchRestartDate ?? data.routeDecision?.gdSearchRestartDate;
    if (!isDate(review) || !isDate(o?.startDate) || review <= o.startDate || review > addMonths(o.startDate,data.config?.bridgeMaxMonths ?? 6)) reasons.push(issue(code,'请选一个入职后六个月内的日期，重新决定是否继续留上海。'));
    if (!isDate(restart) || !isDate(review) || !isDate(o?.startDate) || restart < o.startDate || days(restart,review) < 60) reasons.push(issue(code,'重新投广东岗位的日期要在入职后，并比再次决定去向的日期至少早 60 天。'));
    if (number(m.sixMonthNetGain) && m.sixMonthNetGain < (data.config?.bridgeMinSixMonthGain ?? 30000)) warnings.push(issue('B02','半年比现在多剩的钱低于参考线；明确职业升级仍可支撑过渡。'));
  }
  return {qualified:reasons.length === 0,reasons,warnings,careerScore:score,...m};
}
export const qualifyGuangdongOffer = (o,data,today=null)=>offerAssessment(o,data,'gd',today);
export const qualifyShanghaiOffer = (o,data,today=null)=>offerAssessment(o,data,'sh',today);
export function routeTendencies(data,today=null) {
  if (!validateBaseline(data).valid) return [];
  const current = financialCapacity(data);
  const ranked = (data.offers ?? []).filter(o=>['verbal','written','accepted'].includes(o.status) && (o.city === '上海' || o.city === '广东其他' || (data.profile?.targetCities ?? []).includes(o.city))).map(o=>{
    const shanghai = o.city === '上海', assessment = shanghai ? qualifyShanghaiOffer(o,data,today):qualifyGuangdongOffer(o,data,today);
    const career = o.targetAligned === true && number(assessment.careerScore) ? Math.round(25*assessment.careerScore/5):0;
    const finance = assessment.affordable ? 20:assessment.monthlyBalance !== null && assessment.monthlyBalance >= 0 ? 10:0;
    const bridgePlan = isDate(o.startDate) && isDate(o.bridgeExitDate) && o.bridgeExitDate > o.startDate && o.bridgeExitDate <= addMonths(o.startDate,data.config?.bridgeMaxMonths ?? 6) && isDate(o.gdSearchRestartDate) && o.gdSearchRestartDate >= o.startDate && days(o.gdSearchRestartDate,o.bridgeExitDate) >= 60;
    const plan = shanghai ? bridgePlan:((data.profile?.targetCities ?? []).includes(o.city) || o.city === '广东其他');
    const score = (o.status === 'accepted' ? 20:o.status === 'written' ? 15:5)+career+finance+(plan ? 20:0)+(assessment.qualified ? 15:0);
    const checked = [current.stress !== 'UNKNOWN' && validateBaseline(data).valid,['written','accepted'].includes(o.status),['confirmed','likely'].includes(o.certainty),deriveCareer(o.careerFacts).coverage === 5,assessment.monthlyBalance !== null,assessment.costsKnown && assessment.probationKnown,typeof data.partnerPlan?.sharedDestinationAligned === 'boolean'].filter(Boolean).length;
    return {id:o.id,company:o.company,city:o.city,route:shanghai ? '上海过渡':'直接广东',score,qualified:assessment.qualified,reason:assessment.reasons[0]?.text ?? null,confidence:Math.round(checked/7*100),checked};
  }).sort((a,b)=>b.score-a.score);
  const best = new Map();
  for (const item of ranked) if (!best.has(item.route)) best.set(item.route,item);
  return [...best.values()].slice(0,2);
}
function exitFinance(o,data) {
  const m = offerMoney(o,data), base = financialCapacity(data);
  const required = nonnegative(o?.monthlyLivingCost) && nonnegative(data.baseline?.monthlyDebtPayment) ? o.monthlyLivingCost+data.baseline.monthlyDebtPayment:null;
  const liquidity = base.available !== null && m.costsKnown && nonnegative(o?.transitionIncomeGapMonths) && base.required !== null ? base.available-o.relocationCost-o.switchingCost-o.transitionIncomeGapMonths*base.required:null;
  return {m,unsafe:!m.affordable || liquidity === null || required === null || liquidity < Math.max(required,Math.max(0,-(m.probationBalance ?? 0))*3)};
}
function readyOfferIssue(data,today) {
  const state = data.routeState ?? data.currentState;
  const notice = state === 'NOTICE_AND_HANDOVER';
  if (!notice && (!data.currentDecisionId || !['GUANGDONG_READY','SHANGHAI_BRIDGE_READY'].includes(state))) return null;
  const r = data.routeDecision ?? {}, selected = (data.offers ?? []).find(o=>o.id === r.offerId);
  if (!selected) return issue('P03','已选去向所依赖的机会不存在，请重新考虑这个选择。');
  if (notice && !['shanghai_bridge','guangdong'].includes(r.route)) return issue('P03','交接期原去向未记录，需确认当前机会与去哪个城市。');
  const shanghai = notice ? r.route === 'shanghai_bridge':state === 'SHANGHAI_BRIDGE_READY';
  if (shanghai ? selected.city !== '上海' : !((data.profile?.targetCities ?? ['广州','深圳']).includes(selected.city) || selected.city === '广东其他')) return issue('P03','已选机会与原去向的城市不一致，请重新考虑这个选择。');
  const assessment = shanghai ? qualifyShanghaiOffer(selected,data,today):qualifyGuangdongOffer(selected,data,today);
  const override = r.manualOverride, snapshot = (data.decisions ?? []).find(d=>d.id === data.currentDecisionId)?.recordedOffers?.find(o=>o.id === selected.id);
  const fields = ['company','city','role','workMode','grossIncome','bonusGuaranteed','targetAligned','careerScore','monthlyNetIncome','monthlyLivingCost','startDate','responseDueDate','bridgeExitDate','gdSearchRestartDate','probationRate','probationMonths','probationNetIncome','relocationCost','switchingCost'];
  const unchanged = snapshot && fields.every(k=>snapshot[k] === selected[k]) && CAREER_WEIGHTS.every(([k])=>snapshot.careerFacts?.[k] === selected.careerFacts?.[k]);
  if (notice && (selected.status !== 'accepted' || selected.termsConfirmed !== true || selected.pendingConditionsClear !== true || !assessment.costsKnown || !assessment.probationKnown || exitFinance(selected,data).unsafe || !unchanged)) return issue('P03','交接期间，岗位条件或备用现金发生变化，请先和新公司确认，再考虑是否调整计划。');
  if (assessment.qualified) return null;
  const expired = isDate(today) && ((isDate(selected.startDate) && selected.startDate < today) || (selected.status !== 'accepted' && isDate(selected.responseDueDate) && selected.responseDueDate < today));
  if (unchanged && override?.stillValid !== false && isDate(override?.nextReviewAt) && override.nextReviewAt > today && assessment.affordable && !expired && ['written','accepted'].includes(selected.status)) return null;
  return issue('P03','已选机会不再满足去向条件，需依据新事实重新考虑去向；已记录的职业例外不能代替安全检查。');
}
export function resignBlockers(o,data,today) {
  const b = [];
  const routeIssue = readyOfferIssue(data,today);
  if (routeIssue) b.push(routeIssue);
  if (data.currentDecisionId && ['GUANGDONG_READY','SHANGHAI_BRIDGE_READY'].includes(data.routeState) && o?.id !== data.routeDecision?.offerId) b.push(issue('P03','离职机会与正式选择不一致，请先确认你到底选择哪份工作。'));
  const reviewWarnings = warningsFor(data,today);
  if (reviewWarnings.some(w=>['P01','P02','O02','T01'].includes(w.code))) b.push(issue('P04','重要条件或这样选择的理由需要重新考虑去向，先更新正式选择。'));
  if (reviewWarnings.some(w=>w.code === 'U04')) b.push(issue('U04','新的变化还没填进收入、岗位或女朋友安排中，暂不建议按旧资料提离职。'));
  if (!validateBaseline(data).valid) b.push(issue('F03','离职前请填全现金、负债、工资、月供和生活费。'));
  if (o?.status !== 'accepted') b.push(issue('R01','必须正式接受书面录用通知。'));
  if (o?.termsConfirmed !== true) b.push(issue('R01','需确认薪资、岗位、地点、入职日和试用期条款。'));
  if (o?.pendingConditionsClear !== true) b.push(issue('R01','请先确认背调、审批等还有没有问题。'));
  if (!isDate(o?.startDate)) b.push(issue('R01','入职日未确认。'));
  else if (o.startDate < today) b.push(issue('R08','原定入职日已过，离职前需与新公司确认并更新。'));
  const notice = data.baseline?.contractNoticeDays;
  if (!(o?.noticeAgreementConfirmed === true || (nonnegative(notice) && isDate(o?.startDate) && days(today,o.startDate) >= notice && nonnegative(data.baseline?.availableHandoverDays) && data.baseline.availableHandoverDays >= notice))) b.push(issue('NOTICE_CONFLICT','合同要求的离职提前通知天数，和新公司入职日期可能冲突，请先和两家公司确认。'));
  const {m,unsafe} = exitFinance(o,data);
  if (!m.costsKnown || !m.probationKnown || !nonnegative(o?.transitionIncomeGapMonths)) b.push(issue('F02','离职前需确认换工作费用、试用期和收入空档；未知不能当作 0。'));
  if (unsafe) b.push(issue('F01','扣掉搬家、换工作和没工资期间的开支后，备用现金还不够至少一个月的还贷和生活费。'));
  return b;
}
function lastSearchDate(data) {
  const dates = (data.checkIns ?? []).filter(r=>r.type === 'market' && !r.noChange && ['gdApplications','shApplications','gdInterviews','shInterviews','gdFinals','shFinals'].some(k=>r[k] > 0)).map(r=>r.searchActionAt ?? r.createdAt?.slice(0,10)).filter(isDate);
  if (isDate(data.lastSearchActionAt)) dates.push(data.lastSearchActionAt);
  return dates.sort().at(-1) ?? (isDate(data.profile?.startDate) ? [data.profile.startDate,'2026-10-11'].sort().at(-1):null);
}
function warningsFor(data,today) {
  const w = [], p = data.partnerPlan ?? {}, r = data.routeDecision ?? {}, state = data.routeState, f = financialCapacity(data);
  const selectedIssue = readyOfferIssue(data,today);
  if (selectedIssue) w.push({...selectedIssue,level:'yellow'});
  if (['GUANGDONG_READY','SHANGHAI_BRIDGE_READY','NOTICE_AND_HANDOVER'].includes(state) && !validateBaseline(data).valid) w.push({code:'F03',level:'yellow',text:'收入、负债或开支还没填全，请先补齐再考虑提离职。'});
  if ((data.checkIns ?? []).some(x=>x.type === 'light' && x.pendingSync === true)) w.push({code:'U04',level:'yellow',text:'之前写了新的变化，但数字或安排还没更新。请在“更新近况”里填写对应内容。'});
  if (p.sharedDestinationAligned === false) w.push({code:'R06',level:'yellow',text:'你和女朋友想去的地方不一致，先讨论方向，不强求同日离职。'});
  else if (isDate(p.longDistanceStartDate) && p.longDistanceStartDate <= today && !isDate(p.reunionDate)) {
    const progressing = p.sharedDestinationAligned === true && isDate(p.nextRelationshipReviewAt) && p.nextRelationshipReviewAt >= today;
    w.push({code:'R06',level:progressing ? 'info':'yellow',text:progressing ? '汇合日未知，但你和女朋友想去的地方和下次讨论节点仍在推进。':'异地已开始且缺少下一次讨论节点，请约定再看一次计划。'});
  } else if (!isDate(p.reunionDate)) w.push({code:'R06',level:'info',text:'精确搬家日期未知，不自动判为偏离原计划。'});
  if (isDate(p.reunionDate) && isDate(p.longDistanceStartDate) && nonnegative(data.config?.maxLongDistanceDays) && days(p.longDistanceStartDate,p.reunionDate) > data.config.maxLongDistanceDays) w.push({code:'R06',level:'yellow',text:'异地计划超过双方认可边界，需要共同复查。'});
  if (f.available !== null && f.monthlyBalance !== null && f.available+Math.min(0,f.monthlyBalance)*2 < 0) w.push({code:'F01',level:'red',text:'按现在的收入和开支，现金撑不了未来两个月，请尽快安排还贷和生活费。'});
  else if (['UNAFFORDABLE','TIGHT'].includes(f.stress)) w.push({code:'F04',level:'yellow',text:'如果一个月没工资：'+(f.stress === 'TIGHT' ? '紧张。':'无法覆盖必要支出。')});
  const last = lastSearchDate(data), cycle = data.config?.driftNoActionDays ?? 14;
  const searching = SEARCH.has(state) && (state !== 'SHANGHAI_BRIDGE_ACTIVE' || (isDate(r.gdSearchRestartDate) && today >= r.gdSearchRestartDate));
  if (searching && isDate(last) && days(last,today) >= cycle) {
    const reviews = (data.checkIns ?? []).filter(x=>x.type === 'market' && x.searchPauseReason && x.createdAt?.slice(0,10) > last).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)), latest = reviews.at(-1);
    const reasonable = latest && ['planned','work','health','waiting','no_roles','other'].includes(latest.searchPauseReason) && isDate(latest.pauseReviewAt) && latest.pauseReviewAt >= today && (latest.searchPauseReason !== 'other' || latest.pauseNote?.trim());
    const repeated = reviews.length >= 2 && days(reviews[0].createdAt.slice(0,10),latest.createdAt.slice(0,10)) >= cycle;
    w.push({code:'D01',level:reasonable && !repeated ? 'info':latest ? 'yellow':'info',text:!latest ? cycle+' 天无动作：先记录原因，不直接判偏离原计划。':reasonable && !repeated ? '已有合理暂停原因与复查日，不判偏离原计划。':'暂停跨多个周期或没有可复查原因，需要缩小下一步。'});
  }
  const recent = (data.checkIns ?? []).filter(x=>['market','light'].includes(x.type)).slice(-2);
  if (recent.length === 2 && recent.every(x=>x.waitReason?.trim())) w.push({code:'D03',level:'yellow',text:'连续两次选择再等等，看看等待是否真的能带来新的好处。'});
  if (deriveEnergy(data.baseline?.energyFacts) === 'HIGH_RISK' || data.healthSafetyAffected) w.push({code:'E01',level:'yellow',text:'工作体验显示生活受到明显消耗，建议更早看看是否需要调整工作；并非医疗判断。'});
  const finance = (data.checkIns ?? []).filter(x=>x.type === 'finance').at(-1);
  if (finance && ['CashBalance','DebtBalance'].some(k=>finance['planned'+k] > 0 && nonnegative(finance[k[0].toLowerCase()+k.slice(1)]) && Math.abs(finance[k[0].toLowerCase()+k.slice(1)]-finance['planned'+k])/finance['planned'+k] > (data.config?.planVarianceWarningRate ?? 0.1))) w.push({code:'D02',level:'yellow',text:'收入和负债事实偏离原计划，需要复查。'});
  const premises = r.decisionPremises ?? [], invalid = premises.filter(x=>x.importance !== 'supporting' && x.status === 'invalid');
  if (invalid.length) {
    const at = invalid.map(x=>x.invalidSince ?? x.reviewedAt).filter(isDate).sort()[0];
    w.push({code:'P01',level:invalid.length >= Math.ceil(premises.length/2) && isDate(at) && days(at,today) >= 28 ? 'red':'yellow',text:invalid.length+' 条重要条件失效，原去向需用新事实重新证明。'});
  } else if (premises.some(x=>['partially_valid','unknown'].includes(x.status))) w.push({code:'P02',level:'yellow',text:'部分条件不再完全成立或未知，需要重新考虑去向。'});
  if (r.manualOverride && (r.manualOverride.stillValid === false || (isDate(r.manualOverride.nextReviewAt) && today >= r.manualOverride.nextReviewAt))) w.push({code:'O02',level:'yellow',text:'上次选择不同建议的理由已经变化，或者到了约定再确认的日期。'});
  if (data.currentDecisionId && isDate(r.nextMajorReviewAt) && today >= r.nextMajorReviewAt) w.push({code:'T01',level:'yellow',text:'重新考虑去向日已到，先复查条件，不自动离职。'});
  return w;
}
function knowledge(data) {
  const facts = [...(data.facts ?? [])], b = data.baseline ?? {}, unknowns = [];
  for (const key of ['cashBalance','debtBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost']) facts.push({type:'financial',value:key+': '+(b[key] ?? '未知'),certainty:b[key] == null ? 'unknown':(b.certainty ?? 'confirmed')});
  if (!data.partnerPlan?.moveTimeValue) unknowns.push('对方精确搬家时间未知，不否决去向。');
  for (const o of data.offers ?? []) {
    if (!nonnegative(o.relocationCost)) unknowns.push((o.company || '机会')+'：搬迁成本未知，离职前需确认。');
    if (careerScore(o) == null) unknowns.push((o.company || '机会')+'：工作成长情况尚不完整。');
  }
  return {facts,unknowns,evidenceCounts:{confirmed:facts.filter(f=>f.certainty === 'confirmed').length,estimates:facts.filter(f=>['rough','likely'].includes(f.certainty)).length,unknown:facts.filter(f=>f.certainty === 'unknown').length+unknowns.length}};
}
export function evaluate(data,today) {
  if (!isDate(today)) throw new TypeError('today must be YYYY-MM-DD');
  const r = data.routeDecision ?? {}, actual = data.routeState ?? data.currentState ?? 'BASELINE_SETUP', offers = data.offers ?? [];
  const gd = offers.filter(o=>qualifyGuangdongOffer(o,data,today).qualified), sh = offers.filter(o=>qualifyShanghaiOffer(o,data,today).qualified);
  const suggestedRoute = gd.length && sh.length ? 'ROUTE_CHOICE_REQUIRED':gd.length ? 'GUANGDONG_READY':sh.length ? 'SHANGHAI_BRIDGE_READY':!validateBaseline(data).valid ? 'BASELINE_SETUP':today < (data.config?.checkpointOverrides?.december_decision ?? '2026-12-15') && actual !== 'HOLD_AND_SEARCH' ? 'MARKET_TESTING':'HOLD_AND_SEARCH';
  const routeState = ACTIVE.has(actual) || data.currentDecisionId ? actual:suggestedRoute;
  const selected = offers.find(o=>o.id === r.offerId), blockers = data.intent === 'resign' ? resignBlockers(selected,data,today):[], warnings = warningsFor({...data,routeState},today);
  const fixedBridgeDate = data.config?.checkpointOverrides?.bridge_review ?? '2027-06-01';
  const dueBridge = routeState === 'SHANGHAI_BRIDGE_ACTIVE' && ((isDate(r.bridgeExitDate) && today >= r.bridgeExitDate) || (today >= fixedBridgeDate && (!isDate(r.decidedAt) || r.decidedAt < fixedBridgeDate)));
  if (dueBridge) warnings.push({code:'R09',level:'yellow',text:'到了重新决定是否留上海的日期。看看收入、成长和广东岗位，再决定下一步。'});
  const riskState = blockers.length ? 'BLOCKED':warnings.some(w=>w.level === 'red') ? 'RED':warnings.some(w=>w.level === 'yellow') ? 'YELLOW':'GREEN';
  const reasons = suggestedRoute === 'ROUTE_CHOICE_REQUIRED' ? [issue('R04','广东和上海都有符合条件的岗位，可以比较后再选择。')]:gd.length ? [issue('R02','广东岗位的成长和收入符合目前要求，提离职前还要确认搬家和换工作费用。')]:sh.length ? [issue('R03','上海岗位能改善收入或工作成长，可以考虑先在上海过渡。半年多剩 3 万元是参考值。')]:[issue('R01','还没有符合要求的书面录用通知，先继续上班、投简历和参加面试。')];
  for (const o of [...gd,...sh]) warnings.push(...(o.city === '上海' ? qualifyShanghaiOffer(o,data,today):qualifyGuangdongOffer(o,data,today)).warnings.map(w=>({...w,level:'info'})));
  if (gd.some(o=>data.baseline?.bonusAmount > 0 && isDate(data.baseline?.bonusPayDate) && isDate(o.startDate) && o.startDate < data.baseline.bonusPayDate && o.canDelayStart === false)) reasons.push(issue('R05','等奖金可能错过这个合适岗位，请比较奖金和新工作的长期好处。'));
  const requiresRedecision = dueBridge || warnings.some(w=>['P01','P02','P03','O02','T01'].includes(w.code));
  const nextDates = [addDays(today,['RED','BLOCKED'].includes(riskState) ? 1:7),r.nextMajorReviewAt,r.manualOverride?.nextReviewAt,data.partnerPlan?.nextRelationshipReviewAt,r.gdSearchRestartDate,r.bridgeExitDate,...(data.checkIns ?? []).map(c=>c.nextReviewAt ?? c.pauseReviewAt),...CHECKPOINTS.map(cp=>data.config?.checkpointOverrides?.[cp.id] ?? cp.date),...offers.map(o=>o.responseDueDate)].filter(d=>isDate(d) && d > today).sort();
  const actions = blockers.length ? blockers.slice(0,3).map(b=>({text:b.text,dueDate:today})):warnings.some(w=>w.code === 'U04') ? [{text:requiresRedecision ? '先更新变化涉及的数字或安排，再决定下一步。':'先在“更新近况”里填写变化涉及的数字或安排。',dueDate:today}]:requiresRedecision ? [{text:'看看当初选择的条件是否还成立，再决定要不要调整计划。',dueDate:today}]:[{text:suggestedRoute === 'ROUTE_CHOICE_REQUIRED' ? '比较两地机会，保存选择与 2–5 条条件。':'有变化就更新近况；没变化也可以记一下。',dueDate:addDays(today,7)}];
  return {routeState,riskState,suggestedRoute,state:routeState,level:riskState === 'GREEN' ? 'green':['RED','BLOCKED'].includes(riskState) ? 'red':'yellow',reasons,warnings,blockers,actions,nextCheckAt:nextDates[0],requiresRedecision,premiseReview:r.decisionPremises ?? [],candidates:{guangdong:gd.map(o=>o.id),shanghai:sh.map(o=>o.id)},finance:financialCapacity(data),...knowledge(data),changingConditions:['出现符合职业与基本收入和负债要求的新书面录用通知','原重要条件失效，或出现新的未来收益证据','收入、关系方向或工作体验出现明显变化']};
}
