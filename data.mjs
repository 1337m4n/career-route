export const STORAGE_KEY = "career-route:v1";

export const CHECKPOINTS = [
  { id: "baseline", date: "2026-10-10", label: "完成初始基线", description: "补齐现金、负债、目标岗位和关系时间线。" },
  { id: "market_midpoint", date: "2026-11-15", label: "市场验证中期校准", description: "检查投递、面试和目标岗位是否需要调整。" },
  { id: "market_pricing", date: "2026-11-30", label: "市场定价", description: "汇总两地真实岗位、薪资和成长反馈。" },
  { id: "december_decision", date: "2026-12-15", label: "第一次路线决策", description: "比较广东、上海桥接与继续求职。" },
  { id: "year_end", date: "2026-12-31", label: "年末检查", description: "检查是否因为奖金或习惯暂停行动。" },
  { id: "january_cashflow", date: "2027-01-15", label: "现金流与关系复盘", description: "更新月供变化和双方迁移窗口。" },
  { id: "march_review", date: "2027-03-01", label: "第二次路线复盘", description: "用最新 Offer、现金流和精力状态重选路线。" },
  { id: "bridge_search", date: "2027-04-15", label: "桥接求职预警", description: "若已桥接上海，确认广东求职已经重启。" },
  { id: "bridge_exit_warning", date: "2027-05-15", label: "桥接退出预警", description: "检查岗位管道和退出准备。" },
  { id: "bridge_review", date: "2027-06-01", label: "桥接硬复盘", description: "重新比较未来收益和成本，不自动续期。" },
];
const MAJOR = new Set(['baseline', 'market_pricing', 'december_decision', 'march_review', 'bridge_review']);
CHECKPOINTS.forEach(item => { item.type = MAJOR.has(item.id) ? 'major' : 'light'; });

export function createInitialData() {
  return {
    schemaVersion: 2,
    profile: {
      startDate: "2026-09-26",
      targetRegion: "广东",
      targetCities: ["广州", "深圳"],
      targetRoles: [],
    },
    config: {
      gdMinNetIncome: null,
      gdMinCareerScore: 3,
      bridgeMinSixMonthGain: 30000,
      bridgeMaxMonths: 6,
      maxLongDistanceDays: null,
      driftNoActionDays: 14,
      planVarianceWarningRate: 0.1,
      checkpointOverrides: {},
    },
    routeState: "BASELINE_SETUP",
    riskState: "GREEN",
    baseline: {
      debtBalance: null,
      cashBalance: null,
      monthlyNetIncome: null,
      monthlyDebtPayment: null,
      monthlyLivingCost: null,
      oneOffCostsNext90Days: 0,
      currentRoleGrowth: null,
      careerFacts: {},
      energyFacts: {},
      energyLevel: null,
      contractNoticeDays: null,
      preferredHandoverDays: 28,
      bonusAmount: null,
      bonusPayDate: null,
    },
    partnerPlan: {
      sharedDestinationAligned: null,
      earliestMoveDate: null,
      latestMoveDate: null,
      maxLongDistanceDays: null,
      reunionDate: null,
      moveTimeType: 'unknown',
      moveTimeValue: null,
      nextRelationshipReviewAt: null,
      certainty: 'unknown',
    },
    offers: [],
    checkIns: [],
    facts: [],
    decisions: [],
    currentDecisionId: null,
    routeDecision: {
      route: null,
      decidedAt: null,
      bridgeExitDate: null,
      gdSearchRestartDate: null,
      reasons: [],
      decisionPremises: [],
      nextMajorReviewAt: null,
      manualOverride: null,
    },
    reminders: [],
    decisionHistory: [],
  };
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isMoney = value => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const isScore = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5);
const isFacts = value => isObject(value) && Object.values(value).every(item => item === null || typeof item === 'boolean');
const CERTAINTIES = new Set(['confirmed', 'likely', 'rough', 'unknown']);
const ROUTES = new Set(['BASELINE_SETUP','MARKET_TESTING','HOLD_AND_SEARCH','GUANGDONG_READY','SHANGHAI_BRIDGE_READY','ROUTE_CHOICE_REQUIRED','NOTICE_AND_HANDOVER','SHANGHAI_BRIDGE_ACTIVE','GUANGDONG_MIGRATION','GUANGDONG_SETTLING','STABLE']);

