import { CHECKPOINTS, isDate, checkpointCompletion } from "./data.mjs";
import { expandCashEvents } from "./cashflow.mjs";

const escapeText = value => String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function event(id, date, label, stamp, description = '检查上次选择这条去向的条件现在是否仍成立。不是强制离职日。') {
  if (!isDate(date)) throw new Error(`提醒日期无效：${id}`);
  return [
    "BEGIN:VEVENT",
    `UID:career-route-${id}@1337m4n.beer`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${nextDay(date).replace(/-/g, "")}`,
    `SUMMARY:${escapeText(`职业去向：${label}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1D',
    'DESCRIPTION:检查决策条件是否仍成立',
    'END:VALARM',
    "END:VEVENT",
  ];
}

export function makeCalendar(data) {
  const overrides = data?.config?.checkpointOverrides ?? {};
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Career Route//Checkpoints//ZH",
    "CALSCALE:GREGORIAN",
    "X-WR-TIMEZONE:Asia/Shanghai",
  ];
  for (const item of CHECKPOINTS) {
    // Completed milestones should not be added to a newly exported calendar.
    if (checkpointCompletion(data, item.id)) continue;
    lines.push(...event(item.id, overrides[item.id] ?? item.date, `${item.type === 'major' ? '重新考虑去向' : '记录近况'}：${item.label}`, stamp));
  }
  // These calendar entries remain generic: do not embed personal money amounts,
  // employer names, debts, relationship details or user notes in calendar exports.
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const [index,entry] of expandCashEvents(data,today,365).entries()){
    const type = entry.direction==='milestone' ? '职业 / 首薪日期确认' : '资金收支核对';
    lines.push(...event('cash-'+index+'-'+entry.date,entry.date,type,stamp,
      '回到资金计划核对金额、日期和是否已实际付款；尚未确认的收入不能视为已经到账。'));
  }
  const route = data?.routeDecision ?? {};
  if (route.gdSearchRestartDate) lines.push(...event("gd-search-restart", route.gdSearchRestartDate, "重新投广东岗位", stamp));
  if (route.bridgeExitDate) lines.push(...event("bridge-exit", route.bridgeExitDate, "上海过渡到期再看一次计划", stamp));
  if (route.nextMajorReviewAt) lines.push(...event('next-major-review',route.nextMajorReviewAt,'复查决策条件',stamp));
  if (route.manualOverride?.nextReviewAt) lines.push(...event('override-review',route.manualOverride.nextReviewAt,'复查临时例外理由',stamp));
  if (data.partnerPlan?.nextRelationshipReviewAt) lines.push(...event('relationship-review',data.partnerPlan.nextRelationshipReviewAt,'共同讨论下一阶段',stamp));
  for (const [index,offer] of (data.offers ?? []).entries()) if (offer.responseDueDate) {
    lines.push(...event('offer-response-'+index,offer.responseDueDate,'录用通知最晚答复日',stamp,'核实机会条款和答复期限；不是离职日。'));
  }
  for (const [index,item] of (data.checkIns ?? []).entries()) {
    const date=item.nextReviewAt ?? item.pauseReviewAt;
    if (date) lines.push(...event('check-in-'+index,date,'个人补充检查',stamp));
  }
  return `${lines.concat("END:VCALENDAR").join("\r\n")}\r\n`;
}

export function downloadCalendar(data) {
  const url = URL.createObjectURL(new Blob([makeCalendar(data)], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "career-route-reminders.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return link.download;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const ics = makeCalendar({ config: { checkpointOverrides: { baseline: "2026-10-11" } } });
  if (!ics.includes("DTSTART;VALUE=DATE:20261011") || !ics.endsWith("END:VCALENDAR\r\n") || /(?<!\r)\n/.test(ics)) {
    throw new Error("日历自检失败");
  }
  process.stdout.write("日历自检通过\n");
}
