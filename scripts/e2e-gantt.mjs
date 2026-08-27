// 目标甘特图 E2E：按钮/滚轮缩放时间刻度、拖拽 bar 平移起止日期、无关交互零回归。
// 运行：npm run test:e2e:gantt（需 dev server 已在 5173）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (e1) {
    const dir = path.join(process.env.APPDATA || "", "npm", "node_modules", "playwright");
    return import(`file:///${path.join(dir, "index.mjs").replace(/\\/g, "/")}`);
  }
}

let passCount = 0;
let failCount = 0;
const jsErrorsAll = [];
function check(name, cond, detail = "", { optional = false } = {}) {
  if (cond) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
    passCount += 1;
  } else {
    console.log(`${optional ? "SKIP" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!optional) failCount += 1;
  }
}

function makeBrowser() {
  const pwPromise = loadPlaywright();
  return {
    async launch(opts) {
      const pw = await pwPromise;
      this._pw = pw;
      return pw.chromium.launch(opts);
    },
  };
}
const pwLoader = makeBrowser();

async function openSeededGoalsPage(browser, extraGoals = []) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // 隔离文件后端：拦截 /api/data 避免 GET 覆盖种子
  await ctx.route("**/api/data", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "e2e-isolated" }) }),
  );
  const now = new Date();
  const iso = (offsetDays) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const seed = {
    settings: {
      workSegments: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
      shortBreak: 10,
      longBreak: 30,
      maxWorkMinutes: 480,
      breaks: [],
    },
    ai: { enabled: false },
    goals: [
      {
        id: "g-e2e-explicit",
        title: "甘特显式日期目标",
        type: "month",
        priority: "medium",
        status: "active",
        progress: 40,
        parentId: "",
        startDate: iso(-2),
        endDate: iso(4),
      },
      {
        id: "g-e2e-derived",
        title: "甘特派生跨度目标",
        type: "week",
        priority: "low",
        status: "active",
        progress: 10,
        parentId: "",
        startDate: "",
        endDate: "",
      },
      ...extraGoals,
    ],
    tasks: [],
    blocks: [],
    dayPlans: {},
    reviews: [],
    recurring: [],
  };
  await ctx.addInitScript(
    ([key, data]) => localStorage.setItem(key, JSON.stringify(data)),
    ["personal-planning-coach-v1", seed],
  );
  const page = await ctx.newPage();
  page.on("pageerror", (err) => jsErrorsAll.push(err.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("503")) jsErrorsAll.push(m.text());
  });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="目标"]').click();
  await page.waitForTimeout(400);
  return { ctx, page, iso };
}

// 在甘特轴上读取「首个 tick 的中心 x」换算当前窗口可见天数（首末 tick 差 × 系数不可靠，改为直接读 zoom 相关 DOM 特征）
async function axisTickTexts(page) {
  return page.evaluate(() => [...document.querySelectorAll(".gantt-tick")].map((t) => t.textContent.trim()));
}

(async () => {
  const browser = await pwLoader.launch({ headless: true });
  let ganttTop = null;

  // ========== 场景 A：加载基线 ==========
  {
    const { ctx, page } = await openSeededGoalsPage(browser);
    ganttTop = await page.evaluate(() => {
      const bars = [...document.querySelectorAll(".gantt-bar")];
      const ticks = document.querySelectorAll(".gantt-axis-track .gantt-tick").length;
      const movableBars = document.querySelectorAll(".gantt-bar.is-movable").length;
      return { bars: bars.length, ticks, movableBars };
    });
    check("A1: 两行 bar 渲染", ganttTop.bars === 2, `bars=${ganttTop.bars}`);
    check("A2: 刻度存在", ganttTop.ticks >= 2, `ticks=${ganttTop.ticks}`);
    check("A3: 仅显式日期的 bar 可拖", ganttTop.movableBars === 1, `movable=${ganttTop.movableBars}`);
    check("A5: 两个顶级目标之间有一条分隔线", await page.locator(".gantt-divider").count() === 1, `dividers=${await page.locator(".gantt-divider").count()}`);

    // 记录 fit 模式下第一个 bar 的几何（用于缩放回归对照）
    const fitBarBox = await page.evaluate(() => {
      const b = document.querySelector(".gantt-bar");
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width), text: b.textContent.trim() };
    });
    check("A4: fit 模式 bar 有宽度", fitBarBox.width > 20, `width=${fitBarBox.width}`);

    // ========== 场景 B：按钮缩小（看更多天）→ bar 变窄；重置恢复 ==========
    await page.locator('button[aria-label="缩小时间刻度"]').click();
    await page.waitForTimeout(200);
    const outBar = await page.evaluate(() => Math.round(document.querySelector(".gantt-bar").getBoundingClientRect().width));
    check("B1: 缩小后 bar 变窄", outBar < fitBarBox.width - 8, `${fitBarBox.width} → ${outBar}`);
    const resetBtnVisible = await page.locator('button[title="重置为适应内容"]').isVisible().catch(() => false);
    check("B2: 出现重置按钮", resetBtnVisible);

    await page.locator('button[aria-label="放大时间刻度"]').click(); // 回到接近初始档位? 不一定与 fit 相同 → 用重置验证
    await page.waitForTimeout(150);
    await page.locator('button[title="重置为适应内容"]').click();
    await page.waitForTimeout(200);
    const backBar = await page.evaluate(() => Math.round(document.querySelector(".gantt-bar").getBoundingClientRect().width));
    check("B3: 重置回到 fit 宽度", Math.abs(backBar - fitBarBox.width) <= 2, `${backBar} vs ${fitBarBox.width}`);

    // 连续放大到最小档位：按钮应禁用
    for (let i = 0; i < 6; i += 1) {
      const disabled = await page.locator('button[aria-label="放大时间刻度"]').isDisabled().catch(() => true);
      if (disabled) break;
      await page.locator('button[aria-label="放大时间刻度"]').click();
      await page.waitForTimeout(120);
    }
    const inDisabled = await page.locator('button[aria-label="放大时间刻度"]').isDisabled().catch(() => true);
    check("B4: 到达最小档位时放大按钮禁用", inDisabled);
    await ctx.close();
  }

  // ========== 场景 C：滚轮交互（默认平移，Ctrl/Shift+滚轮才缩放，页面不滚动）==========
  // 注：核心断言用页面内 dispatchEvent（cancelable），与真实输入同路径触发 listener + preventDefault；
  // CDP 合成 wheel（page.mouse.wheel）的默认滚动在 compositor 层不遵守 renderer 的 preventDefault，
  // 只用于冒烟验证 handler 收到事件（C5）。
  {
    const { ctx, page } = await openSeededGoalsPage(browser);
    await page.locator(".goal-gantt-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const winScrollBefore = await page.evaluate(() => document.querySelector(".workspace").scrollTop || 0);
    const fireWheel = (opts) =>
      page.evaluate(({ o }) => {
        const root = document.querySelector(".gantt");
        const track = document.querySelector(".gantt-axis-track");
        const r = track.getBoundingClientRect();
        const ev = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.7, clientY: r.top + r.height / 2, ...o });
        root.dispatchEvent(ev);
        return ev.defaultPrevented;
      }, opts);
    const readState = () =>
      page.evaluate(() => ({
        ticks: [...document.querySelectorAll(".gantt-tick")].map((t) => t.textContent.trim()).join("|"),
        today: (() => { const t = document.querySelector(".gantt-axis-today"); return t ? Math.round(parseFloat(t.style.left)) : null; })(),
        scroll: document.querySelector(".workspace").scrollTop || 0,
      }));

    const before = await readState();
    // C1: Ctrl+滚轮放大（deltaY < 0）
    await fireWheel({ o: { deltaY: -120, ctrlKey: true } });
    await page.waitForTimeout(350);
    const afterCtrl = await readState();
    check("C1: Ctrl+滚轮放大改变刻度", afterCtrl.ticks !== before.ticks, `${before.ticks} → ${afterCtrl.ticks}`);

    // C2: Shift+滚轮缩小（deltaY > 0）
    await fireWheel({ o: { deltaY: 120, shiftKey: true } });
    await page.waitForTimeout(350);
    const afterShift = await readState();
    check("C2: Shift+滚轮缩小改变刻度", afterShift.ticks !== afterCtrl.ticks, `${afterCtrl.ticks} → ${afterShift.ticks}`);

    // C3: 裸滚轮平移（窗口右移，「今天」标记左移或移出）
    await fireWheel({ o: { deltaY: 240 } });
    await page.waitForTimeout(350);
    const afterBare = await readState();
    check("C3: 裸滚轮右移视角（今天标记左移或移出）", afterBare.today === null ? afterShift.today !== null : afterBare.today < afterShift.today, `${afterShift.today} → ${afterBare.today}`);

    // C4: 三个事件全程未引发页面滚动（preventDefault 生效）
    check("C4: 滚轮未引发页面滚动", [afterCtrl, afterShift, afterBare].every((s) => s.scroll === winScrollBefore), `${winScrollBefore} → ${afterBare.scroll}`);

    // C5: 真实 CDP wheel 冒烟——handler 收到事件并平移（不断言页面滚动，CDP 合成路径的默认滚动不受 preventDefault 控制）
    const box = await page.locator(".gantt-axis-track").boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    const smokeBefore = (await readState()).today;
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(350);
    const smokeAfter = (await readState()).today;
    check("C5: 真实滚轮事件送达 handler（平移生效）", smokeAfter === null ? smokeBefore !== null : smokeAfter < smokeBefore, `${smokeBefore} → ${smokeAfter}`);
    await ctx.close();
  }

  // ========== 场景 D：拖拽 bar 平移三天 ==========
  {
    const { ctx, page, iso } = await openSeededGoalsPage(browser);
    await page.locator(".goal-gantt-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const origStart = iso(-2);
    const origEnd = iso(4);

    const dragInfo = await page.evaluate(() => {
      const bar = document.querySelector(".gantt-bar.is-movable");
      return { barX: bar.getBoundingClientRect().x + 1, barY: undefined };
    });
    void dragInfo; // 仅确认存在可拖 bar

    // 视窗天数未知（fit），以像素位移近似 3 天：显式目标 span 是 -2..+4 共 7 天 ⇒ bar 像素宽 ≈ 7 天
    const barBox = await page.locator(".gantt-bar.is-movable").boundingBox();
    const barWidth = barBox.width;
    const centerX = barBox.x + barWidth / 2;
    const centerY = barBox.y + barBox.height / 2;
    const dx = barWidth * (3 / 7);

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + dx, centerY, { steps: 12 });
    await page.waitForTimeout(80);
    // 拖拽中预览：bar 有 --bar-shift CSS 变量且类名 is-dragging
    const midState = await page.evaluate(() => {
      const bar = document.querySelector(".gantt-bar.is-movable");
      return {
        dragging: bar.classList.contains("is-dragging"),
        shiftVar: bar.style.getPropertyValue("--bar-shift"),
      };
    });
    check("D1: 拖拽中 is-dragging 且有预览位移", midState.dragging && midState.shiftVar !== "", JSON.stringify(midState));

    await page.mouse.up();
    await page.waitForTimeout(500);

    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem("personal-planning-coach-v1");
      const g = JSON.parse(raw).goals.find((x) => x.id === "g-e2e-explicit");
      return { startDate: g.startDate, endDate: g.endDate };
    });
    const diffDay = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
    const shift = diffDay(origStart, saved.startDate);
    check("D2: 整体平移约 +3 天", shift >= 2 && shift <= 4, `shift=${shift} 天`);
    const durBefore = diffDay(origStart, origEnd);
    const durAfter = diffDay(saved.startDate, saved.endDate);
    check("D3: 时长保持不变", durBefore === durAfter, `${durBefore} == ${durAfter}`);

    // ========== 场景 E：零回归抽查——状态选择器仍可用、无 JS 错误 ==========
    await page.selectOption(".gantt-status >> nth=0", "done");
    await page.waitForTimeout(300);
    const statusNow = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem("personal-planning-coach-v1")).goals.find((x) => x.id === "g-e2e-explicit");
      return g.status;
    });
    check("E1: 下拉改状态仍生效", statusNow === "done", `status=${statusNow}`);
    await ctx.close();
  }

  // ========== 场景 F：拖拽 bar 边缘调整时长（右缘外扩 / 左缘内收）==========
  {
    const { ctx, page, iso } = await openSeededGoalsPage(browser);
    await page.locator(".goal-gantt-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const origStart = iso(-2);
    const origEnd = iso(4);

    const barBox = await page.locator(".gantt-bar.is-movable").boundingBox();
    const dayPx = barBox.width / 7; // 显式目标跨度 7 天

    // F1: 拖右缘外扩约 2 天
    const endHandle = await page.locator(".gantt-bar.is-movable .gantt-bar-handle.is-end").boundingBox();
    const ex = endHandle.x + endHandle.width / 2;
    const ey = endHandle.y + endHandle.height / 2;
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    await page.mouse.move(ex + dayPx * 2, ey, { steps: 8 });
    await page.waitForTimeout(80);
    const midResize = await page.evaluate(() => {
      const bar = document.querySelector(".gantt-bar.is-movable");
      return { dragging: bar.classList.contains("is-dragging"), dw: bar.style.getPropertyValue("--bar-dw") };
    });
    check("F1a: 拖缘中 is-dragging 且有宽度预览", midResize.dragging && midResize.dw !== "", JSON.stringify(midResize));
    await page.mouse.up();
    await page.waitForTimeout(500);
    const savedEnd = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem("personal-planning-coach-v1")).goals.find((x) => x.id === "g-e2e-explicit");
      return { start: g.startDate, end: g.endDate };
    });
    const day = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
    check("F1b: 右缘外扩约 +2 天（start 不变）", day(origEnd, savedEnd.end) >= 1 && day(origEnd, savedEnd.end) <= 3 && savedEnd.start === origStart, JSON.stringify(savedEnd));

    // F2: 拖左缘内收约 2 天（start 后移，end 保持）
    const barBox2 = await page.locator(".gantt-bar.is-movable").boundingBox();
    const startHandle = await page.locator(".gantt-bar.is-movable .gantt-bar-handle.is-start").boundingBox();
    const sx = startHandle.x + startHandle.width / 2;
    const sy = startHandle.y + startHandle.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dayPx * 2, sy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const savedStart = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem("personal-planning-coach-v1")).goals.find((x) => x.id === "g-e2e-explicit");
      return { start: g.startDate, end: g.endDate };
    });
    const shrink = day(savedEnd.start, savedStart.start);
    check("F2a: 左缘内收约 +2 天（start 后移）", shrink >= 1 && shrink <= 3, `start ${savedEnd.start} → ${savedStart.start}`);
    check("F2b: end 保持不变", savedStart.end === savedEnd.end, `${savedStart.end}`);
    check("F2c: 时长收缩且 ≥ 1 天", day(savedStart.start, savedStart.end) >= 0 && day(savedStart.start, savedStart.end) < day(savedEnd.start, savedEnd.end), `new len=${day(savedStart.start, savedStart.end)}`);

    // F3: 零回归——不可拖条（派生跨度）无手柄
    const derivedHandles = await page.evaluate(() => {
      const bars = [...document.querySelectorAll(".gantt-bar")];
      const derived = bars.find((b) => !b.classList.contains("is-movable"));
      return derived ? derived.querySelectorAll(".gantt-bar-handle").length : -1;
    });
    check("F3: 派生跨度条无 resize 手柄", derivedHandles === 0, `handles=${derivedHandles}`);
    await ctx.close();
  }

  // ========== 场景 G：优先级配色（背景随 priority 变量，三档可区分）==========
  {
    const { ctx, page } = await openSeededGoalsPage(browser, [
      { id: "g-e2e-high", title: "甘特高优先级目标", type: "week", priority: "high", status: "active", progress: 0, parentId: "", startDate: "", endDate: "" },
    ]);
    await page.locator(".goal-gantt-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const colors = await page.evaluate(() => {
      const varRgb = (name) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const m = v.match(/^#([0-9a-f]{6})$/i);
        const n = parseInt(m[1], 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const pick = (p) => {
        const bar = document.querySelector(`.gantt-bar.priority-${p}`);
        return bar ? getComputedStyle(bar).backgroundColor : null;
      };
      return {
        high: pick("high"),
        medium: pick("medium"),
        low: pick("low"),
        expHigh: varRgb("--priority-high-soft"),
        expMedium: varRgb("--priority-medium-soft"),
        expLow: varRgb("--priority-low-soft"),
      };
    });
    check("G1: 高优先级条背景 = --priority-high-soft", colors.high === colors.expHigh && colors.high !== null, `${colors.high}`);
    check("G2: 中优先级条背景 = --priority-medium-soft", colors.medium === colors.expMedium && colors.medium !== null, `${colors.medium}`);
    check("G3: 低优先级条背景 = --priority-low-soft", colors.low === colors.expLow && colors.low !== null, `${colors.low}`);
    check("G4: 三档优先级颜色可区分", new Set([colors.high, colors.medium, colors.low]).size === 3, JSON.stringify(colors));
    const dividers = await page.locator(".gantt-divider").count();
    check("G5: 三个顶级目标之间有两条分隔线", dividers === 2, `dividers=${dividers}`);
    await ctx.close();
  }

  check("无页面 JS 错误", jsErrorsAll.length === 0, jsErrorsAll.slice(0, 2).join(" | "));

  console.log(failCount === 0 ? "\n全部通过" : `\n${failCount} 项失败`);
  process.exitCode = failCount === 0 ? 0 : 1;
  await browser.close();
})();
