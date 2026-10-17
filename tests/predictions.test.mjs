import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const scopeUrl = dataUrl(compile("src/lib/operationalScope.ts"));
const scope = await import(scopeUrl);

// A regra nova precisa ser extremamente específica: Box + rotina Box + UTI 3C/3D/3E.
assert.equal(scope.isTerminalBoxRoutine("Limpeza Terminal Box", null), true);
assert.equal(scope.isTerminalBoxRoutine("Limpeza Terminal Leito", null), false);
assert.equal(scope.isTerminalBoxLocation("Box 07"), true);
assert.equal(scope.isTerminalBoxLocation("Corredor - Box 05|08"), false);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco C 03º Andar - UTI"), true);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco D 03º Andar - UTI Adulto"), true);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco E 3º Andar - Semi/UTI"), true);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco C 03º Andar"), true);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco C 04º Andar - UTI"), false);
assert.equal(scope.isTerminalUtiBoxUnit("Bloco B 03º Andar - UTI"), false);
assert.equal(scope.isExcludedUnit("Bloco C 03º Andar - UTI"), true, "leitos 3C continuam excluídos");

const moduleCode = compile("src/lib/predictions.ts")
  .replace('from "@/lib/operationalScope"', `from "${scopeUrl}"`);
const { parseCommandCenterCsv, normalizePredictionRows } = await import(dataUrl(moduleCode));

const csv = [
  "Setor Origem,Disp. Andar,Leito Origem,Procedência,Tempo Espera,ID,Nome,Idade,Médico,Prob. Alta,Estabelecimento",
  "D - UI 15º andar,0,D1556,Alta Medica,03:37,100,A.B,50,C.D,-,Bela Vista",
  "D - UI 14º andar,0,D1441,Alta real,01:37,101,E.F,51,G.H,-,Bela Vista",
  "D - UCO - 3º andar,0,D66,Alta Medica,00:37,102,I.J,52,K.L,-,Bela Vista",
  "D - UI 15º andar,0,D1558,Alta Medica,01:37,103,M.N,53,O.P,-,Brasília",
  "C - UI 6º andar,0,C608,Alta Medica,02:37,104,Q.R,54,S.T,-,Bela Vista",
  "D - UI 15º andar,0,D1556,Alta real,03:37,105,U.V,55,W.X,-,Bela Vista",
].join("\n");

const parsed = parseCommandCenterCsv(csv);
assert.equal(parsed.total, 6);
assert.equal(parsed.predictions.length, 3, "Bela Vista only, 3D excluded and beds deduped");
assert.deepEqual(
  parsed.predictions.map((p) => [p.bed_number, p.probability_text]).sort(),
  [["Leito 1441", "Alta Real"], ["Leito 1556", "Alta Real"], ["Leito 608", "Alta Médica"]].sort(),
);
assert(parsed.predictions.every((p) => p.probability_value === null && p.predicted_time === null));
assert(!JSON.stringify(parsed.predictions).includes("A.B"), "no patient identifiers in predictions");

// Same bed on different blocks must stay separate.
const otherBlock = normalizePredictionRows([
  { establishment: "Bela Vista", sector: "C - UI 15º andar", bed: "C1556", probability: "-", dischargeType: "Alta Medica" },
  { establishment: "Bela Vista", sector: "D - UI 15º andar", bed: "D1556", probability: "-", dischargeType: "Alta Medica" },
]);
assert.equal(otherBlock.length, 2);

// The probability column is optional for future CSV exports.
const withoutProbability = csv.replace(",Prob. Alta", "").split("\n").map((line, i) =>
  i === 0 ? line : line.replace(",-,Bela Vista", ",Bela Vista").replace(",-,Brasília", ",Brasília")
).join("\n");
assert.equal(parseCommandCenterCsv(withoutProbability).predictions.length, 3);
console.log("Predictions CSV validation passed");
