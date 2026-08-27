# 运行记录（worklog）

> 约定：每次功能性改动在此追加一节，写清动机、实现、验证与遇到的问题。

## 2026-08-27 22:50 重新部署 dev server（保留用户数据）

**操作**：杀掉旧 Vite dev server（Windows 侧 PID 12296→54872→30628→37584 进程树，`taskkill /T /F`），以 startup.bat 同等方式重启（分离的 `cmd /c "npm run dev"`、cwd 锁定项目根、日志追加到 `dev-server.log` / `dev-server.err.log`）。新实例 Vite v6.4.2，PID 27204，802ms 就绪，HTTP 200。

**用户数据保护**：
- 浏览器 localStorage（权威数据源）不受进程重启影响，页面刷新后自动重连 HMR。
- 文件侧后端 `data/`（config.json / .index.json / daily/ / goals/ / recurring.json，共 13 文件）在重启前打包备份至 `../plan-pilot-data-backup-20260827-2240.tar.gz`，并记录三份核心文件 sha256；重启后逐字节能校验，三个哈希与重启前完全一致，`GET /api/data` 返回真实设置数据。
- **关键陷阱**：`vite.config.js` 的 `DATA_DIR = path.resolve("data")` 相对运行时 cwd 解析，重启时必须确保 cwd 是项目根，否则会静默创建新的空 data 目录（看似数据丢失）。本次通过 `-WorkingDirectory` 显式锁定。
- 无关 node 进程（codex、pi 等）已逐一识别并避开，未误伤。

## 2026-08-27 甘特图交互四连改（滚轮语义 / 条拖拽调时长 / 优先级配色 / 顶级分隔线）

本节按四个功能分四步推进，每步独立 commit（单测 + e2e 验证后提交）。

**总结与反思**：
- 四个 commit：`feat(gantt): wheel pans view by default...` / `feat(gantt): drag bar edges to resize...` / `feat(gantt): color bars by goal priority...` / `feat(gantt): thick divider between top-level goal groups`。
- 单测从 112 → 127 全绿；e2e-gantt 从 14 → 30 项断言全过；纯逻辑全部下沉到 planner 纯函数（panWindow / clampResizeDelta / dividerBeforeIndexes），组件只负责事件编排与预览 CSS 变量，与既有「时间轴拖拽」架构风格一致。
- **最大的一次返工来自一个自己的低级错误**（evaluate 传参解构不匹配）引发的连环排查：一开始把「合成 wheel 无效」错怪到 Chrome 的 Shift+滚轮转换和 React 渲染耗时上，先后做了事件属性诊断、target 命中诊断、probe listener、rAF 调度四个实验才定位。虽然 rAF 调度最终证明仍是有价值的安全加固（真实用户场景下同样存在 Chromium wheel 可取消性超时风险），但正确顺序应该是：先最小化复现 + 逐层断言（dispatch 后立即查 `defaultPrevented`），再谈机制猜想。
- **遗留观察项**（不阻塞）：① Vite dev server 长时间编辑后模块缓存可能卡坏，需 touch 恢复，若频发应升级 Vite 或在 startup 脚本加 `--force` 备选；② CDP 合成 wheel 的默认滚动不受 preventDefault 控制，以后凡涉及「滚轮阻止页面滚动」的 e2e 断言一律走 dispatchEvent 路径；③ 甘特条 hover 提示文案已更新为「拖动平移/拖边缘调整」，但移动端（触屏）未验证边缘手柄的命中热区，后续真机过一遍。
- **push 卡死问题**：WSL 侧 `git push` 无输出挂起数分钟——根因是 WSL 侧未配置 credential helper，git 在终端静默等待输入 GitHub 凭据（用 `GIT_TERMINAL_PROMPT=0` 重跑即立刻报 `could not read Username` 确认）。解法：用 `-c credential.helper="<Windows Git>/mingw64/bin/git-credential-manager.exe"` 桥接 Windows 凭据库一次性推送（本机路径 `C:\3_apps\git\Git`）。若以后常在 WSL 侧 push，建议把该 helper 写进 `~/.gitconfig`。

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

### 功能 B：甘特条边缘拖拽调整时长

**动机**：原先条只能整体平移（保时长），想改起止日期只能进编辑表单填日期。

