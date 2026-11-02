import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require("playwright");
const output = process.env.MOTION_RESULTS || "motion-results";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const url = "http://127.0.0.1:4173/tests/motion/index.html";
const fixture = (method, ...args) =>
  page.evaluate(({ method, args }) => window.motionFixture[method](...args), { method, args });
const settle = () => page.waitForTimeout(650);
const card = (id) => page.locator(`[data-bed-id="${id}"]`);
const checkOverflow = async () => {
  const widths = await page.evaluate(() => ({
    view: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.doc <= widths.view && widths.body <= widths.view, JSON.stringify(widths));
};
try {
  for (const width of [320, 360, 390, 430, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 1080 : 844 });
    await page.goto(url);
    await card("fixture-0").waitFor();
    await settle();
    await checkOverflow();
    assert.equal(await page.locator("[data-bed-id]").count(), 40);
    await card("fixture-0").click();
    await settle();
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.count(), 1);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await checkOverflow();
    assert.ok(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth));
    const close = page.getByRole("button", { name: "Fechar detalhes do leito" });
    const closeBounds = await close.boundingBox();
    assert.ok(closeBounds.width >= 44 && closeBounds.height >= 44);
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate((node) => document.activeElement === node), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.locator("summary").evaluate((node) => document.activeElement === node),
      true,
    );
    await page.screenshot({ path: `${output}/details-${width}.png`, fullPage: false });
    await page.keyboard.press("Escape");
    await settle();
    assert.equal(await dialog.count(), 0);
    assert.equal(await card("fixture-0").evaluate((node) => document.activeElement === node), true);
    assert.equal(
      await page.locator(".tv-detail-morph-surface, .tv-detail-morph-identity").count(),
      0,
    );
    await page.screenshot({ path: `${output}/terminal-${width}.png`, fullPage: true });
    results.push({
      width,
      cards: 40,
      overflow: false,
      dialog: "fits",
      focus: "trap and restore passed",
    });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await fixture("reset", 3);
  await settle();
  await card("fixture-0").evaluate((node) => {
    window.originalCard = node;
  });
  await fixture("update", "fixture-0", { status: "in_progress" });
  await settle();
  assert.equal(
    await card("fixture-0").evaluate((node) => node === window.originalCard),
    true,
    "Status must preserve card identity",
  );
  await fixture("update", "fixture-0", { status: "en_route" });
  await fixture("update", "fixture-0", { status: "waiting_cleaning" });
  await fixture("update", "fixture-0", { status: "in_progress" });
  await settle();
  assert.equal(await card("fixture-0").evaluate((node) => node === window.originalCard), true);
  await fixture("complete", ["fixture-0", "fixture-1"]);
  await page.waitForFunction(() => document.querySelectorAll(".tv-card-completing").length === 2);
  assert.equal(await page.locator(".tv-card-completing[inert]").count(), 2);
  await settle();
  assert.equal(await page.locator("[data-bed-id]").count(), 1);
  assert.equal(await page.locator(".tv-completion-fx").count(), 0);
  await fixture("complete", ["fixture-2"]);
  await settle();
  assert.equal(await page.locator("[data-bed-id]").count(), 0);
  await fixture("reset", 50);
  await settle();
  assert.equal(await page.locator('[data-motion-density="quiet"]').count(), 1);
  await fixture(
    "complete",
    Array.from({ length: 15 }, (_, i) => `fixture-${i}`),
  );
  await settle();
  assert.equal(await page.locator("[data-bed-id]").count(), 35);
  await checkOverflow();
  // Manual scroll must retain control during data changes.
  const scroller = page.locator(".tv-motion-grid").locator("..");
  await scroller.dispatchEvent("wheel", { deltaY: 100 });
  await scroller.evaluate((node) => {
    node.scrollTop = 120;
  });
  const scrollBefore = await scroller.evaluate((node) => node.scrollTop);
  await page.waitForTimeout(500);
  assert.equal(await scroller.evaluate((node) => node.scrollTop), scrollBefore);
  await fixture("update", "fixture-20", { assigned_staff_id: "staff-49" });
  await settle();
  assert.equal(await scroller.evaluate((node) => node.scrollTop), scrollBefore);
  // Dismissal after the origin disappears must clean up and restore usable focus.
  await fixture("reset", 3);
  await settle();
  for (let i = 0; i < 4; i++) {
    await card("fixture-0").click();
    await page.getByRole("button", { name: "Fechar detalhes do leito" }).click();
    await settle();
  }
  await card("fixture-0").click();
  await settle();
  await fixture("remove", "fixture-0");
  await page.keyboard.press("Escape");
  await settle();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("body > [inert]").count(), 0);
  await context.close();
  // Real touch context and live reduced-motion changes.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const touch = await mobile.newPage();
  await touch.goto(url);
  await touch.locator('[data-bed-id="fixture-0"]').waitFor();
  await touch.locator('[data-bed-id="fixture-0"]').tap();
  assert.equal(await touch.getByRole("dialog").count(), 1);
  assert.equal(await touch.locator(".tv-detail-morph-surface").count(), 0);
  await touch.getByRole("button", { name: "Fechar detalhes do leito" }).tap();
  await touch.waitForTimeout(50);
  assert.equal(await touch.getByRole("dialog").count(), 0);
  await touch.evaluate(() => window.motionFixture.complete(["fixture-0", "fixture-1"]));
  await touch.waitForTimeout(50);
  assert.equal(await touch.locator(".tv-card-completing").count(), 0);
  await touch.emulateMedia({ reducedMotion: "no-preference" });
  await touch.locator('[data-bed-id="fixture-3"]').tap();
  await touch.emulateMedia({ reducedMotion: "reduce" });
  await touch.waitForTimeout(100);
  assert.equal(await touch.locator(".tv-detail-morph-surface").count(), 0);
  await mobile.close();
  assert.deepEqual(errors, []);
  results.push({
    scenarios:
      "3/40/50 beds; stable identity; rapid status; 2/15/all completions; manual scroll; repeated/removed-origin dismissal; touch; live reduced motion",
    passed: true,
  });
} catch (error) {
  results.push({ failed: String(error), errors });
  if (!page.isClosed())
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
