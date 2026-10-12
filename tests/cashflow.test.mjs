import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData,validateData } from '../data.mjs';
import { projectCashflow,expandCashEvents,financeSnapshot,addCalendarMonths } from '../cashflow.mjs';

function fixture() {
  const d=createInitialData();
  Object.assign(d.baseline,{cashBalance:5500,monthlyNetIncome:10000,monthlyDebtPayment:6000,
    monthlyLivingCost:3000,oneOffCostsNext90Days:0,financeAsOfDate:'2026-10-12',certainty:'confirmed'});
  d.cashflowSettings.salaryPayDay=8;
  return d;
}
const event=(id,day,amount,opts={})=>({
  id,label:id,kind:'other',date:day,endDate:null,direction:'out',impact:'extra',
  amount,recurrenceMonths:0,certainty:'confirmed',completedAt:null,note:'',...opts
});

test('没有月供或现金不能假装为0并给出完整预测',()=>{
  const d=fixture();d.baseline.cashBalance=null;
  const p=projectCashflow(d,'2026-10-12');
  assert.equal(p.available,false);assert.ok(p.missing.includes('cashBalance'));assert.equal(p.periods.length,0);
});

test('30/60/90天预测会看到保险一次性支出与发薪间隔',()=>{
  const d=fixture();
  d.cashEvents.push(event('renew','2026-10-24',5000,{kind:'insurance'}));
  const p=projectCashflow(d,'2026-10-12');
  assert.equal(p.available,true);
  assert.deepEqual(p.periods.map(x=>x.days),[30,60,90]);
  assert.equal(p.events.filter(x=>x.originId==='renew').length,1);
  assert.ok(p.periods[0].gap>0);
  assert.ok(p.firstDeficit);
  assert.equal(p.periods[0].firstDeficit,p.firstDeficit);
});

test('未确认奖金不进入谨慎余额；仅进入含估计收入的场景',()=>{
  const d=fixture();
  d.cashEvents.push(event('bonus','2026-11-15',10000,{kind:'bonus',direction:'in',certainty:'likely'}));
  const p=projectCashflow(d,'2026-10-12');
  assert.equal(p.periods[0].scenarioEnd,p.periods[0].cautiousEnd);
  assert.equal(Math.round(p.periods[1].scenarioEnd-p.periods[1].cautiousEnd),10000);
  d.cashEvents[0].certainty='confirmed';
  const paid=projectCashflow(d,'2026-10-12');
  assert.equal(paid.periods[1].cautiousEnd,paid.periods[1].scenarioEnd);
});

test('房租已包含在月度生活预算时，只从日均预算移除并在到期日扣一次',()=>{
  const b=fixture();b.cashflowSettings.salaryPayDay=null;
  const included=fixture();included.cashflowSettings.salaryPayDay=null;
  included.cashEvents.push(event('rent','2026-11-24',3000,{kind:'rent',recurrenceMonths:3,impact:'living'}));
  const base=projectCashflow(b,'2026-10-12');
  const p=projectCashflow(included,'2026-10-12');
  assert.ok(p.periods[0].cautiousEnd>base.periods[0].cautiousEnd);
  assert.equal(p.events.length,1);
  assert.ok(p.periods[1].cautiousEnd<base.periods[1].cautiousEnd+1500);
});

test('重复事件按照原日期计算月份，月底不发生日期漂移',()=>{
  assert.equal(addCalendarMonths('2027-01-31',1),'2027-02-28');
  assert.equal(addCalendarMonths('2027-01-31',2),'2027-03-31');
  const d=fixture();
  d.cashEvents.push(event('rent','2026-07-31',500,{kind:'rent',recurrenceMonths:1,impact:'living',endDate:'2026-12-31'}));
  const rows=expandCashEvents(d,'2026-10-12',90);
  assert.deepEqual(rows.map(r=>r.date),['2026-10-31','2026-11-30','2026-12-31']);
});

test('收入空档不把已停发工资当收入；Offer首薪仅提醒',()=>{
  const d=fixture();
  d.cashflowSettings.incomePauseStart='2026-11-01';
  d.cashflowSettings.incomePauseEnd='2026-12-01';
  d.offers.push({id:'offer1',company:'测试公司',certainty:'rough',status:'verbal',
    responseDueDate:'2026-10-20',startDate:'2026-11-20',firstPayDate:'2026-12-08'});
  const p=projectCashflow(d,'2026-10-12');
  const normal=fixture();
  assert.ok(p.periods[1].cautiousEnd<projectCashflow(normal,'2026-10-12').periods[1].cautiousEnd);
  assert.equal(p.events.filter(e=>e.virtual).length,3);
  assert.ok(p.events.filter(e=>e.virtual).every(e=>e.direction==='milestone'));
});

test('旧版本档案可迁移；旧日志能恢复数据日期而不伪造今天更新',()=>{
  const d=fixture();
  delete d.cashEvents;delete d.cashflowSettings;delete d.baseline.financeAsOfDate;
  d.decisionHistory.push({source:'基本资料',at:'2026-09-25T10:00:00Z'});
  const migrated=validateData(d);
  assert.deepEqual(migrated.cashEvents,[]);
  assert.equal(migrated.cashflowSettings.salaryPayDay,null);
  const snap=financeSnapshot(migrated,'2026-10-12');
  assert.equal(snap.date,'2026-09-25');
  assert.equal(snap.status,'aging');
});

test('非法金额、日期、重复事件和收入事件预算归类都被拒绝',()=>{
  const d=fixture();
  d.cashEvents.push(event('a','2026-11-01',1000));
  validateData(d);
  const duplicate=structuredClone(d);duplicate.cashEvents.push({...duplicate.cashEvents[0]});
  assert.throws(()=>validateData(duplicate),/资金事件/);
  const impossible=structuredClone(d);impossible.cashEvents[0].date='2026-02-30';
  assert.throws(()=>validateData(impossible),/资金事件/);
  const wrongKind=structuredClone(d);wrongKind.cashEvents[0].direction='in';
  wrongKind.cashEvents[0].impact='living';wrongKind.cashEvents[0].recurrenceMonths=3;
  assert.throws(()=>validateData(wrongKind),/资金事件/);
  const unknownConfirmed=structuredClone(d);unknownConfirmed.cashEvents[0].amount=null;
  assert.throws(()=>validateData(unknownConfirmed),/资金事件/);
  const brokenPause=structuredClone(d);brokenPause.cashflowSettings={salaryPayDay:8,incomePauseStart:'2026-11-15',incomePauseEnd:'2026-11-01'};
  assert.throws(()=>validateData(brokenPause),/现金流/);
});
