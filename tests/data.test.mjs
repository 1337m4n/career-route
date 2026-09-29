import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, clearData, createInitialData, importData, loadData, saveData, validateData } from '../data.mjs';

function withStorage(run) {
  const old = globalThis.localStorage;
  const items = new Map();
  globalThis.localStorage = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: key => { items.delete(key); },
  };
  try { run(items); } finally { globalThis.localStorage = old; }
}

test('旧标签页不能静默覆盖另一标签页保存的记录', () => withStorage(() => {
  const first = loadData(), stale = loadData();
  first.baseline.cashBalance = 20000;
  saveData(first);
  assert.equal(first.storageRevision, 1);
  stale.baseline.cashBalance = 10000;
  assert.throws(() => saveData(stale), /另一标签页更新/);
  assert.equal(loadData().baseline.cashBalance, 20000);
  first.baseline.cashBalance = 30000;
  saveData(first);
  assert.equal(loadData().storageRevision, 2);
}));

test('主动导入明确替换，版本递增；旧 v1/v2 备份仍可迁移', () => withStorage(() => {
  const current = loadData();
  current.baseline.cashBalance = 30000;
  saveData(current);
  const imported = createInitialData();
  imported.baseline.cashBalance = 40000;
  imported.storageRevision = 0;
  const firstImport = importData(JSON.stringify(imported), current);
  assert.equal(firstImport.storageRevision, 2);
  assert.equal(loadData().baseline.cashBalance, 40000);
  const v1 = createInitialData();
  v1.schemaVersion = 1;
  v1.currentState = 'MARKET_TESTING';
  delete v1.routeState;
  delete v1.riskState;
  delete v1.facts;
  delete v1.decisions;
  delete v1.storageRevision;
  const migrated = importData(JSON.stringify(v1), firstImport);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.routeState, 'MARKET_TESTING');
  assert.equal(migrated.storageRevision, 3);
  const v2 = createInitialData();
  delete v2.storageRevision;
  assert.equal(validateData(v2).storageRevision, 0);
}));

test('畸形事实日期和嵌套历史在写入前拒绝，旧存档保持原样', () => withStorage(items => {
  const current = createInitialData();
  saveData(current);
  const original = items.get(STORAGE_KEY);
  const cases = [
    d => { d.facts = [{ value: '现金变化', certainty: 'confirmed', recordedAt: 42 }]; },
    d => { d.checkIns = [{ type: 'market', createdAt: 42, gdApplications: 1 }]; },
    d => { d.checkIns = [{ type: 'market', searchPauseReason: 'work', pauseReviewAt: '2026-10-01' }]; },
    d => { d.checkIns = [{ type: 'market', createdAt: '2026-09-29T00:00:00Z', waitReason: 42 }]; },
    d => { d.checkIns = [{ type: 'light', createdAt: '2026-09-29T00:00:00Z', pendingSync: 'true' }]; },
    d => { d.checkIns = [{ type: 'light', syncedAt: 42 }]; },
    d => { d.decisionHistory = [{ at: 42 }]; },
    d => { d.decisionHistory = [{ reasons: 'not-a-list' }]; },
    d => { d.routeDecision.decisionPremises = [{ text: '理由', status: 'valid', reviewedAt: 42 }]; },
    d => { d.decisions = [{ decisionPremises: [], decidedAt: 42 }]; },
  ];
  for (const mutate of cases) {
    const bad = createInitialData();
    mutate(bad);
    assert.throws(() => importData(JSON.stringify(bad), current));
    assert.equal(items.get(STORAGE_KEY), original);
  }
  const good = createInitialData();
  good.checkIns = [{ type: 'light', factType: 'financial', pendingSync: true, createdAt: '2026-09-29T00:00:00.000Z', syncedAt: null }];
  assert.equal(validateData(good).checkIns[0].pendingSync, true);
}));

test('旧标签页不能清空或导入覆盖新记录；损坏存档可经显式恢复', () => withStorage(items => {
  const stale = loadData(), fresh = loadData();
  fresh.baseline.cashBalance = 50000;
  saveData(fresh);
  assert.throws(() => clearData(stale), /另一标签页更新/);
  assert.throws(() => importData(JSON.stringify(createInitialData()), stale), /另一标签页更新/);
  assert.equal(loadData().baseline.cashBalance, 50000);
  items.set(STORAGE_KEY, '{broken json');
  assert.throws(() => importData(JSON.stringify(createInitialData()), fresh));
  const recovered = importData(JSON.stringify(createInitialData()), fresh, { recovery: true });
  assert.equal(recovered.storageRevision, 1);
  clearData(recovered);
  assert.deepEqual(JSON.parse(items.get(STORAGE_KEY)), { cleared: true, storageRevision: 2 });
  assert.equal(loadData().storageRevision, 2);
  assert.throws(() => saveData(stale), /另一标签页更新/);
  const afterClear = loadData();
  afterClear.baseline.cashBalance = 70000;
  saveData(afterClear);
  assert.equal(loadData().baseline.cashBalance, 70000);
}));