export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateData(data) {
  if (!isObject(data) || ![1, 2].includes(data.schemaVersion)) throw new Error('备份版本不受支持。需要版本 1 或 2 的 JSON 数据。');
  for (const key of ["profile", "config", "baseline", "partnerPlan", "routeDecision"]) {
    if (!isObject(data[key])) throw new Error(`备份缺少有效的 ${key}。`);
  }
  for (const key of ["offers", "checkIns", "reminders", "decisionHistory"]) {
    if (!Array.isArray(data[key]) || !data[key].every(isObject)) throw new Error(`备份缺少有效的 ${key} 列表。`);
  }
  for (const key of ["targetCities", "targetRoles"]) {
    if (!Array.isArray(data.profile[key]) || !data.profile[key].every(value => typeof value === "string")) {
      throw new Error(`备份的 ${key} 无效。`);
    }
  }
  if (data.schemaVersion === 1 && typeof data.currentState !== 'string') throw new Error('备份的路线状态无效。');
  if (data.schemaVersion === 2 && (!ROUTES.has(data.routeState) || !['GREEN','YELLOW','RED','BLOCKED'].includes(data.riskState))) throw new Error('备份的路线或风险状态无效。');
  for (const key of ["debtBalance", "cashBalance", "monthlyNetIncome", "monthlyDebtPayment", "monthlyLivingCost", "oneOffCostsNext90Days"]) {
    if (key in data.baseline && !isMoney(data.baseline[key])) throw new Error(`备份的 ${key} 金额无效。`);
  }
  for (const key of ["gdMinNetIncome", "bridgeMinSixMonthGain", "bridgeMaxMonths", "maxLongDistanceDays", "driftNoActionDays", "planVarianceWarningRate"]) {
    if (key in data.config && !isMoney(data.config[key])) throw new Error(`备份的 ${key} 门槛无效。`);
  }
  for (const key of ["currentRoleGrowth", "energyLevel"]) {
    if (key in data.baseline && !isScore(data.baseline[key])) throw new Error(`备份的 ${key} 评分无效。`);
  }
  for (const key of ['careerFacts','energyFacts']) if (key in data.baseline && !isFacts(data.baseline[key])) throw new Error('备份的职业或工作体验事实无效。');
  for (const key of ['contractNoticeDays','availableHandoverDays','preferredHandoverDays']) if (data.baseline[key] != null && (!Number.isInteger(data.baseline[key]) || data.baseline[key] < 0)) throw new Error('备份的通知或交接天数无效。');
  if (data.config.bridgeMaxMonths != null && (!Number.isInteger(data.config.bridgeMaxMonths) || data.config.bridgeMaxMonths < 1 || data.config.bridgeMaxMonths > 6)) throw new Error('桥接复盘上限必须为 1–6 个月。');
  if (data.config.driftNoActionDays != null && (!Number.isInteger(data.config.driftNoActionDays) || data.config.driftNoActionDays < 1)) throw new Error('无行动检查周期必须为正整数天。');
  if (data.config.planVarianceWarningRate != null && data.config.planVarianceWarningRate > 1) throw new Error('财务偏差比例必须在 0–1 之间。');
  if (!isScore(data.config.gdMinCareerScore) || data.config.gdMinCareerScore === null) {
    throw new Error("备份的广东职业成长门槛无效。");
  }
  if (data.partnerPlan.sharedDestinationAligned != null && typeof data.partnerPlan.sharedDestinationAligned !== "boolean") {
    throw new Error("备份的共同方向无效。");
  }
  for (const key of ["earliestMoveDate", "latestMoveDate", "reunionDate", "nextRelationshipReviewAt", "longDistanceStartDate"]) {
    const value = data.partnerPlan[key];
    if (value != null && !isDate(value)) throw new Error(`备份的 ${key} 日期无效。`);
  }
  if (!Array.isArray(data.routeDecision.reasons)) throw new Error("备份的决策依据无效。");
  for (const offer of data.offers) {
    if ("status" in offer && !["none", "verbal", "written", "accepted"].includes(offer.status)) {
      throw new Error("备份的 Offer 状态无效。");
    }
    for (const key of ['grossIncome','monthlyNetIncome','monthlyLivingCost','relocationCost','switchingCost','probationNetIncome','probationMonths','transitionIncomeGapMonths']) {
      if (key in offer && !isMoney(offer[key])) throw new Error(`备份的 Offer ${key} 无效。`);
    }
    if (offer.probationRate != null && (!isMoney(offer.probationRate) || offer.probationRate > 100)) throw new Error('备份的试用期工资比例无效。');
    for (const key of ['targetAligned','termsConfirmed','pendingConditionsClear','noticeAgreementConfirmed','canDelayStart']) if (offer[key] != null && typeof offer[key] !== 'boolean') throw new Error('备份的 Offer 确认事实无效。');
    if ("careerScore" in offer && !isScore(offer.careerScore)) throw new Error("备份的 Offer 成长评分无效。");
    for (const key of ['startDate','responseDueDate','bridgeExitDate','gdSearchRestartDate']) if (offer[key] != null && offer[key] !== '' && !isDate(offer[key])) throw new Error(`备份的 Offer ${key} 日期无效。`);
    if ('careerFacts' in offer && !isFacts(offer.careerFacts)) throw new Error('备份的职业事实无效。');
    if ("sixMonthNetGain" in offer && offer.sixMonthNetGain !== null && !Number.isFinite(offer.sixMonthNetGain)) {
      throw new Error("备份的 Offer 六个月净改善无效。");
    }
  }
  const checkpointOverrides = data.config.checkpointOverrides ?? {};
  if (!isObject(checkpointOverrides) ||
      Object.values(checkpointOverrides).some(value => !isDate(value))) {
    throw new Error("备份的检查节点日期无效。");
  }
  for (const key of ["bridgeExitDate", "gdSearchRestartDate", "nextMajorReviewAt"]) {
    const value = data.routeDecision[key];
    if (value != null && !isDate(value)) throw new Error(`备份的 ${key} 日期无效。`);
  }
  if (data.schemaVersion === 2) {
    for (const key of ['facts', 'decisions']) if (!Array.isArray(data[key]) || !data[key].every(isObject)) throw new Error(`备份的 ${key} 无效。`);
    for (const fact of data.facts) if (!CERTAINTIES.has(fact.certainty) || typeof fact.value !== 'string') throw new Error('备份的新事实或确定程度无效。');
    for (const item of [data.routeDecision, ...data.decisions]) {
      if (!Array.isArray(item.decisionPremises) || item.decisionPremises.some(p => !isObject(p) || typeof p.text !== 'string' || !['valid','partially_valid','invalid','unknown'].includes(p.status))) throw new Error('备份的决策前提无效。');
      if (item.manualOverride != null && (!isObject(item.manualOverride) || typeof item.manualOverride.reason !== 'string' || !item.manualOverride.reason.trim() || !isDate(item.manualOverride.nextReviewAt))) throw new Error('备份的覆盖理由或复查日期无效。');
    }
  }
  const defaults = createInitialData();
  const priorState = data.currentState;
  // Preserve the v1 archive; never invent retrospective premises or discard user amounts.
  const migratedState = priorState === 'DRIFT_REVIEW' ? (data.routeDecision.route === 'shanghai_bridge' && data.routeDecision.startedAt ? 'SHANGHAI_BRIDGE_ACTIVE' : 'HOLD_AND_SEARCH') : priorState;
  const result = { ...defaults, ...data, schemaVersion: 2,
    routeState: data.routeState ?? migratedState ?? defaults.routeState,
    riskState: data.riskState ?? (priorState === 'DRIFT_REVIEW' ? 'YELLOW' : 'GREEN'),
    baseline: { ...defaults.baseline, ...data.baseline },
    partnerPlan: { ...defaults.partnerPlan, ...data.partnerPlan },
    routeDecision: { ...defaults.routeDecision, ...data.routeDecision },
    config: { ...defaults.config, ...data.config, checkpointOverrides } };
  delete result.currentState;
  if (!ROUTES.has(result.routeState)) throw new Error('备份的路线状态无效。');
  return result;
}

