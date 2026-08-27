import test from "node:test";
import assert from "node:assert/strict";
import { dividerBeforeIndexes } from "../src/planner/gantt.js";

const rowsOf = (depths) => depths.map((depth, i) => ({ id: `g${i}`, depth }));

test("dividerBeforeIndexes：混合层级——每个新的顶级行前都要分隔线", () => {
  assert.deepEqual(dividerBeforeIndexes(rowsOf([0, 1, 1, 0, 1, 0])), [3, 5]);
});

test("dividerBeforeIndexes：首个顶级行前不插", () => {
  assert.deepEqual(dividerBeforeIndexes(rowsOf([0, 1, 0])), [2]);
  assert.deepEqual(dividerBeforeIndexes(rowsOf([0])), []);
});

test("dividerBeforeIndexes：相邻顶级行之间也有分隔线", () => {
  assert.deepEqual(dividerBeforeIndexes(rowsOf([0, 0, 0])), [1, 2]);
});

test("dividerBeforeIndexes：无顶级行 / 空行表返回空", () => {
  assert.deepEqual(dividerBeforeIndexes(rowsOf([1, 1, 2])), []);
  assert.deepEqual(dividerBeforeIndexes([]), []);
});
