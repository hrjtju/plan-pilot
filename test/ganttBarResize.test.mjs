import test from "node:test";
import assert from "node:assert/strict";
import { clampResizeDelta } from "../src/planner/ganttBarResize.js";
import { dayDiff } from "../src/utils/dateTime.js";

// 起点 2026-03-01，终点 2026-03-07：dayDiff = 6（含首尾共 7 天）
const S = "2026-03-01";
const E = "2026-03-07";

test("clampResizeDelta：右缘（end）自由外扩、内收夹到 start（保 1 天）", () => {
  assert.equal(clampResizeDelta(S, E, "end", 3, dayDiff), 3); // 外扩 3 天
  assert.equal(clampResizeDelta(S, E, "end", -4, dayDiff), -4); // 内收 4 天（end=03-03 > start，合法）
  assert.equal(clampResizeDelta(S, E, "end", -6, dayDiff), -6); // end=03-01，恰 1 天宽
  assert.equal(clampResizeDelta(S, E, "end", -9, dayDiff), -6); // 拖过头，夹到 start
});

test("clampResizeDelta：左缘（start）自由外扩、内收夹到 end（保 1 天）", () => {
  assert.equal(clampResizeDelta(S, E, "start", -3, dayDiff), -3); // 外扩 3 天
  assert.equal(clampResizeDelta(S, E, "start", 4, dayDiff), 4); // 内收 4 天（start=03-05 < end，合法）
  assert.equal(clampResizeDelta(S, E, "start", 6, dayDiff), 6); // start=03-07，恰 1 天宽
  assert.equal(clampResizeDelta(S, E, "start", 9, dayDiff), 6); // 拖过头，夹到 end
});

test("clampResizeDelta：取整、零增量与 -0 规范化", () => {
  assert.equal(clampResizeDelta(S, E, "end", 2.4, dayDiff), 2);
  assert.equal(clampResizeDelta(S, E, "end", 2.6, dayDiff), 3);
  assert.equal(clampResizeDelta(S, E, "end", 0, dayDiff), 0);
  assert.equal(clampResizeDelta(S, E, "end", NaN, dayDiff), 0);
  assert.ok(!Object.is(clampResizeDelta(S, E, "start", -0.4, dayDiff), -0)); // round(-0.4)=-0 → 0
});

test("clampResizeDelta：非法 edge 返回 0；单日条不可再收", () => {
  assert.equal(clampResizeDelta(S, E, "middle", 5, dayDiff), 0);
  const s1 = "2026-03-01";
  assert.equal(clampResizeDelta(s1, s1, "end", -3, dayDiff), 0); // len=0，右缘不可左拖
  assert.equal(clampResizeDelta(s1, s1, "start", 3, dayDiff), 0); // len=0，左缘不可右拖
  assert.equal(clampResizeDelta(s1, s1, "end", 5, dayDiff), 5); // 仍可外扩
});
