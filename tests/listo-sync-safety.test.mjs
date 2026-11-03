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

// Incidente 03/11: 356 relevantes como baseline histórico, agora ~182,
// mas mais de 3.500 respostas e 8 páginas completas por sincronização.
// Antes, esse cenário marcava a origem como parcial para sempre.
const coverage = {
  currentRelevant: 182, previousRelevant: 356,
  currentAnswers: 3602, previousAnswers: 3596,
  currentPages: 8, previousPages: 8,
};
assert.equal(api.isSuspiciousListoCoverage(coverage), false);
assert.equal(api.isSuspiciousListoCoverage({...coverage, currentRelevant: 0}), true);
assert.equal(api.isSuspiciousListoCoverage({...coverage, currentAnswers: 800, currentPages: 2}), true);
assert.equal(api.isSuspiciousListoCoverage({...coverage, currentRelevant: 350}), false);
assert.equal(api.isSuspiciousListoCoverage({...coverage, currentAnswers: 800, currentPages: 2, currentRelevant: 350}), false);

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

assert.equal(api.isNewListoCycleAnswer(18206123, "18205000"), true);
assert.equal(api.isNewListoCycleAnswer(18205000, "18205000"), false);
assert.equal(api.isNewListoCycleAnswer(18204999, "18205000"), false);
assert.equal(api.isNewListoCycleAnswer(18206123, null), false);

// Data do novo registro pode vir sem hora (meia-noite) no Listo.
// A ordem é pelo ID da resposta, NÃO pela data de fim da alta anterior.
assert.equal(
  api.isNewerListoAnswer(
    { id: 18206123, date: "2026-11-02T00:00:00", startTime: null },
    { id: 18205000, endTime: "2026-11-02T09:15:00" },
  ),
  true,
);
assert.equal(api.isNewerListoAnswer({ id: 18205000 }, { id: 18206123 }), false);

// Regressão 01/11: quatro leitos sumiram do snapshot do Listo, mas permaneceram
// indefinidamente como waiting_cleaning. Testa a reconciliação sem autoconcluir.
const moment = Date.parse("2026-11-03T10:09:00.000Z");
const insideWindow = "2026-11-02T22:27:06.000Z";
const outsideWindow = "2026-11-02T09:00:00.000Z";
assert.equal(api.activeRecordCoveredByLookback("waiting_cleaning", insideWindow, moment), true);
assert.equal(api.activeRecordCoveredByLookback("en_route", insideWindow, moment), true);
assert.equal(api.activeRecordCoveredByLookback("in_progress", insideWindow, moment), true);
assert.equal(api.activeRecordCoveredByLookback("paused", insideWindow, moment), true);
assert.equal(api.activeRecordCoveredByLookback("completed", insideWindow, moment), false);
assert.equal(api.activeRecordCoveredByLookback("completed_with_issues", insideWindow, moment), false);
assert.equal(api.activeRecordCoveredByLookback("waiting_cleaning", outsideWindow, moment), false);
assert.equal(api.activeRecordCoveredByLookback("waiting_cleaning", "not-a-date", moment), false);

let observed = {};
for (const [i, minute] of [0, 1, 2].entries()) {
  const change = api.updateMissingSyncState({
    previous: observed,
    freshIds: new Set(["listo:answer:bed:presente"]),
    staleIds: ["listo:answer:bed:leito-1415", "listo:box:bed:box-78"],
    nowMs: moment + minute * 60_000,
    allowMissIncrement: true,
    minMisses: 3,
    minAgeMs: 90_000,
  });
  observed = change.next;
  assert.deepEqual(
    change.deleteIds.sort(),
    i === 2
      ? ["listo:answer:bed:leito-1415", "listo:box:bed:box-78"].sort()
      : [],
  );
}

const syncSource = fs.readFileSync("src/routes/api/public/hooks/sync-listo360.ts", "utf8");
assert.match(syncSource, /formatListoDateBRT/);
assert.match(syncSource, /activeRecordCoveredByLookback\(d\.status, d\.status_updated_at/);
assert.match(syncSource, /minMisses: 3/);
assert.match(syncSource, /minAgeMs: 90_000/);
assert.match(syncSource, /\.in\("status", \[\.\.\.RECONCILABLE_ACTIVE_STATUSES\]\)/);
assert.match(syncSource, /suspiciousPartial \? \[\] : observation\.deleteIds/);
assert.match(syncSource, /oldActiveWithoutCoverage/);
assert.match(syncSource, /isSuspiciousListoCoverage\(\{/);
assert.match(syncSource, /previousAnswers: runtimeState\.last_answers_count/);
assert.match(syncSource, /previousPages: runtimeState\.last_pages/);
assert.doesNotMatch(syncSource, /STALE_LIMIT_MIN/);
assert.match(syncSource, /completed_with_issues/);
assert.match(syncSource, /if \(!cronSecret\)/);
assert.match(syncSource, /\.eq\("lock_until", ownedLockUntil/);
assert.match(syncSource, /preservedAbsentCount/);
assert.match(syncSource, /isNewerListoAnswer\(a, prev\)/);
assert.match(syncSource, /isNewListoCycleAnswer\(a\.id, prevRow\.last_answer_id\)/);
assert.match(syncSource, /origem_estados_ativos: rawTerminalStatusCounts/);


console.log("listo sync safety tests passed");
