# 目标页 AI 调整对话 + 时间轴工作时段范围 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「目标」页新增一个多轮 AI 对话面板，用于调整已有目标（改标题/优先级/状态/层级/删除，用户确认后落库）；并把首页时间轴的渲染范围从全天 00:00–24:00 改为从第一段工作时间开始到最后一段工作时间结束。

**Architecture:** 时间轴范围计算抽成纯函数 `computeTimelineRange`（放 `src/planner/scheduling.js`，可单测），`DayTimeline` 组件消费它；目标调整对话复用现有 Coach 架构（`planningSkill.js` 的动作协议 system prompt + 纯函数 harness + App.jsx 编排），新增 `src/planner/goalOps.js` 承载 update/delete 目标的归一化与应用逻辑，`GoalsView` 复用现有 interview-panel 的聊天样式类。

**Tech Stack:** React 18（纯 JSX）、Vite 6、node:test（现有 `npm test`）、lucide-react。

## Global Constraints

- 纯 JavaScript/JSX，禁止引入 TypeScript。
- 不新增任何 npm 依赖（唯一第三方 UI 依赖保持 lucide-react）。
- UI 文案为简体中文；AI system prompt 指令为英文体系（与现有 planningSkill.js 一致：协议骨架英文措辞 + 中文说明混合，保持同风格即可，现有文件实际是中文 system prompt，遵循现有文件风格用中文）。
- 工作树里有全仓库 CRLF 换行噪声（57 个文件显示整文件修改）。**每次提交必须显式列出文件路径 `git add <具体路径>`，严禁 `git add -A` / `git add .`**，避免把换行噪声扫进提交。
- 测试命令为 `npm test`（node --test test/*.test.mjs），当前基线全绿（fail 0）。
- `node` 不在当前 bash 的 PATH 里（npm 可用）。需要直接跑 node 时用 `/mnt/c/3_apps/nodejs/node.exe`。
- 遵循仓库现有约定：测试名用中文描述、conventional commits（如 `feat(timeline): ...`）。

## 设计决策（已与需求确认的边界）

1. **时间轴范围**：基础范围 = 工作时段首尾；若时段之外存在时间块（如晚间固定安排），范围向外扩展到包含它们，避免内容被裁掉看不见。范围夹在 0–1440 分钟内。无时段无块时已有 EmptyState 兜底（不会走到范围计算之后）。无时段但有块时按块范围。
2. **「现在」线**：只在工作范围内渲染（沿用现有 `nowMin >= dayStart && nowMin <= dayEnd` 条件，无需改）。现在早于工作开始/晚于结束时该线消失，可接受。
3. **目标调整对话只做"调整"**：动作协议限定 `update_goal` / `delete_goal` / `ask`。新增目标已有三条路径（目标页表单、拆解向导、今日页规划访谈），不重复建设（YAGNI）。
4. **修改先确认后落库**：AI 每轮产出 pending 修改卡片，用户点「应用修改」才写入 planner（与现有「加入计划」模式一致）。
5. **删除目标的子目标处理**：子目标上移一层（挂到被删目标的 parentId；若其父也被删则挂到顶层），与现有 `deleteGoal` handler 的行为略有差异——现有 handler 只清空 parentId。goalOps 采用上移一层，更符合层级语义。

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/planner/scheduling.js` | 修改 | 新增 `computeTimelineRange` 纯函数 |
| `src/components/timeline/DayTimeline.jsx` | 修改 | 用计算范围替换硬编码 0–1440；小时刻度对齐整点 |
| `src/planner/goalOps.js` | 新建 | AI 目标调整动作的归一化（goalRef 解析/字段校验）与应用（不可变更新/删除+上移） |
| `src/planningSkill.js` | 修改 | 新增 `goalCoachSystemMessages()` / `goalCoachStartMessage()` |
| `src/App.jsx` | 修改 | 新增 `goalCoach` 状态与 `runGoalCoach` 等处理器；给 GoalsView 传 props |
| `src/views/GoalsView.jsx` | 修改 | 新增「目标调整对话」面板（复用 interview 聊天样式） |
| `src/styles.css` | 修改 | 新增 `.coach-suggestion.is-delete` 删除卡片样式 |
| `test/scheduling.test.mjs` | 修改 | computeTimelineRange 用例 |
| `test/goalOps.test.mjs` | 新建 | goalOps 用例 |
| `CLAUDE.md` | 修改 | 修正"没有测试"的过时描述 |

---

### Task 1: `computeTimelineRange` 纯函数

**Files:**
- Modify: `src/planner/scheduling.js`（文件末尾追加，约 693 行处之后）
- Test: `test/scheduling.test.mjs`（文件末尾追加）

**Interfaces:**
- Consumes: `toMinutes(time)`（scheduling.js 已 import 自 `../utils/dateTime.js`）
- Produces: `computeTimelineRange(segs, blocks)` → `{ dayStart: number, dayEnd: number }`（分钟，含头含尾，0 ≤ dayStart < dayEnd ≤ 1440）。Task 2 的 DayTimeline 依赖此签名。

- [ ] **Step 1: 写失败测试** — 在 `test/scheduling.test.mjs` 顶部 import 行加入 `computeTimelineRange`（该文件现有 import 见文件头，把新名字加进同一 import 列表），文件末尾追加：

```js
test("computeTimelineRange：范围 = 工作时段首尾", () => {
  const segs = [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];
  const range = computeTimelineRange(segs, []);
  assert.equal(range.dayStart, 540);
  assert.equal(range.dayEnd, 1080);
});

test("computeTimelineRange：时段外时间块向外扩展范围", () => {
  const segs = [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];
  const blocks = [
    { start: "07:30", end: "08:30" },
    { start: "19:00", end: "20:00" },
  ];
  const range = computeTimelineRange(segs, blocks);
  assert.equal(range.dayStart, 450);
  assert.equal(range.dayEnd, 1200);
});

test("computeTimelineRange：时段内时间块不改变范围", () => {
  const segs = [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];
  const blocks = [{ start: "10:00", end: "11:00" }];
  const range = computeTimelineRange(segs, blocks);
  assert.equal(range.dayStart, 540);
  assert.equal(range.dayEnd, 1080);
});

test("computeTimelineRange：无时段时按时间块，全空给默认 08:00–22:00", () => {
  const byBlocks = computeTimelineRange([], [{ start: "10:00", end: "12:00" }]);
  assert.equal(byBlocks.dayStart, 600);
  assert.equal(byBlocks.dayEnd, 720);
  const fallback = computeTimelineRange([], []);
  assert.equal(fallback.dayStart, 480);
  assert.equal(fallback.dayEnd, 1320);
});

test("computeTimelineRange：夹在 0–1440 且不产生空范围", () => {
  const clamped = computeTimelineRange([], [{ start: "00:00", end: "23:59" }]);
  assert.equal(clamped.dayStart, 0);
  assert.equal(clamped.dayEnd, 1439);
  const inverted = computeTimelineRange([{ start: "09:00", end: "09:00" }], []);
  assert.equal(inverted.dayStart, 540);
  assert.equal(inverted.dayEnd, 600);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL，报 `computeTimelineRange is not defined`（SyntaxError: The requested module does not provide an export）。

- [ ] **Step 3: 最小实现** — `src/planner/scheduling.js` 文件末尾追加：

```js
// 时间轴渲染范围：默认 = 工作时段首尾；时段外仍有时间块（如晚间固定安排）时
// 向外扩展到包含它，避免内容被裁掉。全空时退回 08:00–22:00。
export function computeTimelineRange(segs, blocks) {
  const segmentList = Array.isArray(segs) ? segs : [];
  const blockList = Array.isArray(blocks) ? blocks : [];
  const segStarts = segmentList.map((seg) => toMinutes(seg.start));
  const segEnds = segmentList.map((seg) => toMinutes(seg.end));
  let start = segStarts.length ? Math.min(...segStarts) : 8 * 60;
  let end = segEnds.length ? Math.max(...segEnds) : 22 * 60;
  const blockStarts = blockList.map((block) => toMinutes(block.start));
  const blockEnds = blockList.map((block) => toMinutes(block.end));
  if (blockStarts.length) {
    start = Math.max(0, Math.min(start, Math.min(...blockStarts)));
    end = Math.min(1440, Math.max(end, Math.max(...blockEnds)));
  }
  if (end <= start) end = Math.min(1440, start + 60);
  return { dayStart: start, dayEnd: end };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS（原有用例 + 新增 5 条全绿，fail 0）。

- [ ] **Step 5: 提交**

```bash
git add src/planner/scheduling.js test/scheduling.test.mjs
git commit -m "feat(timeline): add computeTimelineRange pure helper for work-hours view range"
```

---

### Task 2: DayTimeline 渲染工作时段范围

**Files:**
- Modify: `src/components/timeline/DayTimeline.jsx`（第 1–10 行 import 区、第 65–72 行范围计算区）

**Interfaces:**
- Consumes: `computeTimelineRange(segs, blocks)`（Task 1 产出，签名见上）。
- Produces: 无新接口；组件 props 不变。

- [ ] **Step 1: 加 import** — `DayTimeline.jsx` 第 5 行 `isMeetingSentence` import 之后加一行：

```js
import { computeTimelineRange } from "../../planner/scheduling.js";
```

- [ ] **Step 2: 替换范围计算** — 把这段：

```js
  // 固定显示完整一天 00:00–24:00：小时标签 0–23（最后一格 23:00），容器高度铺到 24:00，
  // 这样「现在」线在任何时刻（含 23:xx）都落在范围内、不会越出底部看不见。
  const dayStart = 0;
  const dayEnd = 1440;
```

替换为：

```js
  // 渲染范围 = 工作时段首尾（时段外有时间块时向外扩展，见 computeTimelineRange）。
  // 小时刻度对齐整点（dayStart 非整点时从下一个整点起标）。
  const { dayStart, dayEnd } = computeTimelineRange(segs, blocks);
```

- [ ] **Step 3: 小时刻度对齐整点** — 把：

```js
  const hours = [];
  for (let m = dayStart; m < dayEnd; m += 60) hours.push(m);
```

替换为：

```js
  const hours = [];
  for (let m = Math.ceil(dayStart / 60) * 60; m < dayEnd; m += 60) hours.push(m);
```

（`dt-half` 半小时刻度用 `m + 30`，随 hours 自动正确。`yToMinute` 的夹取、拖拽、`dt-spacer` 高度 `totalMin * ppm` 都已基于 dayStart/dayEnd 计算，无需再改。）

- [ ] **Step 4: 验证** — `npm test`（确认无回归）+ 启动 dev server 手动验证：

```bash
npm run dev
```

浏览器打开 http://127.0.0.1:5173 ，检查「今日」视图时间轴：
1. 默认设置（09:00–12:00、14:00–18:00）下时间轴只显示 09:00–18:00，最左刻度 09:00、最后刻度 17:00；
2. 滚动定位：非今天日期定位到首个块或工作开始；今天定位到当前时间；
3. 拖一个任务到时间轴底部边缘，落点夹在 dayEnd 内；
4. 在设置里把工作时段改成 07:00–09:00，时间轴随之变为 07:00–09:00；
5. 手动加一个 20:00–21:00 的固定占用块，时间轴扩展到 21:00。
（可用 webapp-testing skill 的 Playwright 截图代替人眼检查。）

- [ ] **Step 5: 提交**

```bash
git add src/components/timeline/DayTimeline.jsx
git commit -m "feat(timeline): render from first work segment start to last work segment end"
```

---

### Task 3: `goalOps.js` 纯函数模块

**Files:**
- Create: `src/planner/goalOps.js`
- Test: `test/goalOps.test.mjs`

**Interfaces:**
- Consumes: `normalizeTitle(title)`、`titleLooksDuplicate(a, b)`（自 `./dedup.js`，均已导出）。
- Produces（Task 5 依赖的精确签名）:
  - `normalizeGoalOps(actions, goals)` → `{ updates: [{ goalId, patch }], deletes: [{ goalId }] }`，其中 `patch` 只包含合法字段 `{ title?, type?, priority?, status?, progress?, parentId? }`；
  - `applyGoalOps(goals, ops)` → 新的 goals 数组（不可变；先删后改；被删目标的子目标上移一层）；
  - `goalOpsSummaryText(ops)` → 中文一句话摘要。

- [ ] **Step 1: 写失败测试** — 新建 `test/goalOps.test.mjs`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGoalOps, applyGoalOps, goalOpsSummaryText } from "../src/planner/goalOps.js";

function sampleGoals() {
  return [
    { id: "g0", title: "顺利毕业", type: "long", parentId: "", priority: "high", status: "active", progress: 0 },
    { id: "g1", title: "完成论文实验", type: "month", parentId: "g0", priority: "high", status: "active", progress: 30 },
    { id: "g2", title: "每周健身三次", type: "week", parentId: "", priority: "medium", status: "active", progress: 0 },
    { id: "g3", title: "实验子项：数据采集", type: "week", parentId: "g1", priority: "medium", status: "active", progress: 0 },
  ];
}

test("normalizeGoalOps：按 id、精确标题、模糊标题解析 goalRef", () => {
  const ops = normalizeGoalOps(
    [
      { type: "update_goal", goalRef: "g1", priority: "low" },
      { type: "update_goal", goalRef: "每周健身三次", status: "paused" },
      { type: "update_goal", goalRef: "完成论文的实验", title: "论文实验收尾" },
    ],
    sampleGoals(),
  );
  assert.equal(ops.updates.length, 3);
  assert.deepEqual(ops.updates[0], { goalId: "g1", patch: { priority: "low" } });
  assert.deepEqual(ops.updates[1], { goalId: "g2", patch: { status: "paused" } });
  assert.deepEqual(ops.updates[2], { goalId: "g1", patch: { title: "论文实验收尾" } });
});

test("normalizeGoalOps：同一目标的多个 update 合并，非法字段丢弃，未知引用丢弃", () => {
  const ops = normalizeGoalOps(
    [
      { type: "update_goal", goalRef: "g1", priority: "super", status: "done" },
      { type: "update_goal", goalRef: "g1", goalType: "week", progress: 150 },
      { type: "update_goal", goalRef: "不存在的目标", priority: "low" },
      { type: "update_goal", goalRef: "g2" },
      { type: "ask", question: "还有吗" },
      null,
    ],
    sampleGoals(),
  );
  assert.deepEqual(ops.updates, [
    {
      goalId: "g1",
      patch: {
        status: "done",
        type: "week",
        progress: 100, // 夹在 0–100
      },
    },
  ]);
  assert.deepEqual(ops.deletes, []);
});

test("normalizeGoalOps：删除与更新冲突时，被删目标上的 update 丢弃、parentId 指向被删目标的字段重置为空", () => {
  const ops = normalizeGoalOps(
    [
      { type: "delete_goal", goalRef: "g1" },
      { type: "update_goal", goalRef: "g1", priority: "low" },
      { type: "update_goal", goalRef: "g3", parentRef: "g1" },
    ],
    sampleGoals(),
  );
  assert.deepEqual(ops.deletes, [{ goalId: "g1" }]);
  assert.deepEqual(ops.updates, [{ goalId: "g3", patch: { parentId: "" } }]);
});

test("applyGoalOps：应用更新且不改原数组（不可变）", () => {
  const goals = sampleGoals();
  const ops = { updates: [{ goalId: "g2", patch: { priority: "high", status: "done", progress: 100 } }], deletes: [] };
  const next = applyGoalOps(goals, ops);
  assert.equal(next.find((g) => g.id === "g2").priority, "high");
  assert.equal(next.find((g) => g.id === "g2").status, "done");
  assert.equal(next.find((g) => g.id === "g2").progress, 100);
  // 原数组不变
  assert.equal(goals.find((g) => g.id === "g2").priority, "medium");
  assert.equal(goals.find((g) => g.id === "g2").status, "active");
});

test("applyGoalOps：删除目标后子目标上移一层；父链被删则挂到顶层", () => {
  const goals = sampleGoals();
  // 删 g1：g3 应上移挂到 g1 的父级 g0
  const next = applyGoalOps(goals, { updates: [], deletes: [{ goalId: "g1" }] });
  assert.equal(next.find((g) => g.id === "g3").parentId, "g0");
  assert.equal(next.some((g) => g.id === "g1"), false);

  // 同时删 g0 和 g1：g3 挂到顶层
  const next2 = applyGoalOps(goals, { updates: [], deletes: [{ goalId: "g0" }, { goalId: "g1" }] });
  assert.equal(next2.find((g) => g.id === "g3").parentId, "");
});

test("applyGoalOps：先删后改——同批次里更新与删除并存", () => {
  const goals = sampleGoals();
  const ops = {
    updates: [{ goalId: "g2", patch: { title: "每周运动三次" } }],
    deletes: [{ goalId: "g1" }],
  };
  const next = applyGoalOps(goals, ops);
  assert.equal(next.some((g) => g.id === "g1"), false);
  assert.equal(next.find((g) => g.id === "g2").title, "每周运动三次");
  assert.equal(next.length, 3);
});

test("goalOpsSummaryText：中文摘要", () => {
  assert.match(goalOpsSummaryText({ updates: [{ goalId: "a", patch: {} }], deletes: [{ goalId: "b" }] }), /修改 1 个目标、删除 1 个目标/);
  assert.match(goalOpsSummaryText({ updates: [], deletes: [] }), /没有需要应用的修改/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '.../src/planner/goalOps.js'`。

- [ ] **Step 3: 实现** — 新建 `src/planner/goalOps.js`：

```js
// AI 目标调整对话的纯函数：update_goal / delete_goal 动作的归一化、校验与应用。
// 全部无副作用，便于 node:test 单测（见 test/goalOps.test.mjs）。
import { normalizeTitle, titleLooksDuplicate } from "./dedup.js";

const GOAL_TYPES = ["long", "month", "week"];
const GOAL_STATUSES = ["active", "paused", "done"];

// goalRef 可以是已有目标 id、精确标题或近似标题（复用 dedup 的模糊匹配）。
function resolveGoalRef(goals, ref) {
  const value = String(ref ?? "").trim();
  if (!value) return "";
  const byId = goals.find((goal) => goal.id === value);
  if (byId) return byId.id;
  const normalized = normalizeTitle(value);
  const byTitle = goals.find((goal) => normalizeTitle(goal.title) === normalized);
  if (byTitle) return byTitle.id;
  const similar = goals.find((goal) => titleLooksDuplicate(goal.title, value));
  return similar ? similar.id : "";
}

// 把模型返回的 actions 归一化为可应用的 ops：updates（含合法 patch 字段）+ deletes。
// 同一目标多条 update 按顺序合并；引用解析失败的动作整体丢弃。
export function normalizeGoalOps(actions, goals) {
  const actionList = Array.isArray(actions) ? actions : [];
  const goalList = Array.isArray(goals) ? goals : [];
  const updates = [];
  const deletes = [];

  for (const action of actionList) {
    if (!action || typeof action !== "object") continue;

    if (action.type === "delete_goal") {
      const goalId = resolveGoalRef(goalList, action.goalRef);
      if (goalId && !deletes.some((item) => item.goalId === goalId)) deletes.push({ goalId });
      continue;
    }

    if (action.type !== "update_goal") continue;
    const goalId = resolveGoalRef(goalList, action.goalRef);
    if (!goalId) continue;

    const patch = {};
    const title = String(action.title ?? "").trim();
    if (title) patch.title = title;
    if (GOAL_TYPES.includes(action.goalType)) patch.type = action.goalType;
    if (["high", "medium", "low"].includes(action.priority)) patch.priority = action.priority;
    if (GOAL_STATUSES.includes(action.status)) patch.status = action.status;
    const progress = Number(action.progress);
    if (Number.isFinite(progress)) patch.progress = Math.max(0, Math.min(100, Math.round(progress)));
    if (action.parentRef !== undefined) patch.parentId = resolveGoalRef(goalList, action.parentRef);
    if (Object.keys(patch).length === 0) continue;

    const existing = updates.find((item) => item.goalId === goalId);
    if (existing) existing.patch = { ...existing.patch, ...patch };
    else updates.push({ goalId, patch });
  }

  const deletedIds = new Set(deletes.map((item) => item.goalId));
  const validUpdates = updates
    .filter((item) => !deletedIds.has(item.goalId))
    .map((item) => ({
      ...item,
      // parentId 指向本批次被删目标的，重置为顶层
      patch: deletedIds.has(item.patch.parentId) ? { ...item.patch, parentId: "" } : item.patch,
    }));
  return { updates: validUpdates, deletes };
}

// 把 ops 应用到 goals 上（不可变）：先删（子目标上移一层，父链被删则挂顶层）再改。
export function applyGoalOps(goals, ops) {
  const goalList = Array.isArray(goals) ? goals : [];
  const deletedIds = new Set((ops?.deletes || []).map((item) => item.goalId));
  const parentOf = new Map(goalList.map((goal) => [goal.id, goal.parentId || ""]));

  let next = goalList;
  if (deletedIds.size > 0) {
    next = goalList
      .filter((goal) => !deletedIds.has(goal.id))
      .map((goal) => {
        if (!deletedIds.has(goal.parentId)) return goal;
        const grandparentId = parentOf.get(goal.parentId) || "";
        return { ...goal, parentId: deletedIds.has(grandparentId) ? "" : grandparentId };
      });
  }

  const updateById = new Map((ops?.updates || []).map((item) => [item.goalId, item.patch]));
  if (updateById.size === 0) return next;
  return next.map((goal) => (updateById.has(goal.id) ? { ...goal, ...updateById.get(goal.id) } : goal));
}

export function goalOpsSummaryText(ops) {
  const updates = ops?.updates?.length || 0;
  const deletes = ops?.deletes?.length || 0;
  if (!updates && !deletes) return "没有需要应用的修改。";
  const parts = [];
  if (updates) parts.push(`修改 ${updates} 个目标`);
  if (deletes) parts.push(`删除 ${deletes} 个目标`);
  return `已${parts.join("、")}。`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS（全部用例含新增 goalOps 用例，fail 0）。

- [ ] **Step 5: 提交**

```bash
git add src/planner/goalOps.js test/goalOps.test.mjs
git commit -m "feat(goals): add goalOps pure module for conversational goal adjustments"
```

---

### Task 4: goal coach 的 system prompt

**Files:**
- Modify: `src/planningSkill.js`（文件末尾追加两个导出函数）

**Interfaces:**
- Produces（Task 5 依赖）: `goalCoachSystemMessages()` → system message 数组（格式同 `planningCoachSystemMessages()`）；`goalCoachStartMessage()` → 开场 user 消息字符串。

- [ ] **Step 1: 追加实现** — `src/planningSkill.js` 末尾追加：

```js
export function goalCoachSystemMessages() {
  return [
    {
      role: "system",
      content:
        "你是 Plan Pilot 的目标调整助手。每一轮只返回一个 JSON 对象（不要 Markdown、不要 JSON 以外的文字）：{\"message\":\"对用户说的一句话或一个追问\",\"done\":false,\"actions\":[ ... ]}。actions 里的动作是下列之一：" +
        "{\"type\":\"update_goal\",\"goalRef\":\"context.existingGoals 中某个目标的 id 或标题\",\"title\":\"新标题（可选）\",\"goalType\":\"long|month|week（可选）\",\"priority\":\"high|medium|low（可选）\",\"status\":\"active|paused|done（可选）\",\"progress\":0-100（可选）,\"parentRef\":\"新上级目标的 id 或标题（可选，设为空字符串表示挂到顶层）\"}；" +
        "{\"type\":\"delete_goal\",\"goalRef\":\"...\"}；" +
        "{\"type\":\"ask\",\"question\":\"要问用户的一个问题\"}。",
    },
    {
      role: "system",
      content:
        "铁律：goalRef / parentRef 必须指向 context.existingGoals 里已存在的目标；用户没有明确同意的修改不要落。每轮把本轮讨论定下来的调整用 update_goal / delete_goal 落下来，message 只用于说明或承载 ask，绝不允许“说改好了、actions 里却没有任何 update_goal / delete_goal”。删除目标必须先得到用户明确确认才发 delete_goal。",
    },
    {
      role: "system",
      content:
        "职责：帮用户在目标页通过对话调整已有目标——改标题、调整优先级 / 状态（进行中 active、暂停 paused、完成 done）/ 进度 / 层级（父子关系）、删除冗余目标。用户说“把 X 改成 Y / X 提成高优先级 / X 完成了 / 删掉 X / 把 X 挂到 Z 下面”这类意图时，立即用对应动作落下；信息不足时用 ask 追问一句，一次只问一个问题。",
    },
    {
      role: "system",
      content:
        "收尾：用户表示结束（没有了 / 就这样 / 可以了）时 done=true、message 一句话收尾。修改会先展示给用户、点「应用修改」才落库，所以放心把本轮确定的变化放进 actions。",
    },
  ];
}

export function goalCoachStartMessage() {
  return "请开始目标调整对话。先结合我已有的目标，问我想调整哪一块（标题 / 优先级 / 状态 / 层级 / 冗余合并）；我描述调整意图后，你逐条给出修改。";
}
```

- [ ] **Step 2: 验证** — `npm test`（planningSkill.js 无现有测试，确认无回归即可）+ 冒烟：

```bash
/mnt/c/3_apps/nodejs/node.exe -e "import('./src/planningSkill.js').then(m => { console.log(m.goalCoachSystemMessages().length, typeof m.goalCoachStartMessage()); })"
```

Expected: 输出 `4 string`。

- [ ] **Step 3: 提交**

```bash
git add src/planningSkill.js
git commit -m "feat(goals): goal coach system prompts for conversational adjustment"
```

---

### Task 5: App.jsx — goalCoach 状态与处理器

**Files:**
- Modify: `src/App.jsx`（import 区 ~第 11 行、状态区 ~第 144 行之后、处理器区 `acceptPlanningCoachSuggestions` 结束后 ~第 1497 行、GoalsView 渲染 ~第 1820 行）

**Interfaces:**
- Consumes: `goalCoachSystemMessages` / `goalCoachStartMessage`（Task 4）；`normalizeGoalOps` / `applyGoalOps` / `goalOpsSummaryText`（Task 3）；`callPlanningAi` / `coachMessageFrom`（App.jsx 已 import）。
- Produces（Task 6 依赖的 props）: `goalCoach`（state 对象）、`setGoalCoach`、`startGoalCoach`、`sendGoalCoachMessage`、`applyGoalCoachChanges`。`goalCoach` 形状：`{ messages: [{role, content}], input: string, loading: boolean, error: string, ops: { updates, deletes } | null }`。

- [ ] **Step 1: 加 import** — `src/App.jsx` 第 12 行 `planningCoachSystemMessages` 所在 import 块中加入 `goalCoachStartMessage, goalCoachSystemMessages`；另起一行：

```js
import { applyGoalOps, goalOpsSummaryText, normalizeGoalOps } from "./planner/goalOps.js";
```

- [ ] **Step 2: 加状态** — `planningCoach` 的 useState（第 144 行起）之后追加：

```js
  // 目标页的 AI 调整对话：messages 为聊天记录，ops 为待确认的修改（点「应用修改」才落库）
  const [goalCoach, setGoalCoach] = useState({
    messages: [],
    input: "",
    loading: false,
    error: "",
    ops: null,
  });
```

- [ ] **Step 3: 加处理器** — `acceptPlanningCoachSuggestions` 函数结束后（`exportData` 之前）追加：

```js
  async function runGoalCoach(nextMessages) {
    if (!planner.ai.enabled) {
      setGoalCoach((coach) => ({
        ...coach,
        loading: false,
        error: "请先在设置里启用 AI（点左侧齿轮）。",
        messages: nextMessages,
      }));
      return;
    }

    setGoalCoach((coach) => ({ ...coach, loading: true, error: "", messages: nextMessages }));
    try {
      const result = await callPlanningAi({
        ai: planner.ai,
        apiKey: localAiKey,
        serverKeyOk: serverAiKeyLoaded,
        maxTokens: 1200,
        messages: [
          ...goalCoachSystemMessages(),
          {
            role: "user",
            content: JSON.stringify({
              today: selectedDate,
              existingGoals: planner.goals.map(({ id, title, type, parentId, status, priority, progress }) => ({
                id,
                title,
                type,
                parentId,
                status,
                priority,
                progress,
              })),
            }),
          },
          ...nextMessages.map((message) => ({ role: message.role, content: message.content })),
        ],
      });

      const ops = normalizeGoalOps(result?.actions, planner.goals);
      setGoalCoach((coach) => ({
        ...coach,
        loading: false,
        error: "",
        messages: nextMessages.concat({ role: "assistant", content: coachMessageFrom(result) || "我看过你的目标了，想调整哪一块？" }),
        ops: ops.updates.length || ops.deletes.length ? ops : null,
      }));
    } catch (error) {
      setGoalCoach((coach) => ({ ...coach, loading: false, error: error.message || "AI 目标调整失败。" }));
    }
  }

  function startGoalCoach() {
    if (goalCoach.messages.length || goalCoach.loading) return; // 对话进行中不重复开场
    runGoalCoach([{ role: "user", content: goalCoachStartMessage() }]);
  }

  function sendGoalCoachMessage(event) {
    event.preventDefault();
    const content = goalCoach.input.trim();
    if (!content || goalCoach.loading) return;
    const nextMessages = goalCoach.messages.concat({ role: "user", content });
    setGoalCoach((coach) => ({ ...coach, input: "" }));
    runGoalCoach(nextMessages);
  }

  function applyGoalCoachChanges() {
    const ops = goalCoach.ops;
    if (!ops || (!ops.updates.length && !ops.deletes.length)) return;
    patchPlanner((current) => ({ goals: applyGoalOps(current.goals, ops) }));
    setGoalCoach((coach) => ({
      ...coach,
      ops: null,
      messages: coach.messages.concat({ role: "assistant", content: goalOpsSummaryText(ops) }),
    }));
  }
```

- [ ] **Step 4: 给 GoalsView 传 props** — App.jsx 中 `<GoalsView` 的 props 里追加：

```jsx
            goalCoach={goalCoach}
            setGoalCoach={setGoalCoach}
            startGoalCoach={startGoalCoach}
            sendGoalCoachMessage={sendGoalCoachMessage}
            applyGoalCoachChanges={applyGoalCoachChanges}
```

- [ ] **Step 5: 验证** — `npm test` + `npm run dev` 确认页面无报错（GoalsView 还没消费这些 props，多余 props 无副作用）+ 浏览器控制台无错误。

- [ ] **Step 6: 提交**

```bash
git add src/App.jsx
git commit -m "feat(goals): goal coach conversation state and handlers in App"
```

---

### Task 6: GoalsView — 「目标调整对话」面板

**Files:**
- Modify: `src/views/GoalsView.jsx`
- Modify: `src/styles.css`（追加删除卡片样式）

**Interfaces:**
- Consumes: Task 5 的 props + 已有 `goalById`、`goalTypeLabel`、`priorityLabel`。
- Produces: 无（纯展示层）。

- [ ] **Step 1: 更新 import 与 props 签名** — GoalsView.jsx 第 1 行改为：

```js
import { CheckCircle2, ListTodo, Plus, Send, Sparkles, Wand2, X } from "lucide-react";
```

第 2 行后加：

```js
import { goalStatusLabel } from "../constants/labels.js";
```

（若 `labels.js` 没有 `goalStatusLabel`，见 Step 3 先补。）props 解构末尾（`deleteGoal,` 之后）追加：

```js
  goalCoach,
  setGoalCoach,
  startGoalCoach,
  sendGoalCoachMessage,
  applyGoalCoachChanges,
```

- [ ] **Step 2: 在 `breakdown-panel` 的 `</section>` 之后、`future-task-panel` 之前插入面板**：

```jsx
      <section className="panel goal-coach-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">目标调整对话</p>
            <h2>用对话微调已有目标</h2>
          </div>
        </div>

        <div className="interview-body">
          {goalCoach.messages.length === 0 && !goalCoach.loading && (
            <EmptyState
              icon={<Sparkles size={22} />}
              text="点「开始调整」→ 告诉 AI 想改什么（标题 / 优先级 / 状态 / 层级 / 删除）；出现修改卡片后点「应用修改」生效。"
            />
          )}
          {(goalCoach.messages.length > 0 || goalCoach.loading) && (
            <div className="chat-scroll">
              <div className="interview-messages">
                {goalCoach.messages.map((message, index) => (
                  <div className={`chat-row ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === "assistant" && (
                      <span className="chat-avatar"><Sparkles size={13} /></span>
                    )}
                    <article className={`interview-message ${message.role}`}>{message.content}</article>
                  </div>
                ))}
                {goalCoach.loading && (
                  <div className="chat-row assistant">
                    <span className="chat-avatar"><Sparkles size={13} /></span>
                    <div className="chat-typing" aria-label="AI 正在输入">
                      <i /><i /><i />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {goalCoach.error && <div className="ai-error block">{goalCoach.error}</div>}

          {goalCoach.ops && (
            <div className="coach-suggestions">
              <p className="coach-suggestions-caption">AI 提议的修改 · 确认后点「应用修改」</p>
              {goalCoach.ops.updates.map((item) => (
                <article className="coach-suggestion" key={`update-${item.goalId}`}>
                  <strong>{goalById[item.goalId]?.title || item.goalId}</strong>
                  <span>
                    {updatePatchSummary(item.patch, goalById)}
                  </span>
                </article>
              ))}
              {goalCoach.ops.deletes.map((item) => (
                <article className="coach-suggestion is-delete" key={`delete-${item.goalId}`}>
                  <strong>{goalById[item.goalId]?.title || item.goalId}</strong>
                  <span>删除（子目标会上移一层）</span>
                </article>
              ))}
              <div className="interview-actions">
                <button className="primary-action" onClick={applyGoalCoachChanges}>
                  <CheckCircle2 size={18} />
                  应用修改
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setGoalCoach((coach) => ({ ...coach, ops: null }))}
                >
                  <X size={18} />
                  忽略这批
                </button>
              </div>
            </div>
          )}
        </div>

        <form className="interview-form" onSubmit={sendGoalCoachMessage}>
          <textarea
            value={goalCoach.input}
            onChange={(event) => setGoalCoach((coach) => ({ ...coach, input: event.target.value }))}
            placeholder="例如：把“论文实验”改成高优先级；周报已经写完了；删掉“学吉他”"
          />
          <div className="interview-actions">
            <button className="primary-action" disabled={goalCoach.loading || !goalCoach.input.trim()}>
              <Send size={18} />
              发送
            </button>
            <button type="button" className="secondary-action" onClick={startGoalCoach} disabled={goalCoach.loading}>
              <Sparkles size={18} />
              {goalCoach.loading ? "AI 思考中" : "开始调整"}
            </button>
          </div>
        </form>
      </section>
```

- [ ] **Step 3: 辅助函数与标签** — `src/constants/labels.js` 追加：

```js
export const goalStatusLabel = { active: "进行中", paused: "已暂停", done: "已完成" };
```

GoalsView 组件函数体（`parentOptions` 定义之前）加：

```js
  function updatePatchSummary(patch, goalMap) {
    const parts = [];
    if (patch.title) parts.push(`标题 → 「${patch.title}」`);
    if (patch.type) parts.push(`类型 → ${goalTypeLabel[patch.type]}`);
    if (patch.priority) parts.push(`优先级 → ${priorityLabel[patch.priority]}`);
    if (patch.status) parts.push(`状态 → ${goalStatusLabel[patch.status]}`);
    if (patch.progress !== undefined) parts.push(`进度 → ${patch.progress}%`);
    if (patch.parentId !== undefined) parts.push(`上级 → ${goalMap[patch.parentId]?.title || "无"}`);
    return parts.join(" · ");
  }
```

- [ ] **Step 4: 样式** — `src/styles.css` 在现有 `.coach-suggestion` 样式块（~1239 行）之后追加：

```css
.coach-suggestion.is-delete {
  border-color: var(--danger, #d64545);
  background: color-mix(in srgb, var(--danger, #d64545) 6%, var(--surface));
}
.coach-suggestion.is-delete strong::after {
  content: "（删除）";
  color: var(--danger, #d64545);
  font-size: 0.85em;
  margin-left: 6px;
}
```

（先 `grep -n "\-\-danger" src/styles.css` 确认变量名；若主题里是别的名字如 `--danger-tone`，用实际变量并去掉 fallback。）

- [ ] **Step 5: 验证** — `npm test` + `npm run dev` 手动验证：
  1. 「目标」页出现「目标调整对话」面板，点「开始调整」AI 回复开场问题（需配置 AI Key，未启用时显示错误提示）；
  2. 输入「把"每周健身三次"改成高优先级」→ 出现修改卡片（优先级 → 高）；
  3. 点「应用修改」→ 目标列表/甘特图中该目标优先级变化，卡片消失，聊天记录追加「已修改 1 个目标。」；
  4. 点「忽略这批」→ 卡片消失、目标不变；
  5. 对话中说「删掉 XX」→ 出现红色删除卡片，确认后目标消失、其子目标上移一层。

- [ ] **Step 6: 提交**

```bash
git add src/views/GoalsView.jsx src/styles.css src/constants/labels.js
git commit -m "feat(goals): AI goal-adjustment chat panel in GoalsView"
```

---

### Task 7: 收尾 — 文档修正与全量验证

**Files:**
- Modify: `CLAUDE.md`（常用命令一节）

- [ ] **Step 1: 修正 CLAUDE.md** — 把「没有测试、lint 或类型检查脚本。」改为：

```markdown
测试用 node:test：`npm test`。没有 lint 或类型检查脚本。
```

- [ ] **Step 2: 全量验证**
  - `npm test` → fail 0；
  - `npm run build` → 构建成功；
  - `npm run dev` 走一遍两个功能的手动检查清单（Task 2 Step 4 + Task 6 Step 5）；
  - `git log --oneline` 确认提交序列干净、无换行噪声混入（`git show --stat` 每个提交只含本任务文件）。

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: correct test command in CLAUDE.md"
```

---

## Self-Review 结论

- **规格覆盖**：两个需求各有任务（时间轴：Task 1–2；AI 调整对话：Task 3–6）；范围扩展设计决策已在「设计决策」节注明。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
- **类型一致性**：`computeTimelineRange` 返回 `{dayStart, dayEnd}` 与 DayTimeline 解构一致；`goalCoach` 状态形状在 Task 5/6 间一致；`normalizeGoalOps`/`applyGoalOps` 签名与测试及调用点一致；`goalStatusLabel` 在 labels.js 定义、GoalsView 消费。
- **测试可跑性**：模糊标题匹配用例（"完成论文的实验"）已用 node 实测 `titleLooksDuplicate` 返回 true；`npm test` 基线 fail 0。
