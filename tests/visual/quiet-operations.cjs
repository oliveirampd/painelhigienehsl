/* Run with Playwright available to Node (not a production dependency):
   NODE_PATH=/path/to/playwright/node_modules node tests/visual/quiet-operations.cjs [repo] [output]
   Optional QH_CHROMIUM=/path/to/chromium. Uses synthetic records only.
   The browser mounts the unchanged route components, bypassing Cloudflare-only SSR.
   All data/WS requests are fulfilled locally. Never forwards a backend mutation. */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(process.argv[2] || ".");
const out = path.resolve(process.argv[3] || "/tmp/quiet-operations");
fs.mkdirSync(out, { recursive: true });
const NOW = Date.parse("2026-11-05T18:45:00Z");
const iso = (mins) => new Date(NOW - mins * 60000).toISOString();
const beds = [
  ...fs
    .readFileSync(path.join(root, "src/lib/beds.ts"), "utf8")
    .matchAll(/\{ n: "([^"]+)", b: "([^"]+)" \}/g),
].map((m) => ({ n: m[1], b: m[2] }));
const staff = Array.from({ length: 24 }, (_, i) => ({
  id: "s" + i,
  external_id: "listo:user:" + i,
  name:
    i % 3 === 0
      ? "Colaborador de teste com nome composto muito extenso " + i
      : "Colaborador exemplo " + i,
  status: "assigned",
  created_at: iso(200),
  status_updated_at: iso(20),
  current_discharge_id: null,
}));
const discharges = Array.from({ length: 80 }, (_, i) => {
  const b = beds[(i * 5) % beds.length];
  const status = [
    "waiting_cleaning",
    "en_route",
    "in_progress",
    "in_progress",
    "paused",
    "completed",
    "in_progress",
    "waiting_cleaning",
  ][i % 8];
  return {
    id: "d" + i,
    external_id: (i % 8 === 6 ? "listo:desmont:" : "listo:answer:") + i,
    bed_number: "Leito " + b.n,
    unit: `BLOCO ${b.b} ${Math.floor(Number(b.n) / 100)} ANDAR`,
    status,
    assigned_staff_id: status === "waiting_cleaning" ? null : staff[i % 24].id,
    created_at: iso(400),
    status_updated_at: iso(i % 8 === 0 ? 850 : i % 8 === 2 ? 120 : 20 + (i % 40)),
    completed_at: status === "completed" ? iso(i % 30) : null,
    last_answer_id: String(i + 1),
    priority: false,
    pause_reason:
      status === "paused"
        ? "Motivo de teste extenso: aguardando avaliação da manutenção e liberação do equipamento para continuidade segura da higienização."
        : null,
    service_order: status === "paused" ? "12345678901234567890" : null,
  };
});
discharges.push({
  ...discharges[0],
  id: "oldest",
  external_id: "listo:answer:oldest",
  bed_number: "Leito 711",
  unit: "BLOCO D 7 ANDAR",
  status_updated_at: iso(1000),
});
discharges.push(
  ...discharges
    .filter((d) => d.status === "completed")
    .map((d) => ({ ...d, id: d.id + "snapshot", external_id: "snapshot:last-completed:" + d.id })),
);
const events = beds.flatMap((b, i) =>
  ["concorrente", "camareira"]
    .filter((k, j) => i % 6 === 3 || i % 6 === j + 1 || i % 6 === j + 4)
    .map((kind) => ({
      bed: b.n,
      kind,
      status: i % 6 >= 4 ? "in_progress" : "completed",
      shift: "Tarde",
      staff: staff[i % 24].name,
      unit: `BLOCO ${b.b} ${Math.floor(Number(b.n) / 100)} ANDAR`,
      at: iso(10),
      startedAt: iso(25),
      completedAt: i % 6 >= 4 ? null : iso(10),
      count: i % 11 === 0 ? 3 : 1,
    })),
);
const html = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/visual/entry.tsx"></script></body></html>`;
const report = {
  source: root,
  fixture: "Synthetic operational records; fixed 2026-11-05 15:45 BRT",
  viewports: [],
  scenarios: [],
  errors: [],
  writes: [],
};
(async () => {
  const server = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "8080"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "https://qh-fixture.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
      },
    },
  );
  let logs = "";
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  let browser;
  try {
    for (let i = 0; i < 100 && !logs.includes("Local:"); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert(logs.includes("Local:"), "Vite failed to start: " + logs);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.QH_CHROMIUM ? { executablePath: process.env.QH_CHROMIUM } : {}),
      args: ["--no-sandbox"],
    });
    let few = false;
    const setup = async (context) => {
      await context.routeWebSocket("**/realtime/**", (ws) => {
        ws.onMessage((raw) => {
          const m = JSON.parse(raw);
          ws.send(
            JSON.stringify(
              Array.isArray(m)
                ? [
                    m[0],
                    m[1],
                    m[2],
                    "phx_reply",
                    { status: "ok", response: { postgres_changes: [] } },
                  ]
                : {
                    event: "phx_reply",
                    topic: m.topic,
                    ref: m.ref,
                    payload: { status: "ok", response: { postgres_changes: [] } },
                  },
            ),
          );
        });
      });
      await context.route("**/*", async (r) => {
        const req = r.request(),
          url = new URL(req.url());
        if (req.isNavigationRequest() && url.hostname === "127.0.0.1")
          return r.fulfill({ contentType: "text/html", body: html });
        if (url.pathname.includes("/rest/v1/"))
          return r.fulfill({
            json: url.pathname.endsWith("/staff")
              ? staff
              : few
                ? discharges.slice(0, 3)
                : discharges,
            headers: { "access-control-allow-origin": "*" },
          });
        if (url.pathname === "/api/public/sync-health")
          return r.fulfill({ json: { status: "healthy", lastSuccessAt: iso(0), ageSeconds: 0 } });
        if (url.pathname.includes("/_serverFn/")) {
          const meta = Buffer.from(url.pathname.split("/").pop(), "base64").toString();
          if (meta.includes("getDailyBeds"))
            return r.fulfill({ json: { result: { events, at: iso(0), stale: false } } });
          if (meta.includes("getLastCompletedDischarge"))
            return r.fulfill({
              json: {
                result: {
                  bedNumber: "Leito exemplo",
                  unit: "BLOCO D 7 ANDAR",
                  staffName: staff[0].name,
                  startedAt: iso(180),
                  completedAt: iso(120),
                  durationMinutes: 60,
                  sourceAnswerId: 12345,
                },
              },
            });
          report.writes.push(meta);
          return r.abort();
        }
        if (url.hostname !== "127.0.0.1") return r.fulfill({ status: 204, body: "" });
        return r.continue();
      });
    };
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await setup(context);
    const p = await context.newPage();
    await p.clock.setFixedTime(NOW);
    p.on("pageerror", (e) => report.errors.push(e.stack || e.message));
    p.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("net::")) report.errors.push(m.text());
    });
    const open = async (route) => {
      await p.goto("http://127.0.0.1:8080/" + route);
      await p
        .locator(route === "tv" ? ".tv-terminal-bed-card" : "[data-bed-code]")
        .first()
        .waitFor({ timeout: 45000 });
      await p.waitForTimeout(700);
      const close = p.getByLabel("Fechar novidades do painel");
      if (await close.count()) await close.click();
    };
    for (const route of ["tv", "diaria"]) {
      await p.setViewportSize({ width: 1920, height: 1080 });
      await open(route);
      for (const width of [320, 360, 390, 430, 768, 1024, 1365, 1920, 3840]) {
        await p.setViewportSize({
          width,
          height: width >= 1920 ? Math.round((width * 9) / 16) : width >= 768 ? 900 : 844,
        });
        await p.evaluate(() => {
          window.scrollTo(0, 0);
          document.querySelector(".daily-panel-page")?.scrollTo(0, 0);
        });
        await p.waitForTimeout(120);
        const measure = await p.evaluate(() => {
          const width = innerWidth;
          const root = document.querySelector(".tv-terminal-page,.daily-panel-page");
          const cards = [...document.querySelectorAll(".tv-terminal-bed-card,[data-bed-code]")];
          const visible = cards.filter((el) => {
            const r = el.getBoundingClientRect();
            let max = innerHeight;
            let par = el.parentElement;
            while (par) {
              if (["auto", "hidden", "scroll"].includes(getComputedStyle(par).overflowY))
                max = Math.min(max, par.getBoundingClientRect().bottom);
              par = par.parentElement;
            }
            return r.top >= 0 && r.bottom <= max;
          });
          const escaped = [...root.querySelectorAll("*")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (!r.width || r.right <= width + 1) return false;
              let par = el.parentElement;
              while (par && par !== root) {
                if (["auto", "hidden", "scroll"].includes(getComputedStyle(par).overflowX))
                  return false;
                par = par.parentElement;
              }
              return true;
            })
            .slice(0, 12)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              text: el.textContent.slice(0, 70),
            }));
          return {
            pageWidth: document.documentElement.scrollWidth,
            viewport: width,
            rootWidth: root.scrollWidth,
            escaped,
            visibleBeds: visible.length,
            bedCount: cards.length,
            firstCardHeight: Math.round(cards[0].getBoundingClientRect().height),
          };
        });
        report.viewports.push({ route, width, ...measure });
        if ([390, 1920].includes(width)) {
          await p.screenshot({ path: path.join(out, `${route}-${width}-overview.png`) });
          if (route === "tv" && width === 390) {
            await p
              .locator(".tv-terminal-bed-card")
              .first()
              .evaluate((el) => el.closest("section").scrollIntoView({ block: "start" }));
            await p.screenshot({ path: path.join(out, `${route}-${width}-cards.png`) });
          }
          if (route === "diaria") {
            await p
              .locator(".daily-map-surface")
              .first()
              .evaluate((el) => el.scrollIntoView({ block: "start" }));
            await p.screenshot({ path: path.join(out, `${route}-${width}-map.png`) });
          }
        }
      }
      report.scenarios.push({
        name: route + " dark text contrast",
        ...(await p.evaluate(() => {
          const ctx = document
            .createElement("canvas")
            .getContext("2d", { willReadFrequently: true });
          const rgba = (c) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = c;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v));
          };
          const blend = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
          const lum = (c) =>
            c
              .slice(0, 3)
              .map((x) => x / 255)
              .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
              .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
          const issues = [];
          let checked = 0;
          for (const el of document.querySelectorAll(".tv-terminal-page *,.daily-panel-page *")) {
            const text = [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim())
              .join("");
            if (!text || !el.getClientRects().length || el.closest("svg")) continue;
            let bg = [11, 14, 17, 1],
              chain = [],
              parent = el;
            while (parent) {
              chain.unshift(parent);
              parent = parent.parentElement;
            }
            for (const item of chain) bg = blend(rgba(getComputedStyle(item).backgroundColor), bg);
            const cs = getComputedStyle(el),
              fg = blend(rgba(cs.color), bg),
              a = lum(fg),
              b = lum(bg),
              ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            const threshold =
              parseFloat(cs.fontSize) >= 24 ||
              (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700)
                ? 3
                : 4.5;
            checked++;
            if (ratio < threshold - 0.02)
              issues.push({
                text: text.slice(0, 60),
                ratio: Math.round(ratio * 100) / 100,
                color: cs.color,
                background: bg,
                tag: el.tagName,
                class: String(el.className),
              });
          }
          return { checked, issues: issues.slice(0, 40), total: issues.length };
        })),
      });
      await p.setViewportSize({ width: 1920, height: 1080 });
      if (route === "tv") {
        await p
          .locator(".tv-terminal-bed-card")
          .first()
          .evaluate((el) => {
            el.closest(".overflow-y-auto").scrollTop = 10000;
          });
        await p.screenshot({ path: path.join(out, "tv-1920-active.png") });
      }
      const motionContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        reducedMotion: "no-preference",
      });
      await setup(motionContext);
      const motion = await motionContext.newPage();
      await motion.goto("http://127.0.0.1:8080/" + route);
      await motion
        .locator(route === "tv" ? ".tv-terminal-bed-card" : "[data-bed-code]")
        .first()
        .waitFor();
      const closeUpdates = motion.getByLabel("Fechar novidades do painel");
      if (await closeUpdates.count()) await closeUpdates.click();
      const scroller =
        route === "tv"
          ? motion.locator(".tv-terminal-bed-card").first()
          : motion.locator(".daily-panel-page");
      const getScroll = () =>
        scroller.evaluate(
          (el, route) => (route === "tv" ? el.closest(".overflow-y-auto") : el).scrollTop,
          route,
        );
      await scroller.evaluate((el, route) => {
        const s = route === "tv" ? el.closest(".overflow-y-auto") : el;
        s.scrollTop = 40;
        s.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true }));
      }, route);
      const pausedAt = await getScroll();
      await motion.waitForTimeout(350);
      const pausedAfter = await getScroll();
      await motion.waitForTimeout(16000);
      const resumedAt = await getScroll();
      report.scenarios.push({
        name: route + " manual scroll pause and resume",
        pausedAt,
        pausedAfter,
        resumedAt,
        geometry: await scroller.evaluate((el, route) => {
          const s = route === "tv" ? el.closest(".overflow-y-auto") : el;
          return {
            height: s.clientHeight,
            scrollHeight: s.scrollHeight,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          };
        }, route),
        passed: Math.abs(pausedAfter - pausedAt) < 2 && resumedAt > pausedAfter,
      });
      await motionContext.close();
      await open(route);
      await p.setViewportSize({ width: 320, height: 640 });
      await p
        .locator(route === "tv" ? ".tv-terminal-bed-card" : '[data-bed-code] [role="button"]')
        .first()
        .click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor();
      await p.waitForTimeout(200);
      const modal = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      report.scenarios.push({ name: route + " small modal", ...modal });
      await p.screenshot({ path: path.join(out, `${route}-320-modal.png`) });
      await p.keyboard.press("Tab");
      report.scenarios.push({
        name: route + " focus stays in dialog",
        passed: await dialog.evaluate((el) => el.contains(document.activeElement)),
      });
      await p.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      report.scenarios.push({ name: route + " Escape closes", passed: true });
      if (route === "diaria") {
        await p.getByRole("button", { name: "D", exact: true }).click();
        await p.getByLabel("Filtrar andar").selectOption("7");
        await p.getByRole("button", { name: "Concorrente", exact: true }).click();
        report.scenarios.push({
          name: "combined daily filters",
          blocks: await p.locator(".daily-map-surface").count(),
          text: (await p.locator(".daily-map-surface").innerText()).slice(0, 180),
        });
        await p.getByLabel("Limpar filtros").click();
        await p.getByPlaceholder("Buscar leito").fill("1858");
        await p.getByRole("button", { name: "Ir", exact: true }).click();
        report.scenarios.push({
          name: "daily search highlight",
          bed: "1858",
          shadow: await p
            .locator('[data-bed-code="1858"] [role="button"]')
            .evaluate((el) => getComputedStyle(el).boxShadow),
        });
        await p.getByLabel("Limpar filtros").click();
        await p.clock.install({ time: NOW });
        const completedEvent = events.find((e) => e.status === "in_progress");
        completedEvent.status = "completed";
        completedEvent.completedAt = iso(0);
        await p.clock.fastForward(30000);
        await p.waitForTimeout(300);
        report.scenarios.push({
          name: "daily completion feedback",
          count: await p.locator(".daily-bed-completed").count(),
        });
        await p.getByLabel("Ativar modo claro").click();
        for (const width of [320, 390, 768, 1920]) {
          await p.setViewportSize({ width, height: 900 });
          report.scenarios.push({
            name: "daily light theme",
            width,
            overflow: await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          });
        }
        await p.screenshot({ path: path.join(out, "diaria-1920-light.png") });
      }
    }
    few = true;
    await p.setViewportSize({ width: 390, height: 844 });
    await open("tv");
    report.scenarios.push({
      name: "few terminal beds",
      count: await p.locator(".tv-terminal-bed-card").count(),
    });
    await p.screenshot({ path: path.join(out, "tv-390-few.png") });
    few = false;
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    const touchContext = await browser.newContext({
      viewport: { width: 320, height: 740 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await setup(touchContext);
    const touch = await touchContext.newPage();
    await touch.goto("http://127.0.0.1:8080/tv");
    await touch.locator(".tv-terminal-bed-card").first().waitFor();
    await touch
      .getByLabel(/^OS do/)
      .first()
      .scrollIntoViewIfNeeded();
    report.scenarios.push({
      name: "320px touch controls",
      overflow: await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      osHeight: await touch
        .getByLabel(/^OS do/)
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
      completeSize: await touch
        .getByLabel("Marcar leito como concluído com pendências")
        .first()
        .evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        })),
    });
    await touch.screenshot({ path: path.join(out, "tv-320-paused-touch.png") });
    await touchContext.close();
    assert.equal(report.writes.length, 0, "Unexpected write attempted");
    for (const v of report.viewports)
      assert(v.pageWidth <= v.width, `${v.route}: page overflow at ${v.width}px`);
    for (const s of report.scenarios.filter((s) => s.name.includes("small modal")))
      assert(
        s.width <= s.viewportWidth &&
          s.height <= s.viewportHeight &&
          s.scrollWidth <= s.clientWidth,
        "Modal overflow",
      );
    for (const s of report.scenarios.filter((s) => s.name.includes("focus stays")))
      assert(s.passed, "Dialog focus escaped");
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          viewports: report.viewports.map((x) => ({
            route: x.route,
            width: x.width,
            overflow: x.pageWidth > x.width,
            escaped: x.escaped.length,
            visible: x.visibleBeds,
            cardHeight: x.firstCardHeight,
          })),
          scenarios: report.scenarios,
          errors: [...new Set(report.errors)],
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
})().catch((e) => {
  fs.writeFileSync(path.join(out, "failure.txt"), String(e));
  console.error(e);
  process.exit(1);
});
