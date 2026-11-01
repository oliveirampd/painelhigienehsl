import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("src/lib/dailyAggregation.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { latestDailyEvent } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const running = { status: "in_progress", at: "2026-11-01T12:00:00.000Z" };
const completed = { status: "completed", at: "2026-11-01T12:20:00.000Z" };
assert.equal(latestDailyEvent(running, completed), completed);
assert.equal(latestDailyEvent(completed, running), completed);
const restarted = { status: "in_progress", at: "2026-11-01T12:30:00.000Z" };
assert.equal(latestDailyEvent(completed, restarted), restarted);
const tiedCompletion = { status: "completed", at: running.at };
assert.equal(latestDailyEvent(running, tiedCompletion), tiedCompletion);
console.log("daily aggregation tests passed");
