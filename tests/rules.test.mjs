import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate,qualifyGuangdongOffer,qualifyShanghaiOffer,deriveCareer,deriveEnergy,resignBlockers,financialCapacity,bridgeRenewalErrors } from '../rules.mjs';
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
