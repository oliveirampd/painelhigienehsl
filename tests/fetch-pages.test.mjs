import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("src/lib/fetchPages.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fetchPages } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const sourceRows = Array.from({ length: 1015 }, (_, id) => ({ id }));
const ranges = [];
const rows = await fetchPages(async (from, to) => {
  ranges.push([from, to]);
  return { data: sourceRows.slice(from, to + 1), error: null };
});
assert.equal(rows.length, 1015);
assert.equal(rows[1014].id, 1014);
assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);

await assert.rejects(fetchPages(async (from) => ({
  data: from === 0 ? sourceRows.slice(0, 500) : null,
  error: from === 0 ? null : new Error("page failed"),
})), /page failed/);
console.log("paginated load tests passed");
