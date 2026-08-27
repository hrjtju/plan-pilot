import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 甘特条优先级配色的静态防回归检查：验证 styles.css 中按优先级取色的规则未被误删。
// 注意：这是「存在性」检查，视觉正确性由 e2e-gantt 场景 G 的 computed style 断言覆盖。
const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/styles.css"), "utf8");

test("gantt 优先级配色：三档背景/边框规则引用对应主题变量", () => {
  for (const p of ["high", "medium", "low"]) {
    const rule = new RegExp(`\\.gantt-bar\\.priority-${p}\\s*\\{[^}]*background:\\s*var\\(--priority-${p}-soft\\)[^}]*border-color:\\s*var\\(--priority-${p}-bar\\)`);
    assert.match(css, rule, `.gantt-bar.priority-${p} 应引用 --priority-${p}-soft/bar`);
  }
});

test("gantt 优先级配色：进度填充随优先级取色", () => {
  for (const p of ["high", "medium", "low"]) {
    assert.match(css, new RegExp(`\\.gantt-bar\\.priority-${p} \\.gantt-bar-fill\\s*\\{[^}]*var\\(--priority-${p}-bar\\)`));
  }
});
