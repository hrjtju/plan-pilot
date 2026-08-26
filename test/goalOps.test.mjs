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
  assert.equal(ops.updates.length, 2);
  assert.deepEqual(ops.updates[0], { goalId: "g1", patch: { priority: "low", title: "论文实验收尾" } });
  assert.deepEqual(ops.updates[1], { goalId: "g2", patch: { status: "paused" } });
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

test("applyGoalOps：patch 的 parentId 指向已不存在的目标时重置为顶层", () => {
  const goals = sampleGoals();
  const next = applyGoalOps(goals, { updates: [{ goalId: "g3", patch: { parentId: "ghost" } }], deletes: [] });
  assert.equal(next.find((g) => g.id === "g3").parentId, "");
});

test("normalizeGoalOps：无法解析的非空 parentRef 丢弃该字段，不误挂顶层", () => {
  const ops = normalizeGoalOps([{ type: "update_goal", goalRef: "g2", parentRef: "不存在的上级", priority: "low" }], sampleGoals());
  assert.deepEqual(ops.updates, [{ goalId: "g2", patch: { priority: "low" } }]);
});

test("normalizeGoalOps：progress 为 null 或空字符串时不产生进度变更", () => {
  const ops = normalizeGoalOps([{ type: "update_goal", goalRef: "g1", progress: null }], sampleGoals());
  assert.equal(ops.updates.length, 0);
});
