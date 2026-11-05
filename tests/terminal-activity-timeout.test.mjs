import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  TERMINAL_DISMANTLE_TIMEOUT_MS,
  TERMINAL_HYGIENE_TIMEOUT_MS,
  isTerminalActivityTimedOut,
} from "../src/lib/terminalActivityTimeout.ts";

const now = Date.parse("2026-11-05T10:00:00.000Z");
const record = (prefix, status, ageMs, extra = {}) => ({
  external_id: `${prefix}bed:bloco-d-16-andar-ala-1|leito-1649`,
  status,
  status_updated_at: new Date(now - ageMs).toISOString(),
  bed_number: "Leito 1649",
  last_answer_id: "18216654",
  ...extra,
});
const desmont = (ageMs, opts) => record("listo:desmont:", "in_progress", ageMs, opts);
const hygiene = (ageMs, opts) => record("listo:answer:", "in_progress", ageMs, opts);

test("desmontagem continua ativa aos 34m59s, expira exatamente aos 35m", () => {
  assert.equal(TERMINAL_DISMANTLE_TIMEOUT_MS, 2_100_000);
  assert.equal(isTerminalActivityTimedOut(desmont(TERMINAL_DISMANTLE_TIMEOUT_MS - 1000), now), false);
  assert.equal(isTerminalActivityTimedOut(desmont(TERMINAL_DISMANTLE_TIMEOUT_MS), now), true);
  assert.equal(isTerminalActivityTimedOut(desmont(8 * 60 * 60 * 1000), now), true);
});

test("higienização continua ativa antes de 4 horas e expira exatamente às 4 horas", () => {
  assert.equal(TERMINAL_HYGIENE_TIMEOUT_MS, 14_400_000);
  assert.equal(isTerminalActivityTimedOut(hygiene(TERMINAL_HYGIENE_TIMEOUT_MS - 1000), now), false);
  assert.equal(isTerminalActivityTimedOut(hygiene(TERMINAL_HYGIENE_TIMEOUT_MS), now), true);
  assert.equal(isTerminalActivityTimedOut(hygiene(8 * 60 * 60 * 1000), now), true);
});

test("Limpeza Terminal Box (UTI) usa o mesmo limite de 4 horas", () => {
  const box = record("listo:box:", "in_progress", TERMINAL_HYGIENE_TIMEOUT_MS);
  assert.equal(isTerminalActivityTimedOut(box, now), true);
});

test("nenhum limite altera Alta Parada, A Caminho, pausados ou concluídos", () => {
  for (const status of ["waiting_cleaning", "en_route", "paused", "maintenance", "completed", "completed_with_issues"]) {
    assert.equal(isTerminalActivityTimedOut(record("listo:answer:", status, 10 * 60 * 60 * 1000), now), false);
  }
  assert.equal(isTerminalActivityTimedOut(record("snapshot:last-completed:", "in_progress", 10 * 60 * 60 * 1000), now), false);
});

test("nova alta do MESMO leito aparece normalmente com novo início/answer", () => {
  const oldCycle = hygiene(8 * 60 * 60 * 1000);
  const newCycle = hygiene(5 * 60 * 1000, { last_answer_id: "18217777" });
  assert.equal(oldCycle.external_id, newCycle.external_id);
  assert.equal(isTerminalActivityTimedOut(oldCycle, now), true);
  assert.equal(isTerminalActivityTimedOut(newCycle, now), false);
  assert.equal(isTerminalActivityTimedOut(oldCycle, now), true, "a origem antiga continua ignorada");
});

test("atividade não é automaticamente concluída e timestamps inválidos não inventam estados", () => {
  const old = desmont(8 * 60 * 60 * 1000);
  assert.equal(isTerminalActivityTimedOut(old, now), true);
  assert.equal(old.status, "in_progress");
  assert.equal(isTerminalActivityTimedOut({...old, status_updated_at: "invalid"}, now), false);
  assert.equal(isTerminalActivityTimedOut(old, Number.NaN), false);
});

test("o filtro do Terminal opera antes de KPIs, colaboradores e cards sem tocar nos dados da origem", () => {
  const tv = fs.readFileSync("src/routes/tv.tsx", "utf8");
  assert.match(tv, /const filtered = useMemo\(/);
  assert.match(tv, /!isTerminalActivityTimedOut\(d, now\)/);
  assert.ok(tv.indexOf("!isTerminalActivityTimedOut(d, now)") < tv.indexOf("const inFlight = useMemo("));
  assert.ok(tv.indexOf("!isTerminalActivityTimedOut(d, now)") < tv.indexOf("const dismantles = useMemo("));
  const sync = fs.readFileSync("src/routes/api/public/hooks/sync-listo360.ts", "utf8");
  assert.doesNotMatch(sync, /TERMINAL_DISMANTLE_TIMEOUT_MS|TERMINAL_HYGIENE_TIMEOUT_MS/);
});
