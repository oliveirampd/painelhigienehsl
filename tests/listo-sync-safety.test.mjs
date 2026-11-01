import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("src/lib/listoSyncSafety.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

assert.equal(
  api.formatListoDateBRT(new Date("2026-11-01T02:00:00.000Z")),
  "2026-10-31T23:00:00",
);
assert.equal(
  api.formatListoDateBRT(new Date("2026-10-31T02:00:00.000Z")),
  "2026-10-30T23:00:00",
);

assert.equal(api.isSuspiciousPartialResponse(0, 100), true);
assert.equal(api.isSuspiciousPartialResponse(64, 100), true);
assert.equal(api.isSuspiciousPartialResponse(65, 100), false);
assert.equal(api.isSuspiciousPartialResponse(5, null), false);

assert.equal(api.selectRelevantBaseline(284, 449, true), 449);
assert.equal(api.selectRelevantBaseline(284, 449, false), 284);
assert.equal(api.selectRelevantBaseline(12, null, true), 12);

const t0 = Date.parse("2026-10-31T12:00:00.000Z");
let state = {};
let result = api.updateMissingSyncState({
  previous: state,
  freshIds: new Set(["listo:a"]),
  staleIds: ["listo:b"],
  nowMs: t0,
  allowMissIncrement: true,
});
assert.equal(result.next["listo:b"].count, 1);
assert.deepEqual(result.deleteIds, []);

result = api.updateMissingSyncState({
  previous: result.next,
  freshIds: new Set(["listo:a"]),
  staleIds: ["listo:b"],
  nowMs: t0 + 60_000,
  allowMissIncrement: true,
});
assert.equal(result.next["listo:b"].count, 2);
assert.deepEqual(result.deleteIds, []);

result = api.updateMissingSyncState({
  previous: result.next,
  freshIds: new Set(["listo:a"]),
  staleIds: ["listo:b"],
  nowMs: t0 + 120_000,
  allowMissIncrement: true,
});
assert.equal(result.next["listo:b"].count, 3);
assert.deepEqual(result.deleteIds, ["listo:b"]);

const partial = api.updateMissingSyncState({
  previous: result.next,
  freshIds: new Set(["listo:a"]),
  staleIds: ["listo:c"],
  nowMs: t0 + 180_000,
  allowMissIncrement: false,
});
assert.equal(partial.next["listo:c"], undefined);

const recovered = api.updateMissingSyncState({
  previous: result.next,
  freshIds: new Set(["listo:b"]),
  staleIds: [],
  nowMs: t0 + 180_000,
  allowMissIncrement: true,
});
assert.equal(recovered.next["listo:b"], undefined);

assert.equal(api.computeSyncBackoffMs(1), 55_000);
assert.equal(api.computeSyncBackoffMs(2), 115_000);
assert.equal(api.computeSyncBackoffMs(3), 235_000);
assert.equal(api.computeSyncBackoffMs(1, 429), 115_000);
assert.equal(api.hasProvenNewCycle(new Date(t0 + 1), new Date(t0).toISOString()), true);
assert.equal(api.hasProvenNewCycle(new Date(t0), new Date(t0).toISOString()), false);
assert.equal(api.hasProvenNewCycle(null, new Date(t0).toISOString()), false);

const syncSource = fs.readFileSync("src/routes/api/public/hooks/sync-listo360.ts", "utf8");
assert.match(syncSource, /formatListoDateBRT/);
assert.doesNotMatch(syncSource, /\.delete\(\)\.in\("external_id"/);
assert.doesNotMatch(syncSource, /STALE_LIMIT_MIN/);
assert.match(syncSource, /completed_with_issues/);
assert.match(syncSource, /if \(!cronSecret\)/);
assert.match(syncSource, /\.eq\("lock_until", ownedLockUntil/);
assert.match(syncSource, /preservedAbsentCount/);

console.log("listo sync safety tests passed");
