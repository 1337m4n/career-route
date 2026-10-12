// A cautious planning model, not a bank statement or an exact repayment schedule.
// Ordinary debt and living costs are smoothed unless their included recurring
// amounts are replaced with specific dated events. Unknown numbers stay unknown.
import { isDate } from './data.mjs';

const DAY = 86400000;
const DAYS_PER_MONTH = 365.25 / 12;
const validMoney = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const inRange = (date, start, end) => isDate(date) && date >= start && date <= end;
const isoPlus = (day,n) => new Date(Date.parse(day+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const deltaDays = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/DAY);
const money2 = x => Math.round((x+Number.EPSILON)*100)/100;

export const CASH_EVENT_TYPES = {
  insurance:'车险续保',rent:'房租',bonus:'奖金',offer:'Offer / 答复日',
  first_pay:'新工作首薪',moving:'搬迁 / 换工作',other:'其他资金事项'
};
export const CASH_CERTAINTIES = {confirmed:'已确认',likely:'大概率',rough:'估算',unknown:'尚未确认'};
export const CASH_IMPACTS = {extra:'额外收支',living:'包含在日常生活预算中',debt:'包含在月还贷预算中',milestone:'只提醒，不计金额'};

export function financeSnapshot(data,today) {
  const b=data?.baseline ?? {};
  const legacy=[
    ...(data?.checkIns ?? []).filter(x=>x.type==='finance').map(x=>x.createdAt?.slice(0,10)),
    ...(data?.decisionHistory ?? []).filter(x=>x.source==='基本资料').map(x=>x.at?.slice(0,10))
  ].filter(isDate).sort();
  const date=isDate(b.financeAsOfDate) ? b.financeAsOfDate
    : legacy.at(-1) ?? null;
  const age=isDate(today)&&date ? deltaDays(date,today):null;
  return {date,age,status:age===null ? 'unknown':age<0 ? 'future':age<=7 ? 'fresh':age<=30 ? 'aging':'stale',
    certainty:b.certainty ?? 'unknown',source:b.financeAsOfDate ? '手动填写的财务数据日期' : date ? '历史保存记录推断':'无可识别日期'};
}

export function addCalendarMonths(day, count) {
  if(!isDate(day)) throw new Error('无效日期');
  const d=new Date(day+'T00:00:00Z'),target=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+count,1));
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(),last));
  return target.toISOString().slice(0,10);
}
function nextMonthlyPayday(day, payDay) {
  const date=new Date(day+'T00:00:00Z');
  const year=date.getUTCFullYear(),month=date.getUTCMonth();
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return String(year)+'-'+String(month+1).padStart(2,'0')+'-'+String(Math.min(payDay,last)).padStart(2,'0');
}
function occurrenceDates(e,today,horizon) {
  if(!isDate(e.date)) return [];
  const end=isoPlus(today,horizon),limit=isDate(e.endDate) ? e.endDate : end;
  const dates=[];
  // Recompute from the original start each time, avoiding month-end date drift.
  for(let i=0;i<150;i++){
    const date=i===0 ? e.date : addCalendarMonths(e.date,(e.recurrenceMonths ?? 0)*i);
    if(date > limit || date > end)break;
    if(date >= today)dates.push(date);
    if(!e.recurrenceMonths)break;
  }
  return dates;
}
export function expandCashEvents(data,today,horizon=90) {
  if(!isDate(today))throw new Error('基准日期无效');
  const rows=[];
  for (const e of data?.cashEvents ?? []) {
    if(e.completedAt)continue;
    for(const date of occurrenceDates(e,today,horizon)) {
      rows.push({...e,date,originId:e.id});
    }
  }
  // Legacy bonus fields are a planning scenario, never guaranteed cash.
  // A manually entered bonus supersedes this baseline estimate to avoid counting twice.
  const bonusDate=data?.baseline?.bonusPayDate;
  const bonusAmount=data?.baseline?.bonusAmount;
  if(validMoney(bonusAmount) && bonusAmount>0 &&
     inRange(bonusDate,today,isoPlus(today,horizon)) &&
     !(data?.cashEvents ?? []).some(e=>e.kind==='bonus' && !e.completedAt)){
    rows.push({id:'baseline-bonus',originId:'baseline-bonus',label:'预计奖金（来自基本资料）',
      date:bonusDate,kind:'bonus',direction:'in',impact:'extra',certainty:'likely',
      amount:bonusAmount,virtual:true,origin:'baseline'});
  }
  // Dates in an Offer are informational until the user has actually confirmed
  // new wage receipts. Never turn a verbal or written offer into cash automatically.
  for(const o of data?.offers ?? []){
    const offerLabel=o.company || '岗位';
    for(const [date,label] of [[o.responseDueDate,'Offer答复'],[o.startDate,'预计入职'],[o.firstPayDate,'预计首薪']]){
      if(inRange(date,today,isoPlus(today,horizon)))
        rows.push({id:'offer-'+o.id+'-'+label,originId:'offer-'+o.id,label:offerLabel+' · '+label,date,kind:'offer',direction:'milestone',impact:'milestone',certainty:o.certainty ?? 'unknown',amount:null,virtual:true});
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
}
function aggregateIncludedMonthly(events) {
  const a={living:0,debt:0};
  for(const e of events) if(!e.completedAt && (e.impact==='living'||e.impact==='debt')
    && validMoney(e.amount) && Number.isInteger(e.recurrenceMonths) && e.recurrenceMonths>0)
      a[e.impact]+=e.amount/e.recurrenceMonths;
  return a;
}
export function projectCashflow(data,today) {
  const b=data?.baseline ?? {};
  const snapshot=financeSnapshot(data,today);
  const missing=['cashBalance','monthlyNetIncome','monthlyDebtPayment','monthlyLivingCost'].filter(k=>!validMoney(b[k]));
  const events=expandCashEvents(data,today,90);
  const unquantified=events.filter(e=>e.direction!=='milestone' && !validMoney(e.amount));
  const included=aggregateIncludedMonthly(data?.cashEvents ?? []);
  const issues=[];
  if(missing.length)issues.push('当前现金、工资、月供或基本生活支出有缺项，不能给出完整的现金缺口金额。');
  if(snapshot.status==='unknown')issues.push('财务数据缺少核实日期，不能确定现金余额是否仍有效。');
  if(snapshot.status==='aging')issues.push('财务数据已超过7天未核实，建议更新可用现金和已支付账单。');
  if(snapshot.status==='stale')issues.push('财务数据已超过30天未核实，预测仅可作为旧数据情景，不适合用于付款决策。');
  if(snapshot.status==='future')issues.push('财务数据日期晚于当前日期，请检查录入时间。');
  if(unquantified.length)issues.push('有 '+unquantified.length+' 笔未来资金事项未填写金额，无法判断完整缺口。');
  if(validMoney(b.oneOffCostsNext90Days) && b.oneOffCostsNext90Days>0)
    issues.push('原资料中另有未来90天一次性支出汇总；为避免与逐项事件重复，此汇总暂不加入预测，请核对并改成有日期的资金事件。');
  if(included.living>b.monthlyLivingCost || included.debt>b.monthlyDebtPayment)
    issues.push('标记为“已包含预算”的定期事项总额超过原月度预算，需核对以免低估支出。');
  if(!Number.isInteger(data?.cashflowSettings?.salaryPayDay))issues.push('工资到账日未知，收入按日均摊；预测不能反映发薪日前的真实资金压力。');
  if(!(data?.cashEvents ?? []).length)
    issues.push('还没有记录独立资金事件；车险、房租、奖金等集中收支不会自动出现在预测中。');

  if(missing.length||!isDate(today))return {available:false,missing,issues,events,snapshot,periods:[],assumptions:[]};
  const payday=data?.cashflowSettings?.salaryPayDay;
  const hasPayday=Number.isInteger(payday)&&payday>=1&&payday<=31;
  const gapFrom=data?.cashflowSettings?.incomePauseStart;
  const gapUntil=data?.cashflowSettings?.incomePauseEnd;
  const dailyCost=(Math.max(0,b.monthlyDebtPayment-included.debt)+Math.max(0,b.monthlyLivingCost-included.living))/DAYS_PER_MONTH;
  const dailyIncome=b.monthlyNetIncome/DAYS_PER_MONTH;
  const eventMap=new Map();
  for(const e of events){
    if(e.direction==='milestone'||e.impact==='milestone'||!validMoney(e.amount))continue;
    if(!eventMap.has(e.date))eventMap.set(e.date,[]);
    eventMap.get(e.date).push(e);
  }
  let cautious=b.cashBalance,scenario=b.cashBalance,cautiousLowest=b.cashBalance,scenarioLowest=b.cashBalance,firstDeficit=null;
  // Same-day unpaid events are not silently dropped. Today's existing salary is
  // not credited again: the cash snapshot is assumed to reflect current cash.
  for(const e of eventMap.get(today) ?? []){
    const change=(e.direction==='in'?1:-1)*e.amount;
    if(e.direction==='out'||e.certainty==='confirmed')cautious+=change;
    scenario+=change;
  }
  const startCautious=cautious,startScenario=scenario;
  cautiousLowest=Math.min(cautiousLowest,cautious);
  scenarioLowest=Math.min(scenarioLowest,scenario);
  if(cautious<0)firstDeficit=today;
  const daily=[];
  for(let i=1;i<=90;i++){
    const date=isoPlus(today,i);
    const paused=isDate(gapFrom)&&date>=gapFrom&&(!isDate(gapUntil)||date<gapUntil);
    const payOnThisDay=hasPayday&&date===nextMonthlyPayday(date,payday);
    const income=paused ? 0 : hasPayday ? (payOnThisDay?b.monthlyNetIncome:0):dailyIncome;
    cautious+=income-dailyCost;scenario+=income-dailyCost;
    for(const e of eventMap.get(date) ?? []){
      const sign=e.direction==='in'?1:-1;
      const change=sign*e.amount;
      if(e.direction==='out' || e.certainty==='confirmed')cautious+=change;
      scenario+=change;
    }
    cautiousLowest=Math.min(cautiousLowest,cautious);
    scenarioLowest=Math.min(scenarioLowest,scenario);
    if(cautious<0 && !firstDeficit)firstDeficit=date;
    daily.push({date,cautious:money2(cautious),scenario:money2(scenario)});
  }
  const periods=[30,60,90].map(days=>{
    const values=daily.slice(0,days);
    const minC=Math.min(b.cashBalance,startCautious,...values.map(x=>x.cautious));
    const minS=Math.min(b.cashBalance,startScenario,...values.map(x=>x.scenario));
    const last=values.at(-1);
    const firstShort=firstDeficit===today ? {date:today} : values.find(v=>v.cautious<0);
    return {days,date:last.date,cautiousEnd:last.cautious,scenarioEnd:last.scenario,
      cautiousLowest:money2(minC),scenarioLowest:money2(minS),gap:money2(Math.max(0,-minC)),
      firstDeficit:firstShort?.date??null,status:firstShort?'shortfall':minC < b.monthlyDebtPayment ? 'tight':'buffer'};
  });
  return {available:true,issues,missing,events,snapshot,periods,daily,firstDeficit,unquantified:unquantified.length,
    assumptions:[
      hasPayday?'工资按指定每月发薪日到账':'工资按月均金额逐日分摊',
      '月供和生活费按日均匀支出；不代表每笔贷款的真实扣款日',
      '已包含预算的周期支出从日均预算中移出，在事件到期日一次扣除',
      '谨慎余额不计尚未确认的奖金等额外收入，但计入可能发生的支出',
      '预测只使用已有工资与债务数据；换工作的Offer不自动改变现金收入'
    ]};
}
