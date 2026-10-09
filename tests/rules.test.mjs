import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate,qualifyGuangdongOffer,qualifyShanghaiOffer,routeTendencies,deriveCareer,deriveEnergy,resignBlockers,financialCapacity,bridgeRenewalErrors } from '../rules.mjs';
import { createInitialData,validateData,recordRouteDecision } from '../data.mjs';
import { encryptBackup,decodeBackup } from '../crypto.mjs';
import { makeCalendar } from '../reminders.mjs';

function fixture() {
  const d=createInitialData();
  Object.assign(d.baseline,{debtBalance:90000,cashBalance:25000,monthlyNetIncome:10000,monthlyDebtPayment:5000,monthlyLivingCost:4000,currentRoleGrowth:2,contractNoticeDays:30,availableHandoverDays:30});
  d.profile.targetRoles=['安全工程']; d.routeState='MARKET_TESTING';
  d.checkIns=[{type:'market',createdAt:'2026-11-29T12:00:00Z',gdApplications:5}];
  return d;
}
function offer(city='广州') {
  return {id:city,company:'合成测试公司',city,status:'written',targetAligned:true,careerScore:4,monthlyNetIncome:13000,monthlyLivingCost:4000,relocationCost:1000,switchingCost:0,probationMonths:0,startDate:'2027-01-15',bridgeExitDate:'2027-06-01',gdSearchRestartDate:'2027-04-01'};
}
test('未知搬家费和关系日期不阻断广东 READY',()=>{
  const d=fixture(),o=offer(); o.relocationCost=null;d.offers=[o];
  assert.equal(qualifyGuangdongOffer(o,d).qualified,true);
  const r=evaluate(d,'2026-12-01');assert.equal(r.routeState,'GUANGDONG_READY');assert.notEqual(r.riskState,'RED');
  assert.ok(r.unknowns.length);assert.ok(r.warnings.some(w=>w.code==='U01'));
});
test('上海低于 3 万但职业升级可桥接；高收入不要求机械 +1',()=>{
  const d=fixture(),o=offer('上海');o.monthlyNetIncome=11000;
  assert.ok(qualifyShanghaiOffer(o,d).sixMonthNetGain<30000);
  assert.equal(qualifyShanghaiOffer(o,d).qualified,true);
  o.careerScore=2;o.monthlyNetIncome=13000;
  assert.equal(qualifyShanghaiOffer(o,d).qualified,true);
  o.careerScore=1;assert.equal(qualifyShanghaiOffer(o,d).qualified,false);
});
test('两地均符合时由用户选，不自动广东优先',()=>{
  const d=fixture();d.offers=[offer(),offer('上海')];
  assert.equal(evaluate(d,'2026-12-01').suggestedRoute,'ROUTE_CHOICE_REQUIRED');
});
test('五问路线倾向只基于已录入机会；百分比和证据置信度分开',()=>{
  const blank=createInitialData();blank.offers=[offer()];assert.deepEqual(routeTendencies(blank),[]);
  const d=fixture();assert.deepEqual(routeTendencies(d),[]);
  const careerFacts=Object.fromEntries(['technologyDepth','responsibility','transferability','targetFit','outcomes'].map(key=>[key,true]));
  const gd={...offer(),certainty:'confirmed',careerFacts},sh={...offer('上海'),certainty:'confirmed',careerFacts};
  d.partnerPlan.sharedDestinationAligned=true;d.offers=[gd];
  const [first]=routeTendencies(d);
  assert.equal(first.route,'直接广东');assert.equal(first.score,95);assert.equal(first.confidence,100);assert.equal(first.checked,7);assert.equal(first.qualified,true);
  d.offers.push(sh);
  const both=routeTendencies(d);assert.deepEqual(both.map(x=>x.route),['直接广东','上海过渡']);
  assert.ok(both.every(x=>x.score>=0 && x.score<=100 && x.confidence===100));
  gd.status='verbal';
  const partial=routeTendencies(d).find(x=>x.route==='直接广东');
  assert.equal(partial.qualified,false);assert.ok(partial.score<first.score);assert.ok(partial.confidence<first.confidence);
  d.offers=[{...offer('北京'),careerFacts}];
  assert.deepEqual(routeTendencies(d),[]);
});
test('同一路线展示分数最高的机会，不被后面的较差机会覆盖',()=>{
  const d=fixture(),best={...offer(),id:'best',status:'accepted',careerFacts:Object.fromEntries(['technologyDepth','responsibility','transferability','targetFit','outcomes'].map(key=>[key,true]))},weak={...offer(),id:'weak',status:'verbal',careerScore:2};
  d.offers=[best,weak];
  assert.equal(routeTendencies(d,'2026-12-01')[0].id,'best');
});
test('正式 READY 机会失效或删除后保留路线历史，但风险升高并要求重选',()=>{
  let d=fixture(),o=offer();d.offers=[o];
  d=recordRouteDecision(d,{id:'chosen',routeState:'GUANGDONG_READY',offerId:o.id,decisionPremises:[{text:'职业成长',status:'valid'},{text:'现金可承受',status:'valid'}],nextMajorReviewAt:'2027-03-01'});
  assert.equal(evaluate(d,'2026-12-01').riskState,'GREEN');
  o.targetAligned=false;
  const stale=evaluate(d,'2026-12-01');
  assert.equal(stale.routeState,'GUANGDONG_READY');assert.equal(stale.riskState,'YELLOW');assert.equal(stale.requiresRedecision,true);assert.ok(stale.warnings.some(w=>w.code==='P03'));
  Object.assign(o,{status:'accepted',termsConfirmed:true,pendingConditionsClear:true,transitionIncomeGapMonths:0});
  assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='P03'));
  d.offers=[];
  assert.ok(evaluate(d,'2026-12-01').warnings.some(w=>w.code==='P03'));
});
test('交接期修改已选机会关键条件不能继续显示绿色',()=>{
  let d=fixture(),o=offer();d.offers=[o];
  d=recordRouteDecision(d,{id:'notice',routeState:'GUANGDONG_READY',offerId:o.id,route:'guangdong',decisionPremises:[{text:'职业成长',status:'valid'},{text:'现金可承受',status:'valid'}],nextMajorReviewAt:'2027-03-01'});
  Object.assign(o,{status:'accepted',termsConfirmed:true,pendingConditionsClear:true,transitionIncomeGapMonths:0});
  d.routeState='NOTICE_AND_HANDOVER';
  assert.equal(evaluate(d,'2026-12-01').riskState,'GREEN');
  o.monthlyNetIncome=14000;o.termsConfirmed=false;
  const changed=evaluate(d,'2026-12-01');
  assert.equal(changed.routeState,'NOTICE_AND_HANDOVER');assert.equal(changed.riskState,'YELLOW');assert.equal(changed.requiresRedecision,true);assert.ok(changed.warnings.some(w=>w.code==='P03'));
  o.termsConfirmed=true;
  assert.ok(evaluate(d,'2026-12-01').warnings.some(w=>w.code==='P03'));
});
test('记录在案且未过期的职业例外可保留选择，但不能绕过财务或条款安全门',()=>{
  let d=fixture(),o=offer();o.careerScore=2;d.offers=[o];
  d=recordRouteDecision(d,{id:'override',routeState:'GUANGDONG_READY',offerId:o.id,decisionPremises:[{text:'例外职业方向',status:'valid'},{text:'现金可承受',status:'valid'}],manualOverride:{reason:'明确接受成长较慢但可积累项目',nextReviewAt:'2027-02-01'},nextMajorReviewAt:'2027-03-01'});
  assert.equal(evaluate(d,'2026-12-01').warnings.some(w=>w.code==='P03'),false);
  Object.assign(o,{status:'accepted',termsConfirmed:true,pendingConditionsClear:true,transitionIncomeGapMonths:0});
  assert.deepEqual(resignBlockers(o,d,'2026-12-01'),[]);
  o.termsConfirmed=false;assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='R01'));
  o.termsConfirmed=true;d.baseline.cashBalance=0;assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='F01'));
  d.baseline.cashBalance=25000;o.city='北京';assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='P03'));
});
test('过期书面答复需重确认；已接受不因答复截止日过期而取消，过期入职日仍需确认',()=>{
  let d=fixture();const o=offer();o.responseDueDate='2026-11-30';d.offers=[o];
  assert.equal(qualifyGuangdongOffer(o,d,'2026-12-01').qualified,false);
  d=recordRouteDecision(d,{id:'expired',routeState:'GUANGDONG_READY',offerId:o.id,decisionPremises:[{text:'成长',status:'valid'},{text:'现金',status:'valid'}],nextMajorReviewAt:'2027-03-01'});
  assert.equal(evaluate(d,'2026-12-01').requiresRedecision,true);
  o.status='accepted';assert.equal(qualifyGuangdongOffer(o,d,'2026-12-01').qualified,true);
  o.startDate='2026-11-30';assert.equal(qualifyGuangdongOffer(o,d,'2026-12-01').qualified,false);
  assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='R08'));
});
test('上海求职重启日不能早于入职或本次续期决策',()=>{
  const d=fixture(),o=offer('上海');o.gdSearchRestartDate='2026-12-01';
  assert.equal(qualifyShanghaiOffer(o,d,'2026-12-01').qualified,false);
  const renewal={renewalEvidenceType:'project',evidenceCertainty:'confirmed',newEvidence:'已明确获得一个新的高价值安全工程项目',bridgeExitDate:'2027-06-01',gdSearchRestartDate:'2026-11-30',nextMajorReviewAt:'2027-03-01'};
  assert.ok(bridgeRenewalErrors(renewal,'2026-12-01').length);
});
test('核心财务未知与新事实待同步不能显示无警告绿色 READY 或直接离职',()=>{
  let d=fixture(),o=offer();d.offers=[o];d.baseline.debtBalance=null;
  assert.equal(evaluate(d,'2026-12-01').suggestedRoute,'GUANGDONG_READY');
  assert.equal(evaluate(d,'2026-12-01').riskState,'YELLOW');
  assert.ok(evaluate(d,'2026-12-01').warnings.some(w=>w.code==='F03'));
  d.baseline.debtBalance=90000;
  d=recordRouteDecision(d,{id:'chosen',routeState:'GUANGDONG_READY',offerId:o.id,decisionPremises:[{text:'职业成长',status:'valid'},{text:'现金可承受',status:'valid'}],nextMajorReviewAt:'2027-03-01'});
  d.checkIns.push({type:'light',createdAt:'2026-12-01T00:00:00Z',waitReason:'还想再等等',pendingSync:true});
  const result=evaluate(d,'2026-12-01');assert.equal(result.riskState,'YELLOW');assert.ok(result.warnings.some(w=>w.code==='U04'));assert.match(result.actions[0].text,/填写变化/);
  Object.assign(o,{status:'accepted',termsConfirmed:true,pendingConditionsClear:true,transitionIncomeGapMonths:0});
  assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='U04'));
  d.checkIns.push({type:'light',createdAt:'2026-12-02T00:00:00Z',waitReason:'先拿奖金'});
  assert.ok(evaluate(d,'2026-12-02').warnings.some(w=>w.code==='D03'));
});
test('风险与已选路线独立；桥接到期强制复盘不自动离职',()=>{
  const d=fixture();d.routeState='SHANGHAI_BRIDGE_ACTIVE';d.routeDecision.bridgeExitDate='2027-06-01';
  const r=evaluate(d,'2027-06-01');assert.equal(r.routeState,'SHANGHAI_BRIDGE_ACTIVE');assert.equal(r.requiresRedecision,true);assert.equal(r.riskState,'YELLOW');
});
test('固定六月复盘不能被晚入职跳过，复盘后的新决定不重复触发',()=>{
  const d=fixture();d.routeState='SHANGHAI_BRIDGE_ACTIVE';Object.assign(d.routeDecision,{bridgeExitDate:'2027-09-01',decidedAt:'2027-05-01'});
  assert.equal(evaluate(d,'2027-06-01').requiresRedecision,true);
  d.routeDecision.decidedAt='2027-06-02';assert.equal(evaluate(d,'2027-06-03').requiresRedecision,false);
});
test('关系日期未知但有方向与讨论节点，不判红',()=>{
  const d=fixture();d.partnerPlan={sharedDestinationAligned:true,longDistanceStartDate:'2026-11-01',nextRelationshipReviewAt:'2027-01-15'};
  assert.equal(evaluate(d,'2026-12-01').warnings.find(w=>w.code==='R06').level,'info');
});
test('14 天无动作先询问原因；合理暂停不偏航，重复周期升级',()=>{
  const d=fixture();d.checkIns=[];
  assert.equal(evaluate(d,'2026-12-01').warnings.find(w=>w.code==='D01').level,'info');
  d.checkIns=[{type:'market',createdAt:'2026-11-28T00:00:00Z',searchPauseReason:'work',pauseReviewAt:'2026-12-15'}];
  assert.equal(evaluate(d,'2026-12-01').warnings.find(w=>w.code==='D01').level,'info');
  d.checkIns.push({type:'market',createdAt:'2026-12-13T00:00:00Z',searchPauseReason:'work',pauseReviewAt:'2026-12-30'});
  assert.equal(evaluate(d,'2026-12-14').warnings.find(w=>w.code==='D01').level,'yellow');
});
test('失效前提与覆盖理由到期触发复盘，保持路线',()=>{
  const d=fixture();d.currentDecisionId='x';d.routeState='HOLD_AND_SEARCH';
  d.routeDecision={decisionPremises:[{text:'旧理由',importance:'core',status:'invalid',reviewedAt:'2026-11-01'}],manualOverride:{nextReviewAt:'2026-12-01'}};
  const r=evaluate(d,'2026-12-01');assert.equal(r.routeState,'HOLD_AND_SEARCH');assert.equal(r.riskState,'RED');assert.equal(r.requiresRedecision,true);assert.ok(r.warnings.some(w=>w.code==='O02'));
});
test('written、不明条款、通知冲突、未知财务不能通过离职门',()=>{
  const d=fixture(),o=offer();assert.ok(resignBlockers(o,d,'2026-12-01').length);
  Object.assign(o,{status:'accepted',termsConfirmed:true,pendingConditionsClear:true,transitionIncomeGapMonths:0});
  assert.deepEqual(resignBlockers(o,d,'2026-12-01'),[]);
  o.relocationCost=null;assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='F02'));
  o.relocationCost=0;o.startDate='2026-12-05';assert.ok(resignBlockers(o,d,'2026-12-01').some(b=>b.code==='NOTICE_CONFLICT'));
});
test('一月压力测试不把缺失现金当作 0',()=>{
  const d=fixture();assert.equal(financialCapacity(d).stress,'COVERED');
  d.baseline.cashBalance=9000;assert.equal(financialCapacity(d).stress,'TIGHT');
  d.baseline.cashBalance=8000;assert.equal(financialCapacity(d).stress,'UNAFFORDABLE');
  d.baseline.cashBalance=null;assert.equal(financialCapacity(d).stress,'UNKNOWN');
  d.baseline.cashBalance=25000;d.baseline.oneOffCostsNext90Days=null;assert.equal(financialCapacity(d).stress,'UNKNOWN');
});
test('桥接续期需要新证据、六个月内复盘和提前重启，旧奖金理由不能续期',()=>{
  const v={renewalEvidenceType:'project',evidenceCertainty:'confirmed',newEvidence:'已明确获得一个新的高价值安全工程项目',bridgeExitDate:'2027-06-01',gdSearchRestartDate:'2027-04-01',nextMajorReviewAt:'2027-03-01'};
  assert.deepEqual(bridgeRenewalErrors(v,'2026-12-01'),[]);
  for (const patch of [{renewalEvidenceType:'bonus'},{evidenceCertainty:'unknown'},{bridgeExitDate:'2027-06-02'},{gdSearchRestartDate:'2027-05-01'},{nextMajorReviewAt:'2026-11-30'}]) assert.ok(bridgeRenewalErrors({...v,...patch},'2026-12-01').length);
});
test('导入边界拒绝伪造事实、比例、桥接上限和覆盖理由',()=>{
  for (const mutate of [d=>d.baseline.careerFacts={technologyDepth:'true'},d=>d.baseline.energyFacts={lowMood:1},d=>d.config.bridgeMaxMonths=12,d=>d.config.driftNoActionDays=0,d=>d.offers=[{...offer(),probationRate:101}],d=>d.offers=[{...offer(),termsConfirmed:'true'}],d=>d.routeDecision.manualOverride={reason:'',nextReviewAt:'2026-12-01'}]) {
    const d=fixture();mutate(d);assert.throws(()=>validateData(d));
  }
});
test('成长从事实生成，未知不伪造评分；精力不是主观分',()=>{
  assert.equal(deriveCareer({technologyDepth:true}).score,null);
  assert.equal(deriveCareer({technologyDepth:true,responsibility:true,transferability:true,targetFit:true,outcomes:true}).score,5);
  assert.equal(deriveEnergy({affectsLife:true}),'HIGH_RISK');assert.equal(deriveEnergy({}),'UNKNOWN');
});
test('v1 存档迁移保留金额、历史，不虚构旧前提',()=>{
  const d=fixture();d.schemaVersion=1;d.currentState='SHANGHAI_BRIDGE_ACTIVE';delete d.routeState;delete d.riskState;delete d.decisions;delete d.facts;
  const r=validateData(d);assert.equal(r.schemaVersion,2);assert.equal(r.routeState,'SHANGHAI_BRIDGE_ACTIVE');assert.equal(r.baseline.cashBalance,25000);assert.deepEqual(r.routeDecision.decisionPremises,[]);
  assert.throws(()=>validateData({...r,routeState:'INVALID'}));
});
test('每次重大选择必须 2–5 条前提；快照不随未来数据变化',()=>{
  const d=fixture(),item={id:'d1',routeState:'HOLD_AND_SEARCH',nextMajorReviewAt:'2027-03-01',decisionPremises:[{text:'理由一',status:'valid'},{text:'理由二',status:'valid'}]};
  const r=recordRouteDecision(d,item);d.baseline.cashBalance=0;assert.equal(r.decisions[0].recordedBaseline.cashBalance,25000);
  r.routeDecision.decisionPremises[0].status='invalid';assert.equal(r.decisions[0].decisionPremises[0].status,'valid');
  assert.throws(()=>recordRouteDecision(d,{...item,decisionPremises:[]}));
});
test('加密备份往返、错误口令、篡改均有验证',async()=>{
  const text=JSON.stringify(fixture()),password='test-passphrase-123';
  const encrypted=await encryptBackup(text,password);
  assert.equal(encrypted.includes('合成测试公司'),false);assert.equal(await decodeBackup(encrypted,password),text);
  await assert.rejects(decodeBackup(encrypted,'wrong-password'));
  const changed=JSON.parse(encrypted);changed.ciphertext='AAAA'+changed.ciphertext.slice(4);
  await assert.rejects(decodeBackup(JSON.stringify(changed),password));
  assert.equal(await decodeBackup(text),text);
});
test('日历不带敏感事实，只含复盘节点',()=>{
  const d=fixture();const calendar=makeCalendar(d);
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));assert.ok(!calendar.includes('25000'));
});
test('临时例外与轻检查的提前复查日期进入下一节点和日历',()=>{
  const d=fixture();d.routeDecision.manualOverride={reason:'暂时等待确认',nextReviewAt:'2026-12-03'};
  d.checkIns.push({id:'light',type:'light',nextReviewAt:'2026-12-02',newFact:'不要公开的事实'});
  assert.equal(evaluate(d,'2026-12-01').nextCheckAt,'2026-12-02');
  const calendar=makeCalendar(d);assert.ok(calendar.includes('DTSTART;VALUE=DATE:20261202'));assert.ok(!calendar.includes('不要公开的事实'));
});
test('evaluate 为纯函数，不修改原数据',()=>{
  const d=fixture(),before=structuredClone(d);evaluate(d,'2026-12-01');assert.deepEqual(d,before);
});
