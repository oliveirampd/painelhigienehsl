import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Executa a função REAL de apresentação, sem mockar suas regras.
const source = fs.readFileSync("src/lib/terminalDisplayStage.ts", "utf8");
const stripped = stripTypeScriptTypes(source, { mode: "strip" });
const url = `data:text/javascript;base64,${Buffer.from(stripped).toString("base64")}`;
const { preserveTerminalStageProgress } = await import(url);

const mk = (status, answerId = "818-20261104", overrides = {}) => ({
  external_id: "listo:answer:bed:bloco-c-08-andar|leito-818",
  last_answer_id: answerId,
  id: "terminal-818",
  bed_number: "Leito 818",
  unit: "Bloco C 08º Andar",
  status,
  status_updated_at: "2026-11-04T13:00:00Z",
  assigned_staff_id: "responsavel-higiene",
  ...overrides,
});

function present(rows, memory = new Map()) {
  return preserveTerminalStageProgress(rows, memory);
}

test("mesmo answer não volta de higiene iniciada para A Caminho", () => {
  const first = present([mk("in_progress", "123", { status_updated_at: "2026-11-04T13:08:00Z" })]);
  const second = present(
    [mk("en_route", "123", { assigned_staff_id: null, status_updated_at: "2026-11-04T13:11:00Z" })],
    first.memory,
  );
  assert.equal(second.rows[0].status, "in_progress");
  assert.equal(second.rows[0].assigned_staff_id, "responsavel-higiene");
  assert.equal(second.rows[0].status_updated_at, "2026-11-04T13:08:00Z");

  const third = present([mk("waiting_cleaning", "123")], second.memory);
  assert.equal(third.rows[0].status, "in_progress");
});

test("mesmo answer não volta de A Caminho para Alta Parada", () => {
  const first = present([mk("en_route", "123")]);
  const second = present([mk("waiting_cleaning", "123")], first.memory);
  assert.equal(second.rows[0].status, "en_route");
});

test("answer novo reinicia o ciclo e permite Alta Parada", () => {
  const first = present([mk("in_progress", "123")]);
  const second = present([mk("waiting_cleaning", "124")], first.memory);
  assert.equal(second.rows[0].status, "waiting_cleaning");
});

test("conclusão, pausa e exclusão não são retidas artificialmente", () => {
  const first = present([mk("in_progress", "123")]);
  const completed = present([mk("completed", "123", { completed_at: "2026-11-04T14:00:00Z" })], first.memory);
  assert.equal(completed.rows[0].status, "completed");
  assert.equal(completed.memory.size, 0);

  const paused = present([mk("paused", "123")], first.memory);
  assert.equal(paused.rows[0].status, "paused");
  assert.equal(paused.memory.size, 0);

  const removed = present([], first.memory);
  assert.equal(removed.memory.size, 0);
});

test("registros de desmontagem continuam independentes da higiene", () => {
  const dismantle = mk("in_progress", "999", {
    external_id: "listo:desmont:bed:bloco-c-08-andar|leito-818",
    assigned_staff_id: "responsavel-desmontagem",
  });
  const result = present([dismantle]);
  assert.equal(result.rows[0].assigned_staff_id, "responsavel-desmontagem");
  assert.equal(result.memory.size, 0);
});

test("Terminal dá prioridade ao nome do responsável pela higiene e não ao da desmontagem", () => {
  const tv = fs.readFileSync("src/routes/tv.tsx", "utf8");
  assert.ok(tv.includes("const displayName = name ?? dismantleName;"));
  assert.ok(tv.includes('prev.kind !== "em_alta"'));
  assert.ok(tv.includes("lateDismantleWindowMs = 4 * 60 * 60 * 1000"));
  assert.ok(!tv.includes("const displayName = dismantleName ?? name"));
});