**实现**：
- 新建 `src/planner/ganttBarResize.js`：`clampResizeDelta(origStart, origEnd, edge, deltaDays, dayDiffFn)` 纯函数——左缘（start）向右最多拖到与 end 重合、右缘（end）向左最多拖到与 start 重合，均保底 1 天时长；round 取整、`-0` 规范化。
- `GoalGantt.jsx`：拖拽状态机扩展为 `mode: "move" | "resize-start" | "resize-end"`；条两端新增 `.gantt-bar-handle`（仅 movable 条渲染），手柄 `pointerdown` 时 `stopPropagation()` 防止触发整体平移，`setPointerCapture` 在手柄上、后续 move/up 事件冒泡回条上的统一 handler；预览用 `--bar-dl/--bar-dw`（left/width 的像素增量）替代重渲染，提交时只写受影响的那个日期字段。
- 条的 `left/width` 改为 `calc(<%> + var(--bar-dl/dw, 0px))`，与整体平移的 `--bar-shift` 互不干扰。
- CSS：手柄 10px 宽热区，hover/拖拽中显竖条，`touch-action: none`；派生跨度条无手柄。

**验证**：新增 `test/ganttBarResize.test.mjs` 4 组用例（外扩/内收/夹取/单日条不可再收，121 全绿）；e2e 新增场景 F（F1a 预览变量、F1b 右缘外扩 start 不变、F2 左缘内收 end 不变、F2c 时长收缩、F3 派生条无手柄），全部通过。

**问题与发现**：
1. 手柄用 `setPointerCapture` 后，pointermove 的 target 是手柄而非条——但事件仍沿 DOM 冒泡，条上的统一 handler 能收到；`e.currentTarget` 始终是绑定 handler 的条，预览 CSS 变量设置在条上即可，手柄随条尺寸自动跟随。
2. Playwright 的 `mouse.down/move/up` 能驱动 pointer 事件（Chromium 将 mouse input 合成 PointerEvent），与现有场景 D 的整体拖拽同路径，无需单独的 touch 注入。

### 功能 C：甘特条按优先级配色

**动机**：原先条只有统一 accent 底色 + 优先级只改变边框色，区分度弱。

**实现**：四套主题均已定义 `--priority-{high,medium,low}-{soft,bar,ink}` 变量（任务列表/目标卡在用），直接复用：条背景 = soft、边框 = bar、进度填充 = bar 色 34% 混透明、pct 文字继承边框色；`status-done` 的降透明度、`estimated` 虚线保持叠加生效。

**验证**：e2e 新增场景 G——seed 注入高优先级目标，断言三档条的 computed `background-color` 分别等于对应 CSS 变量的解析值（跟随主题而非硬编码色值）且三色互不相同；另有 `test/ganttPriorityStyles.test.mjs` 两个静态存在性检查防规则被误删（视觉正确性由场景 G 覆盖，此处不重复声称）。

**问题与发现**：
1. 纯 CSS 改动没有渲染层单测基建，选了「computed style vs CSS 变量解析值」的 e2e 断言路线，比硬编码 rgb 期望值更耐主题调整；静态文件检查只作为存在性防回归，不能证明视觉正确，两类测试的分工在注释中明确标注。

### 功能 D：顶级目标之间的粗水平分隔线

**动机**：目标有层级（长期/月度/本周嵌套），但视觉上顶级目标之间的分组边界不明显，多条子目标排在一起难以快速切分组。

**实现**：
- `src/planner/gantt.js` 新增 `dividerBeforeIndexes(rows)` 纯函数：返回应在其前渲染分隔线的行下标（depth===0 且非首行；孤儿目标也被 place 为 depth 0，同样参与分组）。
- `GoalGantt.jsx`：rows 渲染改为 `Fragment` 包裹，命中分隔位置的行前插入 `<div className="gantt-divider">`；编辑表单行与普通行两个 return 分支均包裹。
- CSS：`.gantt-divider { height: 0; border-top: 3px solid var(--border-strong); }`。

**验证**：新增 `test/ganttDivider.test.mjs` 4 组用例（混合层级/首行不插/相邻顶级/无顶级与空表，127 全绿）；e2e 场景 A 补 A5（2 顶级 → 1 线）、场景 G 补 G5（3 顶级 → 2 线），全部通过。

**问题与发现**：
1. 给 rows.map 加 Fragment 时先改了箭头体为表达式位置再插入 JS 语句，中间态文件语法损坏；Vite HMR 报「export 丢失」+ 页面白屏。教训：改 JSX 循环结构应一次性把「回调体形态（块体/表达式体）、闭合符、key 位置」三件事想全再动手，不要留中间态。本次修复时发现编辑分支与正常分支的 return 都要各自包 Fragment，divider 才能在「编辑中的顶级行」前也正确出现。
