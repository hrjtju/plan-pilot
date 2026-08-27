# 运行记录（worklog）

> 约定：每次功能性改动在此追加一节，写清动机、实现、验证与遇到的问题。

## 2026-08-27 甘特图交互四连改（滚轮语义 / 条拖拽调时长 / 优先级配色 / 顶级分隔线）

本节按四个功能分四步推进，每步独立 commit（单测 + e2e 验证后提交）。

### 功能 A：滚轮语义分离——默认平移，Ctrl/Shift 才缩放

**动机**：原先滚轮落在甘特图上即缩放时间刻度，用户失去「扫视时间线」的自然手段。

**实现**：
- `src/planner/ganttZoom.js` 新增三个纯函数：`clampPanStartOff`（夹取窗口起点，保证窗口与内容区至少 `GANTT_PAN_MIN_VISIBLE_DAYS`（7 天）交集，且规范化 `-0`）、`panWindow`（平移 + 夹取，span 不变）、`wheelToPanDays`（滚轮像素 → 天数，round 取整；不足 1 天但 ≥ `GANTT_PAN_MIN_DELTA_PX`（12px）时保底 1 天，微颤不动）。
- `src/components/gantt/GoalGantt.jsx`：wheel handler 分支——`e.ctrlKey || e.shiftKey` 走原锚点缩放 `applyZoomStep`（方向取 `(deltaY || deltaX) > 0`，容错 Chrome/Firefox 把 Shift+滚轮位移挪到 deltaX）；否则走平移 `applyPan`（优先横向位移，deltaMode=行/页时归一为像素；天数 = `wheelToPanDays(px, trackW / viewDays)`）。fit 模式（zoom=null）平移时以内容全幅为基准窗口，位移后脱离适应模式激活 zoom。
- **rAF 调度**：listener 内只同步 `preventDefault` 与意图计算，`setState` 推迟到下一帧（见问题 1）。

**验证**：`test/ganttZoom.test.mjs` 新增 5 个用例（117 全绿）；`scripts/e2e-gantt.mjs` 场景 C 重写为 C1–C5（Ctrl 缩放 / Shift 缩放 / 裸滚轮平移 / 全程页面不滚动 / 真实 CDP 滚轮冒烟），全部通过。

**问题与发现**：
1. **wheel listener 内同步 setState 会让 preventDefault 失效**。React 离散事件中 setState 同步 flush 重渲染，listener 执行时长超过 Chromium 对 wheel 事件可取消性的 ~100ms 超时后，事件被降级为不可取消，默认平滑滚动照常启动（e2e 实测页面被滚走 51px，且滚出 guard 的 280ms 锁定窗口）。修复：listener 内只做同步 preventDefault，状态更新经 `requestAnimationFrame` 推迟到下一帧。
2. **Playwright/CDP 合成 wheel 的默认滚动不受 renderer 的 preventDefault 控制**（compositor 层不等待/不理会主线程判定），`page.mouse.wheel` 不能用于断言「页面不滚动」。e2e 的核心滚轮断言改用页面内 `dispatchEvent(new WheelEvent(..., { cancelable: true }))`——与真实输入同路径触发 listener 与 preventDefault，行为确定；真实 CDP wheel 仅保留一条冒烟断言（handler 收到事件并平移生效）。
3. **Vite dev server 的模块 transform 缓存可能卡在坏状态**：编辑器多次原子写入之间 HMR 窗口期，模块图缓存了损坏结果，之后不带查询参数的 URL 一直返回空 body（页面报 `does not provide an export named 'GoalGantt'`，curl 该模块只回一个空 sourceMappingURL）。`touch` 文件或给 URL 加查询参数即可恢复。以后 e2e 莫名「组件导出丢失」先 touch 再怀疑代码。
4. **page.evaluate 传参解构不匹配的静默失效**：`fireWheel({ deltaY })` 传给 `evaluate(({ o }) => ...)` 少包了一层 `o`，导致 WheelEvent 的 deltaY 恒为 0、handler 按「无位移」提前 return——表现为「合成事件完全无效」，排查绕了大弯。教训：evaluate 回调签名与传参形状要配对检查，dispatch 后先断言 `ev.defaultPrevented` 再往下查。
