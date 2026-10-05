import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const scopeUrl = dataUrl(compile("src/lib/operationalScope.ts"));
const scope = await import(scopeUrl);
for (const unit of [
  "Bloco B 05º Andar",
  "9C",
  "Bloco C 13º Andar",
  "12º Andar · Bloco C",
  "3D",
  "03C",
])
  assert.equal(scope.isExcludedUnit(unit), true, unit);
assert.equal(scope.isExcludedUnit("Bloco D 08º Andar"), false);
assert.equal(scope.isExcludedUnit("Bloco C 19º Andar"), false);
assert.equal(
  scope.operationalBedKey("Bloco D 08º Andar", "Leito 801"),
  scope.operationalBedKey("bloco d 08 andar", "LEITO 801"),
  "unit + bed identity ignores accents, case and spacing",
);
assert.notEqual(
  scope.operationalBedKey("Bloco D 08º Andar", "Leito 801"),
  scope.operationalBedKey("Bloco E 08º Andar", "Leito 801"),
  "the same bed label in another unit has a different snapshot",
);
const moduleCode = compile("src/lib/listoAnalytics.server.ts")
  .replace('"@/lib/operationalScope"', JSON.stringify(scopeUrl))
  .replace(
    'import { TERMINAL_GERAL_AREAS } from "@/lib/terminalGeralAreas";',
    "const TERMINAL_GERAL_AREAS = [];",
  );
const api = await import(dataUrl(moduleCode));
const start = new Date(Date.now() - 2 * 3600000).toISOString();
const end = new Date(Date.now() - 3600000).toISOString();
const row = {
  id: 1,
  sectorName: "Bloco D 08º Andar",
  sectorDescription: null,
  locationName: "Leito 801",
  routeName: "Limpeza terminal",
  inspectionName: null,
  userName: "Ana",
  answerComment: null,
  startTime: start,
  endTime: end,
  date: new Date(Date.now() - 3 * 3600000).toISOString(),
  statusAnswer: { id: 3 },
};
const rows = [
  row,
  { ...row, id: 2 },
  { ...row, id: 3, sectorName: "Bloco E 08º Andar" },
  { ...row, id: 4, sectorName: "Bloco C 09º Andar" },
  { ...row, id: 5, locationName: "Leito 802", statusAnswer: { id: 4 } },
  { ...row, id: 6, locationName: "Leito 803", endTime: start, startTime: end },
  { ...row, id: 7, routeName: "Desmontagem" },
];
const altas = api.buildTerminalCycles(rows);
assert.equal(altas.length, 4, "duplicates merge, excluded units removed, units stay distinct");
assert.deepEqual(altas.find((x) => x.bed === "Leito 801" && x.block === "D").answerIds, [1, 2]);
assert.equal(
  altas.filter((x) => x.completedAt).length,
  2,
  "paused and reversed timestamps are not completions",
);
assert.equal(api.buildTerminalCycles(rows, "desmontagem").length, 1);
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => (String(url).includes("auth/login") ? { token: "test" } : rows),
});
const result = await api.loadOperationsAnalytics();
assert.equal(result.totalSample, 4);
assert.equal(result.excludedRecords, 1);
assert.equal(result.staffProductivity[0].altas, 4);
assert.equal(result.staffProductivity[0].completed, 2);
assert.equal(result.staffProductivity[0].dismantlesCompleted, 1);
assert.equal(result.staffProductivity[0].executionSamples, 2);
assert.equal(result.staffProductivity[0].avgExecutionMin, 60);
assert.equal(result.staffProductivity[0].withinTargetPct, 100);
assert.equal(
  result.days.reduce((sum, d) => sum + d.executionSamples, 0),
  2,
);
assert.equal(result.recentCycles.length, result.totalSample);
assert.equal(result.samplePartial, false);
const conflicted = api.buildTerminalCycles([row, { ...row, id: 9, userName: "Beatriz" }]);
assert.equal(conflicted[0].staff, "Atribuição divergente");
console.log(
  "Analytics: exclusion, deduplication, completion, attribution, denominator and source audit checks passed.",
);