export function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === null ? createInitialData() : validateData(JSON.parse(saved));
}

export function saveData(data) {
  const valid = validateData(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  return valid;
}

export function clearData() {
  localStorage.removeItem(STORAGE_KEY);
}

export function importData(jsonText) {
  const data = validateData(JSON.parse(jsonText));
  return saveData(data);
}

export function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBackup(data) {
  const valid = validateData(data);
  const filename = `career-route-backup-${new Date().toISOString().slice(0, 10)}.json`;
  download(JSON.stringify(valid, null, 2), filename, "application/json;charset=utf-8");
  return filename;
}

export function appendDecision(data, decision) {
  const valid = validateData(data);
  if (!isObject(decision)) throw new Error("决策记录无效。");
  return {
    ...valid,
    decisionHistory: [...valid.decisionHistory, {
      ...decision,
      at: decision.at ?? new Date().toISOString(),
      source: decision.source ?? "system",
    }],
  };
}

export function recordRouteDecision(data, item) {
  if (!ROUTES.has(item.routeState) || !Array.isArray(item.decisionPremises) || item.decisionPremises.length < 2 || item.decisionPremises.length > 5 || !isDate(item.nextMajorReviewAt)) throw new Error('请选择路线、填写 2–5 条前提和下次复盘日。');
  const snapshot = { ...structuredClone(item), facts: structuredClone(data.facts), unknowns: structuredClone(item.unknowns ?? []), recordedBaseline: structuredClone(data.baseline), recordedPartnerPlan: structuredClone(data.partnerPlan), recordedOffers: structuredClone(data.offers) };
  return { ...data, routeState: item.routeState, currentDecisionId: item.id,
    decisions: [...data.decisions, snapshot], routeDecision: { ...data.routeDecision, ...item } };
}
