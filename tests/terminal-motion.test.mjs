import assert from "node:assert/strict";
import fs from "node:fs";

const tv = fs.readFileSync("src/routes/tv.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const autoScroll = fs.readFileSync("src/components/AutoScroll.tsx", "utf8");
const modal = fs.readFileSync("src/components/DischargeTimelineModal.tsx", "utf8");

// Red alerts remain visually identifiable but never flash forever.
assert.doesNotMatch(tv, /tv-critical-breathe/);
assert.doesNotMatch(css, /tv-critical-breathe|@keyframes tv-critical-breathe/);
assert.match(tv, /const OVERDUE_COLOR =/);
assert.match(tv, /mais antigo/);
assert.match(tv, /Estourado/);

// Stable React identity prevents remounts on each status change.
assert.match(tv, /key=\{d\.id\}\s*data-motion-bed=/);
assert.doesNotMatch(tv, /key=\{\x60\$\{d\.id\}-v\$\{version\}\x60\}/);

// Flow motion does not run every clock tick or during reduced motion.
assert.match(tv, /useLayoutEffect\(\(\) =>/);
assert.match(tv, /\}, \[layoutSignature\]\);/);
assert.match(tv, /nodes\.length <= 40/);
assert.match(tv, /prefers-reduced-motion: reduce/);

// A completed bed is handed off to the already existing recent-completion UI.
assert.doesNotMatch(tv, /completionFx|tv-completion-fx/);
assert.match(tv, /tv-recent-completed-in/);

// Keep the manual-scroll pause, with rate-independent motion.
assert.match(autoScroll, /const USER_PAUSE_MS = 15_000/);
assert.match(autoScroll, /PIXELS_PER_SECOND/);
assert.match(autoScroll, /document\.hidden/);
assert.match(autoScroll, /prefers-reduced-motion: reduce/);

// Existing premium dialog, focus/keyboard and mobile behavior remain intact.
assert.match(modal, /useModalFocus/);
assert.match(modal, /onKeyDown/);
assert.match(modal, /max-h-\[min\(92dvh,790px\)\]/);
assert.match(css, /bed-detail-dialog-in/);
assert.match(css, /prefers-reduced-motion: reduce/);

console.log("terminal motion safeguards passed");
