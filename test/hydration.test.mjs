import { test } from "node:test";
import assert from "node:assert/strict";

import {
  expandRecurringBlocks,
  hydrateState,
  isRecurringDerivedBlock,
  mergeOfflineEdits,
  replaceRecurringBlocks,
} from "../src/planner/hydration.js";

test("hydrateState：迁移旧 workStart/workEnd，并兼容 breakMinutes", () => {
  const state = hydrateState({
    settings: {
      workStart: "08:30",
      workEnd: "17:30",
      breakMinutes: 15,
    },
  });

  assert.deepEqual(state.settings.workSegments, [{ start: "08:30", end: "17:30" }]);
  assert.equal(state.settings.shortBreak, 15);
  assert.equal(state.settings.longBreak, 30);
});

test("hydrateState：不会把旧数据里的 AI apiKey 带入 planner 状态", () => {
  const state = hydrateState({
    ai: {
      enabled: true,
      provider: "custom",
      apiKey: "secret-key",
    },
  });

  assert.equal(state.ai.provider, "custom");
  assert.equal(Object.hasOwn(state.ai, "apiKey"), false);
});

test("hydrateState：目标补 progress，非数组字段回退为空集合", () => {
  const state = hydrateState({
    goals: [{ id: "g1", title: "写论文", type: "long" }],
    tasks: null,
    blocks: null,
    reviews: "bad",
    dayPlans: "bad",
  });

  assert.deepEqual(state.goals, [{ progress: 0, id: "g1", title: "写论文", type: "long" }]);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.blocks, []);
  assert.deepEqual(state.reviews, []);
  assert.deepEqual(state.dayPlans, {});
});

test("hydrateState：通过显式 mergeTasks 注入任务去重策略", () => {
  const state = hydrateState(
    {
      tasks: [
        { id: "t1", title: "读论文", date: "2026-06-26" },
        { id: "t2", title: "读论文", date: "2026-06-26" },
      ],
    },
    {
      mergeTasks(tasks) {
        return tasks.slice(0, 1);
      },
    },
  );

  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, "t1");
});

test("expandRecurringBlocks：从指定基准日期展开未来一年内的周期安排", () => {
  const blocks = expandRecurringBlocks(
    [{ id: "r1", title: "组会", dayOfWeek: 1, start: "09:00", end: "10:00", endDate: "2026-07-06" }],
    [],
    { baseDate: "2026-06-26" },
  );

  assert.deepEqual(
    blocks.map((block) => block.date),
    ["2026-06-29", "2026-07-06"],
  );
  assert.equal(blocks[0].id, "rec-r1-2026-06-29");
  assert.equal(blocks[0].recurringDerived, true);
});

test("replaceRecurringBlocks：保留手动块、丢弃旧派生块，并避免重复已有安排", () => {
  const manualBlock = {
    id: "manual-1",
    date: "2026-06-29",
    type: "busy",
    title: "组会",
    start: "09:00",
    end: "10:00",
  };
  const oldDerived = {
    id: "rec-r1-2026-06-22",
    recurringDerived: true,
    date: "2026-06-22",
    type: "busy",
    title: "组会",
    start: "09:00",
    end: "10:00",
  };

  const blocks = replaceRecurringBlocks(
    [{ id: "r1", title: "组会", dayOfWeek: 1, start: "09:00", end: "10:00", endDate: "2026-06-29" }],
    [manualBlock, oldDerived],
    { baseDate: "2026-06-26" },
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], manualBlock);
  assert.equal(isRecurringDerivedBlock(oldDerived), true);
  assert.equal(isRecurringDerivedBlock(manualBlock), false);
});

// —— mergeOfflineEdits：离线编辑合并（保存失败 → 下次加载回传） ——

test("mergeOfflineEdits：两侧独有条目都保留（并集）", () => {
  const file = { tasks: [{ id: "t1", title: "文件任务" }], blocks: [], goals: [], reviews: [], recurring: [] };
  const local = { tasks: [{ id: "t2", title: "离线新建" }], blocks: [], goals: [], reviews: [], recurring: [] };
  const merged = mergeOfflineEdits(file, local);
  assert.deepEqual(merged.tasks.map((t) => t.id).sort(), ["t1", "t2"]);
});

test("mergeOfflineEdits：同 id 冲突本地胜（离线编辑是当前会话的主动操作）", () => {
  const file = { tasks: [{ id: "t1", title: "文件旧标题", status: "open" }] };
  const local = { tasks: [{ id: "t1", title: "本地新标题", status: "open" }] };
  const merged = mergeOfflineEdits(file, local);
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].title, "本地新标题");
});

test("mergeOfflineEdits：blocks/goals/reviews/recurring 按 id 并集且本地胜", () => {
  const file = {
    blocks: [{ id: "b1", start: "09:00" }],
    goals: [{ id: "g1", startDate: "2026-08-01" }],
    reviews: [{ id: "r1" }],
    recurring: [{ id: "rc1", title: "旧规则" }],
  };
  const local = {
    blocks: [{ id: "b1", start: "10:00" }, { id: "b2", start: "14:00" }],
    goals: [{ id: "g2", startDate: "2026-09-01" }],
    reviews: [],
    recurring: [{ id: "rc2", title: "新规则" }],
  };
  const merged = mergeOfflineEdits(file, local);
  assert.equal(merged.blocks.length, 2); // b1 本地胜 + b2 新增
  assert.equal(merged.blocks.find((b) => b.id === "b1").start, "10:00");
  assert.equal(merged.goals.length, 2);
  assert.equal(merged.reviews.length, 1);
  assert.equal(merged.recurring.length, 2);
});

test("mergeOfflineEdits：dayPlans 按日期并集，同日期本地胜", () => {
  const file = { dayPlans: { "2026-08-28": { energy: "低" }, "2026-08-29": { energy: "高" } } };
  const local = { dayPlans: { "2026-08-28": { energy: "中" } } };
  const merged = mergeOfflineEdits(file, local);
  assert.deepEqual(Object.keys(merged.dayPlans).sort(), ["2026-08-28", "2026-08-29"]);
  assert.equal(merged.dayPlans["2026-08-28"].energy, "中");
  assert.equal(merged.dayPlans["2026-08-29"].energy, "高");
});

test("mergeOfflineEdits：settings/ai 浅合并，文件侧新增键保留、本地值覆盖", () => {
  const file = { settings: { workSegments: [{ start: "09:00", end: "18:00" }], soundFx: true }, ai: { model: "old-model" } };
  const local = { settings: { soundFx: false }, ai: { model: "new-model", provider: "deepseek" } };
  const merged = mergeOfflineEdits(file, local);
  assert.equal(merged.settings.soundFx, false); // 本地覆盖
  assert.deepEqual(merged.settings.workSegments, [{ start: "09:00", end: "18:00" }]); // 文件键保留
  assert.equal(merged.ai.model, "new-model");
  assert.equal(merged.ai.provider, "deepseek");
});

test("mergeOfflineEdits：健壮性——任一侧为空/null 均安全", () => {
  const local = { tasks: [{ id: "t1" }] };
  assert.deepEqual(mergeOfflineEdits(null, local).tasks, [{ id: "t1" }]);
  assert.deepEqual(mergeOfflineEdits(undefined, local).tasks, [{ id: "t1" }]);
  const file = { tasks: [{ id: "t1", title: "x" }] };
  const merged = mergeOfflineEdits(file, null);
  assert.deepEqual(merged.tasks, [{ id: "t1", title: "x" }]);
  assert.deepEqual(merged.blocks, []);
  const empty = mergeOfflineEdits({}, {});
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(empty.dayPlans, {});
});
