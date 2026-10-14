import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const scopeUrl = dataUrl(compile("src/lib/operationalScope.ts"));
const code = compile("src/lib/predictions.ts")
  .replace('from "@/lib/operationalScope"', 'from "' + scopeUrl + '"');
const { parsePriorityXls, normalizePriorityRows } = await import(dataUrl(code));

// O relatório de prioridades é tabulado e contém colunas pessoais ignoradas.
const header = "Probabilidade\tHora/Min\tUnidade\tPaciente\tMédico\tSetor atendimento\tUsuário\tAtendimento\t";
const row = (status, time, bed, sector, patient = "Paciente Teste") =>
  [status, time, bed, patient, "Médico Teste", sector, "usuario_teste", "123456", ""].join("\t");
const xls = [
  header,
  row("Alta médica assinada", "14/10/2026 15:00:19", "D1556", "Unidade Internação - D - 15º andar - Ala I"),
  row("Alta prevista confirmada", "14/10/2026 09:00:19", "C707", "Unidade de Internação - C - 07º andar"),
  row("Alta prevista não confirmada", "14/10/2026 19:45:19", "C611", "Unidade de Internação - C - 06º andar"),
  row("Alta prevista confirmada", "14/10/2026 09:00:19", "D71", "Unidade Coronária - D - 03º andar"), // 3D excluído
  row("Alta prevista confirmada", "14/10/2026 09:00:19", "PreOp -10A", "Unidade Pré Operatória - E - 05º andar"),
  row("Alta prevista não confirmada", "14/10/2026 12:06:19", "T101", "Unidade de Medicina do Sono - Domiciliar"),
  row("Alta médica assinada", "14/10/2026 15:00:19", "D1556", "Unidade Internação - D - 15º andar - Ala I"), // duplicado
].join("\n");

const parsed = parsePriorityXls(xls);
assert.equal(parsed.total, 7);
assert.equal(parsed.predictions.length, 3);
assert.deepEqual(parsed.predictions.map(x => x.bed_number).sort(), ["Leito 1556", "Leito 611", "Leito 707"].sort());
const signed = parsed.predictions.find(x => x.bed_number === "Leito 1556");
assert.equal(signed.probability_text, "Alta médica assinada");
assert.equal(signed.predicted_at, "2026-10-14T18:00:19.000Z");
assert.equal(signed.predicted_time, "2026-10-14T18:00:19.000Z");
assert(!JSON.stringify(parsed.sources).includes("Paciente Teste"));
assert(!JSON.stringify(parsed.sources).includes("123456"));
assert(!JSON.stringify(parsed.predictions).includes("Médico Teste"));
assert.throws(() => parsePriorityXls("Estabelecimento,Setor Origem,Leito Origem\nBela Vista,D1556,D1556"), /XLS inválido/);

assert.equal(normalizePriorityRows([{
  status: "Alta prevista confirmada", predictedAt: "2026-10-14T12:00:19.000Z",
  bed: "B826", sector: "Unidade de Internação - B - 08º andar - TMO",
}]).length, 1);
assert.equal(normalizePriorityRows([{
  status: "Alta prevista confirmada", predictedAt: "",
  bed: "B826", sector: "Unidade de Internação - B - 08º andar - TMO",
}]).length, 0);

const invalidDate = parsePriorityXls([
  header,
  row("Alta médica assinada", "31/02/2026 15:00:19", "D1556", "Unidade Internação - D - 15º andar - Ala I"),
].join("\n"));
assert.equal(invalidDate.predictions.length, 0, "invalid calendar date must not be imported");

console.log("Priority XLS forecast parsing passed");
